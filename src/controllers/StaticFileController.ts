import { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { FileService } from '../service/FileService.js';
import { FileServiceError, MIME_TYPES } from '../types/file.types.js';
import type { SupportedExtension } from '../types/file.types.js';
import { parseByteRange } from '../utils/rangeParser.js';

export class StaticFileController {
  constructor(private readonly fileService: FileService) {}

  async handle(
    filePath: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {

    try {
      // 1. Obtenemos información del archivo
      const {
        size: totalFileSize,
        extension
      } = this.fileService.getFileMetadata(filePath);

      const mimeType =
        MIME_TYPES[extension as SupportedExtension]
        ?? 'application/octet-stream';

      // 2. Analizamos el header Range
      const rangeResult = parseByteRange(
        req.headers.range,
        totalFileSize
      );

      // =====================================================
      // CASO 416: Range inválido
      // =====================================================

      if (rangeResult.type === 'invalid') {
        res.writeHead(416, {
          'Content-Range': `bytes */${totalFileSize}`,
          'Content-Type': 'text/plain; charset=utf-8'
        });

        res.end('416 Range Not Satisfiable');
        return;
      }

      // =====================================================
      // CASO 206: Range válido
      // =====================================================

      if (rangeResult.type === 'valid') {

        const { start, end } = rangeResult.range;

        const contentLength = end - start + 1;

        const stream = this.fileService.getFileStream(
          filePath,
          {
            start,
            end
          }
        );

        res.writeHead(206, {
          'Content-Range':
            `bytes ${start}-${end}/${totalFileSize}`,

          'Accept-Ranges': 'bytes',

          'Content-Length':
            contentLength,

          'Content-Type':
            mimeType
        });

        await pipeline(stream, res);
        return;
      }

      // =====================================================
      // CASO 200: No vino Range
      // =====================================================

      const stream = this.fileService.getFileStream(filePath);

      res.writeHead(200, {
        'Content-Length': totalFileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600'
      });

      await pipeline(stream, res);

    } catch (error: unknown) {

      // =====================================================
      // Errores conocidos del FileService
      // =====================================================

      if (error instanceof FileServiceError) {

        if (
          error.code === 'FILE_NOT_FOUND' ||
          error.code === 'IS_A_DIRECTORY'
        ) {
          res.writeHead(404, {
            'Content-Type': 'text/plain; charset=utf-8'
          });

          res.end('404 Not Found - Recurso no encontrado');
          return;
        }

        if (error.code === 'FILE_ACCESS_DENIED') {
          res.writeHead(403, {
            'Content-Type': 'text/plain; charset=utf-8'
          });

          res.end('403 Forbidden - Acceso denegado');
          return;
        }
      }

      // =====================================================
      // Error después de comenzar la respuesta
      // =====================================================

      if (res.headersSent) {
        res.destroy();
        return;
      }

      // =====================================================
      // Error inesperado
      // =====================================================

      console.error(
        'Error en StaticFileController:',
        error
      );

      res.writeHead(500, {
        'Content-Type': 'text/plain; charset=utf-8'
      });

      res.end('500 Internal Server Error');
    }
  }
}