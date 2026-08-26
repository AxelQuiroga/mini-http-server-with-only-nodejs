import type {
    IncomingMessage,
    ServerResponse
} from 'node:http';

import type {
    Readable
} from 'node:stream';

import type {
    UploadService
} from '../../application/services/UploadService.js';

import {
    UploadError
} from '../../domain/types/upload.types.js';

import {
    FileServiceError
} from '../../domain/types/file.types.js';

export class UploadController {

    constructor(
        private readonly uploadService: UploadService
    ) {}

    async handle(
        req: IncomingMessage,
        res: ServerResponse
    ): Promise<void> {

        // 1. Extraer fileName del query parameter
        const host =
            req.headers.host ?? 'localhost';

        const url = new URL(
            req.url ?? '/',
            `http://${host}`
        );

        const rawFileName =
            url.searchParams.get('filename');

        if (!rawFileName) {
            res.writeHead(400, {
                'Content-Type':
                    'application/json; charset=utf-8'
            });

            res.end(JSON.stringify({
                error: 'Missing filename parameter'
            }));

            return;
        }

        // 2. Decodificar URI
        const decodedFileName =
            decodeURIComponent(rawFileName);

        // 3. Content-Length declarado
        const contentLength =
            req.headers['content-length']
                ? parseInt(
                    req.headers['content-length'],
                    10
                )
                : undefined;

        // 4. Input independiente de HTTP
        const input = {
            stream: req as unknown as Readable,
            fileName: decodedFileName,
            ...(contentLength !== undefined
                ? { contentLength }
                : {})
        };

        // 5. Delegar al Service
        try {

            const mediaInfo =
                await this.uploadService
                    .uploadVideo(input);

            res.writeHead(200, {
                'Content-Type':
                    'application/json; charset=utf-8'
            });

            res.end(JSON.stringify({
                success: true,
                mediaInfo
            }));

        } catch (error) {

            // 6. Mapear errores → status HTTP
            if (
                error instanceof UploadError
            ) {
                const statusMap:
                    Record<string, number> = {
                    INVALID_FILENAME: 400,
                    PAYLOAD_TOO_LARGE: 413,
                    UNSUPPORTED_MEDIA: 415,
                };

                const status =
                    statusMap[error.code] ?? 500;

                res.writeHead(status, {
                    'Content-Type':
                        'application/json; charset=utf-8'
                });

                res.end(JSON.stringify({
                    error: error.message
                }));

                return;
            }

            if (
                error instanceof FileServiceError &&
                error.code ===
                    'FILE_ALREADY_EXISTS'
            ) {
                res.writeHead(409, {
                    'Content-Type':
                        'application/json; charset=utf-8'
                });

                res.end(JSON.stringify({
                    error: error.message
                }));

                return;
            }

            // Error inesperado
            console.error(
                'Error en UploadController:',
                error
            );

            res.writeHead(500, {
                'Content-Type':
                    'application/json; charset=utf-8'
            });

            res.end(JSON.stringify({
                error: 'Internal Server Error'
            }));
        }
    }
}
