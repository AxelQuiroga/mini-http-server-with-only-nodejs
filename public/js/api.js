export async function fetchVideos() {
    const response = await fetch('/api/videos');

    if(!response.ok){
        throw new Error(`HTTP Error: ${response.status}`);
    }

    const data = await response.json();

    return data.videos ??  [];
}


// ============================================================
// UPLOAD DE VIDEO
// ============================================================

/**
 * @typedef {Object} UploadProgress
 * @property {number} loaded - Bytes enviados hasta el momento
 * @property {number} total  - Bytes totales del archivo
 * @property {number} percent - Porcentaje de transmisión (0-100, redondeado)
 */

/**
 * @typedef {Object} UploadResult
 * @property {true} success
 * @property {Object} mediaInfo - Metadatos del video procesado por ffprobe
 */

/**
 * Códigos de error clasificados.
 *
 * SERVER_ERROR   — Se recibió una respuesta HTTP (4xx o 5xx), pero el cuerpo
 *                  no contiene JSON válido o el campo "error" no coincide
 *                  con ningún código conocido.
 * NETWORK_ERROR  — No se obtuvo respuesta HTTP válida (error de red, CORS,
 *                  timeout de conexión, DNS, etc.).
 */
/** @typedef {'INVALID_FILENAME'|'FILE_ALREADY_EXISTS'|'PAYLOAD_TOO_LARGE'|'UNSUPPORTED_MEDIA'|'SERVER_ERROR'|'NETWORK_ERROR'} UploadErrorCode */

/**
 * Error estructurado para fallos en la subida de video.
 * Clasificado por código para que el caller pueda mostrar
 * mensajes de usuario sin parsear strings técnicos.
 */
export class UploadRequestError extends Error {
    /**
     * @param {UploadErrorCode} code
     * @param {number} statusCode - HTTP status code (0 si es error de red)
     * @param {string} message    - Descripción técnica del error
     */
    constructor(code, statusCode, message) {
        super(message);
        this.name = 'UploadRequestError';
        /** @type {UploadErrorCode} */
        this.code = code;
        /** @type {number} */
        this.statusCode = statusCode;
    }
}

// Mapa de códigos HTTP → códigos de aplicación.
// El backend devuelve { "error": "INVALID_FILENAME" }, etc.
// Si el campo "error" no coincide con ninguno de estos,
// se clasifica como SERVER_ERROR genérico.
const ERROR_CODE_MAP = {
    INVALID_FILENAME:    'INVALID_FILENAME',
    FILE_ALREADY_EXISTS: 'FILE_ALREADY_EXISTS',
    PAYLOAD_TOO_LARGE:   'PAYLOAD_TOO_LARGE',
    UNSUPPORTED_MEDIA:   'UNSUPPORTED_MEDIA',
};

/**
 * Sube un archivo de video al servidor.
 *
 * Flujo:
 *   1. Construye POST /api/upload?filename={encoded}
 *   2. Transmite el archivo como body binario
 *   3. onProgress se invoca MÚLTIPLES veces con el progreso de transmisión
 *   4. Cuando la transmisión llega al 100%, el backend procesa (ffprobe + rename)
 *   5. La Promise se resuelve cuando el backend responde (después del procesamiento)
 *
 * Fases (para que el caller distinga):
 *   - uploading:    onProgress se llama con percent < 100
 *   - transmission complete: onProgress se llama con percent = 100
 *   - processing:   silencio — backend trabajando, esperando respuesta
 *   - done:         Promise resuelve (éxito) o rechaza (error)
 *
 * Cancelación: NO soportada en esta versión. La Promise no tiene AbortController.
 *
 * @param {File} file - Archivo seleccionado por el usuario
 * @param {(progress: UploadProgress) => void} onProgress - Callback de progreso de transmisión
 * @returns {Promise<UploadResult>}
 */
export function uploadVideo(file, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const url = `/api/upload?filename=${encodeURIComponent(file.name)}`;

        // --- Progreso de transmisión ---
        // Se invoca múltiples veces. Solo reportamos si lengthComputable.
        // Cuando loaded === total, el 100% de los bytes fue enviado.
        xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) return;

            const percent = Math.round((event.loaded / event.total) * 100);
            onProgress({
                loaded: event.loaded,
                total: event.total,
                percent,
            });
        };

        // --- Respuesta del backend (éxito o error HTTP) ---
        xhr.onload = () => {
            // Parsear el body. Si falla, clasificamos como SERVER_ERROR
            // porque SÍ recibimos una respuesta HTTP, pero el body es inesperado.
            let body;
            try {
                body = JSON.parse(xhr.responseText);
            } catch {
                reject(new UploadRequestError(
                    'SERVER_ERROR',
                    xhr.status,
                    `Respuesta no válida del servidor (HTTP ${xhr.status})`,
                ));
                return;
            }

            // Éxito: 2xx
            if (xhr.status >= 200 && xhr.status < 300) {
                // Validar el contrato completo: { success: true, mediaInfo: {...} }
                if (body?.success === true && body.mediaInfo) {
                    resolve({ success: true, mediaInfo: body.mediaInfo });
                } else {
                    // 2xx pero el body no cumple el contrato esperado
                    reject(new UploadRequestError(
                        'SERVER_ERROR',
                        xhr.status,
                        'Respuesta exitosa con contrato inesperado',
                    ));
                }
                return;
            }

            // Error HTTP: 4xx / 5xx
            // El backend devuelve { "error": "CÓDIGO" }
            const rawCode = body?.error;
            const code = ERROR_CODE_MAP[rawCode] ?? 'SERVER_ERROR';

            reject(new UploadRequestError(
                code,
                xhr.status,
                `HTTP ${xhr.status}: ${rawCode ?? 'sin código'}`,
            ));
        };

        // --- Error de red ---
        // No se obtuvo respuesta HTTP válida.
        // Diferencia con SERVER_ERROR: aquí NO hubo respuesta del servidor.
        xhr.onerror = () => {
            reject(new UploadRequestError(
                'NETWORK_ERROR',
                0,
                'Error de conexión: no se pudo comunicar con el servidor',
            ));
        };

        // --- Configurar y enviar ---
        xhr.open('POST', url);
        xhr.send(file);
    });
}