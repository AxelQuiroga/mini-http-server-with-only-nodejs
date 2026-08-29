import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
    createServer,
    type Server
} from 'node:http';

import {
    mkdtemp,
    mkdir,
    rm,
    readdir,
    writeFile
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
    FileSystemRepository
} from '../../src/infraestructure/filesystem/FileSystemRepository.js';

import {
    PostgresVideoRepository
} from '../../src/infraestructure/database/PostgresVideoRepository.js';

import {
    applySchema
} from '../../src/infraestructure/database/schema.js';

import {
    UploadService
} from '../../src/application/services/UploadService.js';

import {
    VideoService
} from '../../src/application/services/VideoService.js';

import {
    CatalogSyncJob
} from '../../src/application/services/CatalogSyncJob.js';

import {
    StaticFileController
} from '../../src/presentation/controllers/StaticFileController.js';

import {
    VideoController
} from '../../src/presentation/controllers/VideoController.js';

import {
    UploadController
} from '../../src/presentation/controllers/UploadController.js';

import {
    handleRoutes
} from '../../src/presentation/routes/router.js';

import type {
    Container
} from '../../src/infraestructure/composition/container.js';

import type {
    MediaRepository
} from '../../src/domain/repositories/MediaRepository.js';

import type {
    VideoMediaInfo
} from '../../src/domain/types/media.types.js';

import type { Pool } from 'pg';

import {
    createTestPool,
    dbSkipReason,
    truncateVideos
} from './helpers.js';

/**
 * END-TO-END — UploadService + controllers + router + HTTP real + filesystem
 * REAL + PostgreSQL REAL (videocatalog_test). ÚNICO elemento fake: el media
 * (ffprobe/ffmpeg), que respeta el contrato de MediaRepository y, en
 * `getVideoThumbnail`, ESCRIBE el archivo real.
 *
 * DISTINCIÓN con las suites de "integration" (repo / sync): este archivo
 * ejercita el flujo COMPLETO (fetch → router → controller → service →
 * repositorios), mientras que las de integration prueban un adaptador o
 * servicio aislado con fakes mínimos.
 *
 * Orquestación de la concurrencia: el fake media DELAYA getVideoInfo
 * (ffprobe). Mientras el upload A está "procesando" con el .lock VIVO en
 * disco, el POST B del mismo nombre debe obtener 409 — sin simular cortes
 * de socket ni nada de red: el lock es un artefacto REAL del filesystem.
 *
 * Atención: handleRoutes y los controllers son los de PRODUCCIÓN; el
 * container se compone inline con componentes públicos (igual que el
 * composition root), nunca se toca container.ts ni server.ts.
 */

const pool = createTestPool();
const skip = await dbSkipReason(pool);

const E2E_MEDIA_INFO: VideoMediaInfo = {
    duration: 10,
    width: 1920,
    height: 1080,
    videoCodec: 'h264'
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) =>
        setTimeout(resolve, ms));
}

/**
 * Fake del media con delay configurable para orquestar la concurrencia.
 * getVideoThumbnail escribe el archivo REAL en el destino recibido.
 */
class E2EMediaRepository
    implements MediaRepository {

    constructor(
        private readonly ffprobeDelayMs = 0
    ) {}

    async getVideoInfo(): Promise<VideoMediaInfo> {
        if (this.ffprobeDelayMs > 0) {
            await sleep(this.ffprobeDelayMs);
        }
        return E2E_MEDIA_INFO;
    }

    async getVideoThumbnail(
        _absoluteVideoPath: string,
        thumbnailPath: string
    ): Promise<void> {
        await mkdir(dirname(thumbnailPath), { recursive: true });
        await writeFile(thumbnailPath, 'E2E-JPEG');
    }
}

// ─── Contexto por test: FS aislado + server efímero ───────────────────────

let originalCwd = process.cwd();
let tempRoot: string | undefined;

async function makeE2EContext(
    mediaRepo: E2EMediaRepository,
    pgPool: Pool = pool
) {
    if (tempRoot !== undefined) {
        process.chdir(originalCwd);
        await rm(tempRoot, { recursive: true, force: true });
    }

    tempRoot = await mkdtemp(join(tmpdir(), 'e2e-'));

    await mkdir(join(tempRoot, 'public', 'videos'), {
        recursive: true
    });
    await mkdir(join(tempRoot, 'public', 'thumbnails'), {
        recursive: true
    });

    process.chdir(tempRoot);

    const fileRepo =
        new FileSystemRepository('public');

    const pgRepo =
        new PostgresVideoRepository(pgPool);

    const uploadService =
        new UploadService(fileRepo, mediaRepo, pgRepo);

    const videoService =
        new VideoService(fileRepo, mediaRepo);

    const catalogSyncJob =
        new CatalogSyncJob(
            fileRepo,
            mediaRepo,
            pgRepo,
            'public/videos'
        );

    const container: Container = {
        pool: pgPool,
        fileRepository: fileRepo,
        mediaRepository: mediaRepo,
        videoRepository: pgRepo,
        videoService,
        uploadService,
        catalogSyncJob,
        staticFileController:
            new StaticFileController(fileRepo),
        videoController:
            new VideoController(videoService),
        uploadController:
            new UploadController(uploadService)
    };

    const server = await startServer(container);

    return { container, server, fileRepo, pgRepo, tempRoot };
}

function startServer(
    container: Container
): Promise<{ server: Server; port: number }> {
    const server = createServer(async (req, res) => {
        try {
            await handleRoutes(req, res, container);
        } catch (error) {
            console.error('[e2e] unhandled:', error);
            res.writeHead(500, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                error: 'Internal Server Error'
            }));
        }
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                throw new Error('sin puerto');
            }
            resolve({ server, port: address.port });
        });
    });
}

async function videosDirEntries(
    root: string
): Promise<string[]> {
    return readdir(join(root, 'public', 'videos'));
}

before(async () => {
    if (!skip) {
        await applySchema(pool);
        await truncateVideos(pool);
    }
});

after(async () => {
    if (tempRoot !== undefined) {
        process.chdir(originalCwd);
        await rm(tempRoot, { recursive: true, force: true });
    }
    await pool.end();
});

// ─── Bloque 4: persistencia real post-upload ─────────────────────────────

test(
    'E2E persistencia: upload 200 → fila con metadata EXACTA (sin ffprobe '
    + 'en el read), binario en disco y servible por HTTP, thumbnail real',
    { skip },
    async (t) => {
        await truncateVideos(pool);

        const { server, pgRepo, tempRoot } =
            await makeE2EContext(new E2EMediaRepository());

        t.after(() => {
            server.server.close();
        });

        const fileBytes =
            new Uint8Array(
                Buffer.from('contenido-e2e-bytes')
            );

        const postRes = await fetch(
            `http://127.0.0.1:${server.port}/api/upload?filename=${encodeURIComponent('e2e.mp4')}`,
            { method: 'POST', body: fileBytes }
        );

        assert.equal(postRes.status, 200);
        const payload = await postRes.json() as {
            success: boolean;
            mediaInfo: VideoMediaInfo;
        };
        assert.equal(payload.success, true);
        assert.deepEqual(payload.mediaInfo, E2E_MEDIA_INFO);

        // 1) La metadata PERSISTE: listAll() la devuelve idéntica SIN
        //    volver a ejecutar ffprobe (el read es la DB, no el media).
        const rows = await pgRepo.listAll();
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.relativePath, 'e2e.mp4');
        assert.equal(
            rows[0]!.id,
            Buffer.from('e2e.mp4').toString('base64url')
        );
        assert.equal(rows[0]!.size, 'contenido-e2e-bytes'.length);
        assert.equal(rows[0]!.extension, '.mp4');
        assert.deepEqual(rows[0]!.mediaInfo, E2E_MEDIA_INFO);

        // 2) El binario REAL existe en public/videos
        assert.ok(
            existsSync(join(tempRoot, 'public', 'videos', 'e2e.mp4'))
        );

        // 3) El binario es SERVIBLE por HTTP (StaticFileController real:
        //    ETag, Content-Length y bytes idénticos)
        const getRes = await fetch(
            `http://127.0.0.1:${server.port}/videos/e2e.mp4`
        );
        assert.equal(getRes.status, 200);
        assert.equal(
            getRes.headers.get('content-length'),
            String('contenido-e2e-bytes'.length)
        );
        const served = Buffer.from(
            await getRes.arrayBuffer()
        );
        assert.ok(
            served.equals(Buffer.from('contenido-e2e-bytes')),
            'los bytes servidos deben ser exactamente los subidos'
        );

        // 4) La thumbnail REAL quedó escrita (mismo id → mismo nombre)
        const thumbId =
            Buffer.from('e2e.mp4').toString('base64url');
        assert.ok(
            existsSync(
                join(tempRoot, 'public', 'thumbnails', `${thumbId}.jpg`)
            )
        );

        // 5) Estado limpio del mecanismo: sin .lock ni .tmp
        const entries = await videosDirEntries(tempRoot);
        assert.deepEqual(entries, ['e2e.mp4']);

        server.server.close();
    }
);

// ─── Bloque 5: concurrencia real (1 ganador + 1×409 con lock intacto) ─────

test(
    'E2E concurrencia: 2 POST paralelos del mismo nombre → 1×200 + 1×409; '
    + 'el perdedor recibe 409 CON el lock del ganador vivo en disco; '
    + 'al final 1 sola fila y cero artefactos (.lock/.tmp)',
    { skip },
    async (t) => {
        await truncateVideos(pool);

        // ffprobe del winner deliberadamente lento: la ventana donde el
        // .lock está vivo y el archivo final aún no existe.
        const { server, pgRepo, tempRoot } =
            await makeE2EContext(
                new E2EMediaRepository(300)
            );

        t.after(() => {
            server.server.close();
        });

        const body =
            new Uint8Array(Buffer.from('bytes-concurrentes'));

        const winnerPromise = fetch(
            `http://127.0.0.1:${server.port}/api/upload?filename=final.mp4`,
            { method: 'POST', body }
        );

        // Esperar a que el winner adquiera el lock y esté "en ffprobe"
        await sleep(80);

        const loser = await fetch(
            `http://127.0.0.1:${server.port}/api/upload?filename=final.mp4`,
            { method: 'POST', body }
        );

        assert.equal(
            loser.status,
            409,
            'el lock del winner debe excluir al segundo POST'
        );
        const loserBody = await loser.json() as {
            error: string;
        };
        assert.equal(loserBody.error, 'FILE_ALREADY_EXISTS');

        // INVARIANTE: el lock SIGUE vivo (pertenece al winner; el 409
        // jamás debe tocarlo)
        assert.ok(
            existsSync(
                join(tempRoot, 'public', 'videos', 'final.mp4.lock')
            ),
            'el lock del winner debe seguir en disco durante su upload'
        );

        const winnerRes = await winnerPromise;
        assert.equal(winnerRes.status, 200);

        // Estado final: 1 fila, 1 archivo, cero artefactos
        const rows = await pgRepo.listAll();
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.relativePath, 'final.mp4');

        const entries = await videosDirEntries(tempRoot);
        assert.deepEqual(
            entries,
            ['final.mp4'],
            'sin .lock ni .tmp: cero basura del mecanismo'
        );

        // El ganador es servible
        const getRes = await fetch(
            `http://127.0.0.1:${server.port}/videos/final.mp4`
        );
        assert.equal(getRes.status, 200);
        const served = Buffer.from(await getRes.arrayBuffer());
        assert.ok(
            served.equals(Buffer.from('bytes-concurrentes'))
        );
    }
);

// ─── Bloque 6: caso A — rollback real con PG caído (host muerto) ───────────

test(
    'E2E caso A: PostgreSQL caído (ECONNREFUSED real) → 500 CATALOG_ERROR '
    + 'y rollback REAL: sin binario, sin fila, sin lock — el reintento '
    + 'posterior queda limpio',
    { skip },
    async (t) => {
        await truncateVideos(pool);

        // Pool apuntando a un puerto cerrado: NOT_EXECUTED real
        // (ECONNREFUSED), jamás un error simulado.
        const deadPool =
            createTestPool({
                host: '127.0.0.1',
                port: 59999,
                connectionTimeoutMillis: 300
            });

        const { server, tempRoot } =
            await makeE2EContext(
                new E2EMediaRepository(),
                deadPool
            );

        t.after(async () => {
            server.server.close();
            await deadPool.end();
        });

        const body =
            new Uint8Array(Buffer.from('se-va-a-rollback'));

        const res = await fetch(
            `http://127.0.0.1:${server.port}/api/upload?filename=caso-a.mp4`,
            { method: 'POST', body }
        );

        assert.equal(res.status, 500);
        const payload = await res.json() as {
            error: string;
        };
        assert.equal(payload.error, 'CATALOG_ERROR');

        // ROLLBACK REAL: no existe el binario, ni el temporal, ni el lock
        assert.ok(
            !existsSync(
                join(tempRoot, 'public', 'videos', 'caso-a.mp4')
            ),
            'el binario debe haberse eliminado (certeza de no-persistencia)'
        );
        const entries = await videosDirEntries(tempRoot);
        assert.deepEqual(
            entries,
            [],
            'sin archivo, sin .tmp, sin .lock'
        );

        // La DB REAL quedó sin la fila (el pool muerto no pudo escribir)
        assert.equal(
            (await pool.query(
                "SELECT COUNT(*)::int AS n FROM videos "
                + "WHERE relative_path = 'caso-a.mp4'"
            )).rows[0]!.n,
            0
        );
    }
);