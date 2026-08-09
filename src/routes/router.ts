import { IncomingMessage, ServerResponse } from 'node:http';

import { StaticFileController } from '../controllers/StaticFileController.js';
import { VideoController } from '../controllers/VideoController.js';

import { FileService } from '../service/FileService.js';
import { VideoService } from '../service/VideoService.js';

const fileService = new FileService();

const staticFileController = new StaticFileController(
    fileService
);

const videoService = new VideoService(
    fileService
);

const videoController = new VideoController(
    videoService
);

export async function handleRoutes(
    req: IncomingMessage,
    res: ServerResponse
): Promise<void> {

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


    if (pathname === '/api/videos') {

        videoController.handle(req, res);

        return;
    }


    const targetFilePath =
        pathname === '/'
            ? 'index.html'
            : pathname;

    await staticFileController.handle(
        targetFilePath,
        req,
        res
    );
}