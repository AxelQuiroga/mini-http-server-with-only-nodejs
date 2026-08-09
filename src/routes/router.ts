import { IncomingMessage, ServerResponse } from 'node:http';
import { StaticFileController } from '../controllers/StaticFileController.js';
import { VideoController } from '../controllers/VideoController.js';
import { FileService } from '../service/FileService.js';
import { VideoService } from '../service/VideoService.js';

const fileService = new FileService();
const staticFileController = new StaticFileController(fileService);

const videoService = new VideoService(fileService);
const videoController = new VideoController(videoService);

export async function handleRoutes(
    req: IncomingMessage,
    res: ServerResponse
): Promise<void>{
    
    if (req.method !== 'GET') {
    res.writeHead(405, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Allow': 'GET'
    });

    res.end('405 Method Not Allowed');
    return;
}
  const url = req.url ?? '/';
  const pathname = decodeURIComponent(
    new URL(url, 'http://localhost').pathname
);

  // Si piden la raíz '/', resolvemos explícitamente a 'index.html'
  // Si piden '/css/main.css', se pasa tal cual.
  const targetFilePath = pathname === '/' ? 'index.html' : pathname;

  // Le delegamos la ejecución al controlador pasándole únicamente el path objetivo
  await staticFileController.handle(req,res,targetFilePath);

  if (pathname === '/api/videos') {

    if (req.method !== 'GET') {

        res.writeHead(405, {
            'Content-Type': 'text/plain',
            'Allow': 'GET'
        });

        res.end('Method Not Allowed');

        return;
    }

    videoController.handle(req, res);

    return;
}
  
}