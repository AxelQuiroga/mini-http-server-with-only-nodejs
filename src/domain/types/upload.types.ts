import type {
    Readable,
    Writable
} from 'node:stream';

// ─── Errores del caso de uso ────────────────────────────────────────────

export type UploadErrorCode =
    | 'INVALID_FILENAME'
    | 'PAYLOAD_TOO_LARGE'
    | 'UNSUPPORTED_MEDIA';

export class UploadError extends Error {
    constructor(
        public readonly code: UploadErrorCode
    ) {
        super(code);
        this.name = 'UploadError';
    }
}

// ─── Input del caso de uso ──────────────────────────────────────────────

export interface UploadVideoInput {
    /** Stream readable con el body del video (viene del Controller) */
    stream: Readable;

    /** Nombre saneado del archivo (ya decodificado y validado por el Controller) */
    fileName: string;

    /** Tamaño declarado por el cliente (puede estar ausente o ser incorrecto) */
    contentLength?: number;
}

// ─── Handle del upload ──────────────────────────────────────────────────

export interface UploadHandle {
    /** Ruta absoluta del .tmp — necesario para ffprobe */
    readonly absolutePath: string;

    /** Stream de escritura hacia el .tmp — destino del pipeline */
    readonly writable: Writable;
}
