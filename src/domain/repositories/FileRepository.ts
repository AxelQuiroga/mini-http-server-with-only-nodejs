import type { ReadStream } from 'node:fs';

import type {
    FileMetadata
} from '../types/file.types.js';

import type {
    ByteRange,
    VideoStreamMetadata
} from '../types/video.types.js';

import type {
    UploadHandle
} from '../types/upload.types.js';

export interface FileRepository {

    // ─── Lectura ────────────────────────────────────────────────────────

    getFileMetadata(
        relativePath: string
    ): FileMetadata;

    getFileStream(
        relativePath: string,
        options?: {
            start?: number;
            end?: number;
        }
    ): ReadStream;

    getPartialFileStream(
        relativePath: string,
        range: ByteRange
    ): VideoStreamMetadata;

    // ─── Listado ────────────────────────────────────────────────────────

    /**
     * Lista los archivos de VIDEO del storage (recursivo), relativos a la
     * carpeta de videos, con separadores del SO (SIN normalizar — la
     * normalización \ → / es responsabilidad del llamador).
     * Filtra por ALLOWED_VIDEO_EXTENSIONS: el sync depende de no recibir
     * basura (desktop.ini, .tmp, .lock) para no probarla con ffprobe.
     * Seguridad: si la carpeta raíz NO existe (estado fresco) → [];
     * cualquier OTRO error de lectura PROPAGA (un listado incompleto jamás
     * debe fundamentar borrados de filas).
     */
    listVideos(): Promise<string[]>;

    // ─── Upload ─────────────────────────────────────────────────────────

    /**
     * Crea reserva exclusiva (.lock) y temporal (.tmp).
     * El lock protege la reserva: ningún otro upload puede competir.
     * Verifica que el archivo final no exista después de adquirir el lock.
     */
    createUpload(
        fileName: string
    ): Promise<UploadHandle>;

    /**
     * Rename .tmp → final, luego delete .lock.
     * Si falla después del rename, el .lock queda como huérfano
     * y cleanOrphanUploads lo elimina al startup.
     */
    completeUpload(
        handle: UploadHandle
    ): Promise<void>;

    /**
     * Delete .tmp + .lock. Idempotente: ENOENT no es error.
     */
    cancelUpload(
        handle: UploadHandle
    ): Promise<void>;

    /**
     * Elimina el archivo físico FINAL (no .tmp/.lock).
     * Idempotente: ENOENT no es error; los errores REALES se propagan
     * para que el llamador decida (rollback best-effort del caso A).
     * El catálogo NO usa esta operación — el sync solo borra filas.
     * Único uso actual: UploadService. Caso A: el archivo persiste pero
     * el INSERT de metadata en PostgreSQL falló.
     */
    deleteVideo(
        relativePath: string
    ): Promise<void>;

    /**
     * Elimina artefactos de upload huérfanos (.*.lock y sus .tmp,
     * más .tmp sueltos sin lock correspondiente).
     * Ejecutar ANTES de server.listen().
     */
    cleanOrphanUploads(): Promise<void>;
}