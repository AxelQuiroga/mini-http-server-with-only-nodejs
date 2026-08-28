/**
 * Clasificador conservador de errores de PostgreSQL + transporte.
 *
 * NO importa `pg`: inspecciona el shape del error (code/syscall/message).
 * Diseñado para la política de retry/rollback del UploadService.
 *
 * REGLA DE ORO: ante cualquier duda → AMBIGUOUS. La capa de transporte no
 * permite saber con certeza si una query se ejecutó cuando la conexión se
 * corta; el diseño prefiere NO destruir un archivo ante la incertidumbre
 * (el CatalogSyncJob reconcilia el residuo en el próximo arranque).
 */

export type PgErrorClass =
    | 'FATAL'         // DatabaseError NO transitorio: el server rechazó y el statement NO se aplicó
    | 'RETRYABLE'     // DatabaseError transitorio: el server rechazó (no aplicado) pero conviene reintentar
    | 'NOT_EXECUTED'  // Certeza de que la query JAMÁS salió de esta máquina (fallo al adquirir conexión)
    | 'AMBIGUOUS';    // Cualquier posibilidad de envío: la query pudo o no ejecutarse

/**
 * SQLSTATE transitorios (reintentar tiene sentido):
 *   40001 serialization_failure, 40P01 deadlock_detected,
 *   57P01 admin_shutdown, 57P02 crash_shutdown, 57P03 cannot_connect_now (PG arrancando).
 * Cualquier OTRO SQLSTATE es definitivo (FATAL): reintentar no cambia el rechazo.
 */
const RETRYABLE_SQLSTATE =
    new Set(['40001', '40P01', '57P01', '57P02', '57P03']);

/**
 * SQLSTATE es exactamente 5 chars alfanuméricos — separa limpiamente
 * los DatabaseError (que llegaron del server) de los códigos de Node
 * ('ECONNREFUSED', etc., que son errores de transporte).
 *
 * GOTCHA (fix C1): los SystemError de Node con errno de EXACTAMENTE 5 chars
 * ('EPIPE', 'E2BIG', 'ENFILE', 'ESRCH', 'EXDEV', 'EIDRM'...) también matchean
 * SQLSTATE_PATTERN. La separación estructural es `syscall`: los DatabaseError
 * de node-postgres NUNCA tienen syscall (el SQLSTATE llega por el campo C del
 * wire protocol), los SystemError SIEMPRE tienen syscall. Por eso la rama
 * SQLSTATE exige `err.syscall === undefined`; con syscall presente es un error
 * de transporte y debe seguir el flujo conservador (NOT_EXECUTED/AMBIGUOUS).
 */
const SQLSTATE_PATTERN =
    /^[0-9A-Z]{5}$/;

/**
 * Fallos en la ADQUISICIÓN de la conexión: la query jamás se envió.
 * syscall === 'connect' → TCP nunca se estableció.
 * syscall === 'getaddrinfo' → DNS nunca resolvió.
 * Ambos = certeza de NO ejecución.
 */
const CONNECT_SYSCALLS =
    new Set(['connect', 'getaddrinfo']);

/**
 * Mensaje del pool de node-postgres cuando ninguna conexión quedó libre
 * dentro del timeout: la query ni siquiera se encoló en un socket.
 */
const POOL_TIMEOUT_MESSAGE =
    /timeout exceeded when trying to connect/i;

export function classifyPgError(
    error: unknown
): PgErrorClass {

    if (!(error instanceof Error)) {
        return 'AMBIGUOUS';
    }

    const err =
        error as NodeJS.ErrnoException;

    // 1. Respondió el SERVER (SQLSTATE): rechazo confirmado,
    //    statement atómico NO aplicado. Transitorio o no.
    //    `err.syscall === undefined` separa los DatabaseError (wire field C,
    //    sin syscall) de los SystemError de Node con errno de 5 chars
    //    ('EPIPE', 'E2BIG'...): esos siempre traen syscall y NO son SQLSTATE.
    if (
        typeof err.code === 'string' &&
        err.syscall === undefined &&
        SQLSTATE_PATTERN.test(err.code)
    ) {
        return RETRYABLE_SQLSTATE.has(err.code)
            ? 'RETRYABLE'
            : 'FATAL';
    }

    // 2. Fallo al establecer/obtener la conexión: no enviado.
    if (
        typeof err.code === 'string' &&
        err.syscall !== undefined &&
        CONNECT_SYSCALLS.has(err.syscall)
    ) {
        return 'NOT_EXECUTED';
    }

    // 3. Sin conexión libre del pool: no enviado.
    if (POOL_TIMEOUT_MESSAGE.test(err.message)) {
        return 'NOT_EXECUTED';
    }

    // 4. Todo lo demás (ECONNRESET en read/write, "Connection terminated
    //    unexpectedly", timeout de transmisión, errores desconocidos...):
    //    la query PUDO haberse enviado → AMBIGUOUS (conservador).
    return 'AMBIGUOUS';
}