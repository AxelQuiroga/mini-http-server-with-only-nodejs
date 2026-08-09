import {
    IncomingMessage,
    ServerResponse
} from 'node:http';

import { VideoService } from '../service/VideoService.js';

export class VideoController {

    constructor(
        private readonly videoService: VideoService
    ) {}

    handle(
        req: IncomingMessage,
        res: ServerResponse
    ): void {

        try {

            const videos = this.videoService.getAllVideos();

            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8'
            });

            res.end(JSON.stringify({
                videos
            }));

        } catch (error: unknown) {

            console.error(
                'Error en VideoController:',
                error
            );

            res.writeHead(500, {
                'Content-Type': 'application/json; charset=utf-8'
            });

            res.end(JSON.stringify({
                error: 'Internal Server Error'
            }));
        }
    }
}