import { pipeline } from 'node:stream/promises';
import { extname } from 'node:path';

import {
    sanitizeFilename
} from '../../utils/filenameSanitizer.js';

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
    VideoMediaInfo
} from '../../domain/types/media.types.js';

const ALLOWED_EXTENSIONS =
    ['.mp4', '.mkv', '.webm', '.mov', '.avi'];

export class UploadService {

    constructor(
        private readonly fileRepository: FileRepository,
        private readonly mediaRepository: MediaRepository
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

        return mediaInfo;
    }
}
