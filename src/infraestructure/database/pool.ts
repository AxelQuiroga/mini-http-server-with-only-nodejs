import { Pool } from 'pg';

/**
 * Error de configuración de base de datos — fail-fast ANTES de
 * intentar conectar (con mensaje accionable, nunca la password).
 */
export class DatabaseConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DatabaseConfigError';
    }
}

/**
 * Crea la ÚNICA instancia compartida del pool de conexiones.
 *
 * INVARIANTE DEL ADR: se instancia UNA VEZ en el composition root
 * (container) y se inyecta a los repositorios. Prohibido crear pools
 * por request o por repositorio.
 *
 * Variables estándar de node-postgres (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE)
 * leídas de .env (ver scripts/setup-postgres.sh). Solo PGPASSWORD es obligatoria
 * sin default: sin credenciales, el proceso debe morir con error claro,
 * NUNCA arrancar en un estado parcialmente funcional.
 */
export function createPool(): Pool {

    const host =
        process.env.PGHOST ?? 'localhost';

    const port =
        Number(process.env.PGPORT ?? 5432);

    const user =
        process.env.PGUSER ?? 'videouser';

    const password =
        process.env.PGPASSWORD;

    const database =
        process.env.PGDATABASE ?? 'videocatalog';

    if (!password) {
        throw new DatabaseConfigError(
            'PGPASSWORD no definida. Copiá .env.example a .env ' +
            'o ejecutá scripts/setup-postgres.sh'
        );
    }

    if (!Number.isInteger(port)) {
        throw new DatabaseConfigError(
            `PGPORT inválido: "${process.env.PGPORT ?? ''}"`
        );
    }

    return new Pool({
        host,
        port,
        user,
        password,
        database,
        max: 10 // default de node-postgres; explícito = documentado
    });
}