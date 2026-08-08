import { ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { FileService } from '../service/FileService.js';
import { FileServiceError, MIME_TYPES } from '../types/file.types.js';
import type { SupportedExtension } from '../types/file.types.js';

export class StaticFileController {
  constructor(private readonly fileService: FileService) {}

  async handle(filePath: string, res: ServerResponse): Promise<void> {
    try {
      // Obtenemos la ruta solicitada descartando query params (ej: /css/style.css?v=1 -> /css/style.css)
      
      // El servicio resuelve el stream a partir de la ruta del recurso
      const { stream, size, extension } = this.fileService.getFileStream(filePath);

      const mimeType =
        MIME_TYPES[extension as SupportedExtension] ?? 'application/octet-stream';

      res.writeHead(200, {
        'Content-Length': size,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=3600' // Opcional: Cache de assets por 1h
      });

      await pipeline(stream, res);

    } catch (error: unknown) {
      if (error instanceof FileServiceError) {
        if (error.code === 'FILE_NOT_FOUND') {
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