import {
    IncomingMessage,
    ServerResponse
} from 'node:http';

import {
    staticFileController,
    videoController,
    uploadController
} from '../../infraestructure/composition/container.js';


export async function handleRoutes(
    req: IncomingMessage,
    res: ServerResponse
): Promise<void> {

    const url = req.url ?? '/';

    const method =
        req.method?.toUpperCase() ?? 'GET';

    const pathname = decodeURIComponent(
        new URL(
            url,
            'http://localhost'
        ).pathname
    );


    // 1. API
    if (pathname === '/api/videos') {

        if (method === 'GET') {

            await videoController.handle(
                req,
                res
            );

            return;
        }

        res.writeHead(405, {
            'Allow': 'GET',
            'Content-Type':
                'application/json; charset=utf-8'
        });

        res.end(
            JSON.stringify({
                error: '405 Method Not Allowed'
            })
        );

        return;
    }

    // 2. Upload
    if (pathname === '/api/upload') {

        if (method === 'POST') {

            await uploadController.handle(
                req,
                res
            );

            return;
        }

        res.writeHead(405, {
            'Allow': 'POST',
            'Content-Type':
                'application/json; charset=utf-8'
        });

        res.end(
            JSON.stringify({
                error: '405 Method Not Allowed'
            })
        );

        return;
    }

    if (pathname === '/') {
    await staticFileController.handle('index.html', req, res);
    return;
}


    // 2. Archivos estáticos y videos
    if (
        pathname.startsWith('/videos/') ||
        pathname.startsWith('/public/') ||
        pathname.includes('.')
    ) {

        if (
            method !== 'GET' &&
            method !== 'HEAD'
        ) {

            res.writeHead(405, {
                'Allow': 'GET, HEAD',
                'Content-Type':
                    'text/plain; charset=utf-8'
            });

            res.end(
                '405 Method Not Allowed'
            );

            return;
        }


        const filePath =
            pathname.startsWith('/videos/')
                ? pathname.slice(1)
                : pathname.replace(
                    /^\/?public\//,
                    ''
                );


        await staticFileController.handle(
            filePath,
            req,
            res
        );

        return;
    }


    // 3. Ruta inexistente
    res.writeHead(404, {
        'Content-Type':
            'application/json; charset=utf-8'
    });

    res.end(
        JSON.stringify({
            error: 'Ruta no encontrada'
        })
    );
}