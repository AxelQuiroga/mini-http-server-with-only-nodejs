import { pipeline } from 'node:stream/promises';
import { extname, join } from 'node:path';

import {
    sanitizeFilename
} from '../../utils/filenameSanitizer.js';

import {
    classifyPgError
} from '../../utils/postgresErrorClassifier.js';

import type {
    PgErrorClass
} from '../../utils/postgresErrorClassifier.js';

import {
    ByteCounter,
    MAX_UPLOAD_SIZE
} from '../../utils/byteCounter.js';

import {
    UploadError
} from '../../domain/types/upload.types.js';

import type {
    UploadVideoInput,
    UploadHandle
} from '../../domain/types/upload.types.js';

import {
    FileServiceError
} from '../../domain/types/file.types.js';

import type {
    FileRepository
} from '../../domain/repositories/FileRepository.js';

import type {
    MediaRepository
} from '../../domain/repositories/MediaRepository.js';

import type {
    VideoRepository
} from '../../domain/repositories/VideoRepository.js';

import type {
    VideoMediaInfo
} from '../../domain/types/media.types.js';

import type {
    StoredVideoMetadata
} from '../../domain/types/catalog.types.js';

const ALLOWED_EXTENSIONS =
    ['.mp4', '.mkv', '.webm', '.mov', '.avi'];

/**
 * Política de retry del catálogo (ADR §D4 / diseño aprobado):
 * máximo 2 intentos con la MISMA metadata — ON CONFLICT(relative_path)
 * garantiza idempotencia lógica. El reintento vive en el caso de uso,
 * NO en PostgresVideoRepository (que se mantiene single-shot).
 */
const MAX_CATALOG_ATTEMPTS = 2;

const RETRY_BACKOFF_MS = 150;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) =>
        setTimeout(resolve, ms));
}

export class UploadService {

    constructor(
        private readonly fileRepository: FileRepository,
        private readonly mediaRepository: MediaRepository,
        private readonly videoRepository: VideoRepository
    ) {}

    async uploadVideo(
        input: UploadVideoInput
    ): Promise<VideoMediaInfo> {

        // 1. Sanear nombre
        const safeName =
            sanitizeFilename(input.fileName);

        if (!safeName) {
            throw new UploadError(
                'INVALID_FILENAME'
            );
        }

        // 2. Validar extensión
        const ext =
            extname(safeName).toLowerCase();

        if (
            !ALLOWED_EXTENSIONS.includes(ext)
        ) {
            throw new UploadError(
                'UNSUPPORTED_MEDIA'
            );
        }

        // 3. Pre-chequeo de Content-Length
        if (
            input.contentLength !== undefined &&
            input.contentLength > MAX_UPLOAD_SIZE
        ) {
            throw new UploadError(
                'PAYLOAD_TOO_LARGE'
            );
        }

        // 4. Crear reserva (lock + temp)
        const handle =
            await this.fileRepository
                .createUpload(safeName);

        // 5. Pipeline: stream → counter → writable
        try {
            const counter = new ByteCounter();

            await pipeline(
                input.stream,
                counter,
                handle.writable
            );
        } catch (error) {
            // Error original tiene prioridad
            await this.fileRepository
                .cancelUpload(handle)
                .catch((cleanupError) => {
                    console.warn(
                        '[UploadService] cleanup failed:',
                        cleanupError
                    );
                });

            throw error;
        }

        // 6. Validar con ffprobe
        let mediaInfo: VideoMediaInfo;

        try {
            mediaInfo =
                await this.mediaRepository
                    .getVideoInfo(
                        handle.absolutePath
                    );
        } catch (error) {
            await this.fileRepository
                .cancelUpload(handle)
                .catch((cleanupError) => {
                    console.warn(
                        '[UploadService] cleanup failed:',
                        cleanupError
                    );
                });

            throw new UploadError(
                'UNSUPPORTED_MEDIA'
            );
        }

        // 7. Completar: rename .tmp → final
        await this.fileRepository
            .completeUpload(handle);

        // 8. Persistir metadata en el catálogo (PostgreSQL).
        //    Rename ANTES de save (D3): la fila solo describe archivos
        //    que existen. El path/extension vienen de getFileMetadata
        //    (misma fuente que CatalogSyncJob) → convergencia garantizada.
        const id =
            Buffer.from(safeName)
                .toString('base64url');

        const { size, extension } =
            this.fileRepository.getFileMetadata(
                join('videos', safeName)
            );

        const stored: StoredVideoMetadata = {
            id,
            relativePath: safeName,
            fileName: safeName,
            size,
            extension,
            mediaInfo,
            // La DB gobierna los timestamps (now()): save() los ignora;
            // el dominio los recibe de vuelta en listAll().
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await this.persistWithRetry(safeName, stored);

        // 9. Thumbnail best-effort (D6): dato DERIVADO — jamás convierte
        //    un upload exitoso en error. Si falla, el sync fase 3 lo
        //    regenera en el próximo arranque.
        try {
            await this.mediaRepository.getVideoThumbnail(
                handle.absolutePath.slice(0, -4),
                join(
                    process.cwd(),
                    'public',
                    'thumbnails',
                    `${id}.jpg`
                )
            );
        } catch (error) {
            console.warn(
                `[UploadService] No se pudo generar la thumbnail de: ` +
                `${safeName} (el sync la regenerará)`
            );
        }

        return mediaInfo;
    }

    /**
     * Política de retry/rollback del caso A (matriz de fallas del ADR).
     *
     * - FATAL → 1 solo intento (el server rechazó; reintentar no cambia nada).
     * - RETRYABLE / NOT_EXECUTED / AMBIGUOUS → 2 intentos con la MISMA metadata
     *   (ON CONFLICT ⇒ idempotencia lógica: si el 1er intento se ejecutó en
     *   realidad, el 2do es un DO UPDATE no-op).
     * - Tras agotar:
     *     * AMBIGUOUS → NUNCA deleteVideo (no hay certeza de no-persistencia;
     *       el binario NO se destruye por incertidumbre de red).
     *     * resto → rollback destructivo best-effort: hay certeza de que el
     *       INSERT no se aplicó (server rechazó / query nunca salió).
     * - I1: el historial manda sobre el último veredicto — si ALGÚN intento
     *   fue AMBIGUOUS, el INSERT pudo haberse aplicado en ese intento; el
     *   resultado final se degrada a AMBIGUOUS y jamás hay rollback, aunque
     *   el último error haya sido FATAL.
     * - Rollback fallido → CATALOG ORPHAN registrado; el sync cataloga el
     *   archivo huérfano en el próximo arranque.
     */
    private async persistWithRetry(
        relativePath: string,
        stored: StoredVideoMetadata
    ): Promise<void> {

        let outcome: PgErrorClass = 'AMBIGUOUS';

        // I1: el historial de incertidumbre sobrevive a los reintentos.
        // Si algún intento fue AMBIGUOUS, el INSERT pudo haberse aplicado
        // en ese intento → el veredicto final se degrada a AMBIGUOUS y el
        // binario jamás se destruye, aunque el último error fue FATAL.
        let sawAmbiguous = false;

        for (
            let attempt = 1;
            attempt <= MAX_CATALOG_ATTEMPTS;
            attempt++
        ) {
            try {
                await this.videoRepository.save(stored);
                return;
            } catch (error) {
                outcome = classifyPgError(error);

                if (outcome === 'AMBIGUOUS') {
                    sawAmbiguous = true;
                }

                if (outcome === 'FATAL') {
                    // Rechazo confirmado y definitivo: no hay reintento.
                    break;
                }
            }

            if (attempt < MAX_CATALOG_ATTEMPTS) {
                await delay(RETRY_BACKOFF_MS);
            }
        }

        // ─── Agotado ──────────────────────────────────────────────────

        // I1: un único AMBIGUOUS en el historial prevalece sobre el último
        // error. La certeza de no-persistencia EXIGE que todos los intentos
        // hayan sido rechazados de forma confirmada (FATAL/RETRYABLE) o que
        // la query nunca haya salido (NOT_EXECUTED).
        if (sawAmbiguous) {
            outcome = 'AMBIGUOUS';
        }

        if (outcome === 'AMBIGUOUS') {
            console.warn(
                `[UploadService] CATALOG ORPHAN (fallo ambiguo, SIN ` +
                `rollback): ${relativePath} — el INSERT pudo o no ` +
                `ejecutarse; el CatalogSyncJob lo reconcilia`
            );
            throw new UploadError('CATALOG_ERROR');
        }

        // Certeza de no-persistencia (FATAL / RETRYABLE / NOT_EXECUTED):
        // rollback destructivo best-effort para permitir reintento limpio.
        try {
            await this.fileRepository
                .deleteVideo(join('videos', relativePath));
        } catch (error) {
            console.error(
                `[UploadService] CATALOG ORPHAN (rollback falló): ` +
                `${relativePath} — el archivo quedó sin fila; el sync ` +
                `lo catalogará en el próximo arranque`,
                error
            );
            throw new UploadError('CATALOG_ERROR');
        }

        throw new UploadError('CATALOG_ERROR');
    }
}
