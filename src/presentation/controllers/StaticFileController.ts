import { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import type { FileRepository } from '../../domain/repositories/FileRepository.js';
import { FileServiceError, MIME_TYPES } from '../../domain/types/file.types.js';
import type { SupportedExtension } from '../../domain/types/file.types.js';
import { parseByteRange } from '../../utils/rangeParser.js';
import { generateETag, isCacheValid } from '../../utils/cacheUtils.js';

export class StaticFileController {
  constructor(
    private readonly fileRepository: FileRepository
) {}

  async handle(
    filePath: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const method = req.method?.toUpperCase() ?? 'GET';

    try {
      // 1. Metadata del archivo
      const metadata = this.fileRepository.getFileMetadata(filePath);
      const { size: totalFileSize, extension, modifiedTime } = metadata;

      const mimeType = MIME_TYPES[extension as SupportedExtension] ?? 'application/octet-stream';

      // 2. Generación de cabeceras de caché HTTP
      const etag = generateETag(metadata);
      const lastModifiedUTC = modifiedTime.toUTCString();

      // 3. Validación Condicional (304 Not Modified)
      const isFresh = isCacheValid(
        {
          ifNoneMatch: req.headers['if-none-match'],
          ifModifiedSince: req.headers['if-modified-since']
        },
        etag,
        modifiedTime
      );

      if (isFresh) {
        res.writeHead(304, {
          'ETag': etag,
          'Last-Modified': lastModifiedUTC,
          'Cache-Control': 'public, no-cache'
        });
        res.end();
        return;
      }

      // 4. Analizamos el header Range
      const rangeResult = parseByteRange(req.headers.range, totalFileSize);

      // CASO 416: Range inválido
      if (rangeResult.type === 'invalid') {
        res.writeHead(416, {
          'Content-Range': `bytes */${totalFileSize}`,
          'Content-Type': 'text/plain; charset=utf-8'
        });
        res.end('416 Range Not Satisfiable');
        return;
      }

      // CASO 206: Range válido (Partial Content)
      if (rangeResult.type === 'valid') {
        const { start, end } = rangeResult.range;
        const contentLength = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${totalFileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': contentLength,
          'Content-Type': mimeType,
          'ETag': etag,
          'Last-Modified': lastModifiedUTC,
          'Cache-Control': 'public, no-cache'
        });

        if (method === 'HEAD') {
          res.end();
          return;
        }

        const stream = this.fileRepository.getFileStream(filePath, { start, end });
        await pipeline(stream, res);
        return;
      }

      // CASO 200: Petición Normal Completa
      res.writeHead(200, {
        'Content-Length': totalFileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': mimeType,
        'ETag': etag,
        'Last-Modified': lastModifiedUTC,
        'Cache-Control': 'public, no-cache'
      });

      if (method === 'HEAD') {
        res.end();
        return;
      }

      const stream = this.fileRepository.getFileStream(filePath);
      await pipeline(stream, res);

    } catch (error: unknown) {
      if (error instanceof FileServiceError) {
        if (error.code === 'FILE_NOT_FOUND' || error.code === 'IS_A_DIRECTORY') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('404 Not Found - Recurso no encontrado');
          return;
        }

        if (error.code === 'FILE_ACCESS_DENIED') {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('403 Forbidden - Acceso denegado');
          return;
        }
      }

      if (res.headersSent) {
        res.destroy();
        return;
      }

      console.error('Error en StaticFileController:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 Internal Server Error');
    }
  }
}