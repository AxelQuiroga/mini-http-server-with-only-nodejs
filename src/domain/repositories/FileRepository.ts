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
     * Elimina artefactos de upload huérfanos (.*.lock y sus .tmp,
     * más .tmp sueltos sin lock correspondiente).
     * Ejecutar ANTES de server.listen().
     */
    cleanOrphanUploads(): Promise<void>;
}