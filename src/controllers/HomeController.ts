/*import { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from 'node:stream/promises';
import { FileService } from "../service/FileService.js";
import { FileServiceError, MIME_TYPES } from '../types/file.types.js';
import type { SupportedExtension } from '../types/file.types.js';
export class HomeController{
    constructor(
        private readonly fileService: FileService
    ) {}
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        try {
            const filePath = "index.html";

            const { stream,size,extension } = this.fileService.getFileStream(filePath);

            const mimeType = MIME_TYPES[extension as SupportedExtension] ?? 'application/octet-stream';

            res.writeHead(200, {
              'Content-Length': size,
              'Content-Type': mimeType
            });
        
            await pipeline(stream,res);

        } catch (error: unknown) {
      // Manejo de errores de negocio del FileService
      if (error instanceof FileServiceError) {
        if (error.code === "FILE_NOT_FOUND") {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("404 Not Found");
          return;
        }

        if (error.code === "FILE_ACCESS_DENIED") {
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end("403 Forbidden");
          return;
        }
      }


      if (res.headersSent) {
        res.destroy();  
        return;
      }

      
      console.error("Error en HomeController:", error);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("500 Internal Server Error");
    }
}

}*/