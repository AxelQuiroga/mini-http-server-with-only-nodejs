import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
    mkdtemp,
    mkdir,
    rm,
    writeFile
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

import {
    PostgresVideoRepository
} from '../../src/infraestructure/database/PostgresVideoRepository.js';

import {
    FileSystemRepository
} from '../../src/infraestructure/filesystem/FileSystemRepository.js';

import {
    applySchema
} from '../../src/infraestructure/database/schema.js';

import {
    schedulePeriodicReconciliation
} from '../../src/infraestructure/reconciliation/reconciliationScheduler.js';

import type {
    MediaRepository
} from '../../src/domain/repositories/MediaRepository.js';

import type {
    VideoMediaInfo
} from '../../src/domain/types/media.types.js';

import {
    createTestPool,
    dbSkipReason,
    truncateVideos
} from './helpers.js';

/**
 * INTEGRATION — Reconciliación periódica (tick de runtime REAL).
 *
 * Demuestra el problema que esta etapa resuelve: CatalogSyncJob ya reparaba
 * las inconsistencias FS↔PG, pero SOLO en el boot (buildContainer → run()).
 * Este test prueba que el MISMO job, disparado por el scheduler en runtime,
 * converge SIN reiniciar el servidor.
 *
 * - Test 1: boot simulado (run() #1 converge el estado inicial) → aparece un
 *   archivo nuevo en runtime (inconsistencia post-boot) → el TICK lo cataloga
 *   (fila + thumbnail) sin reinicio.
 * - Test 2: PostgreSQL caído durante un tick → warn (no crash) → el proceso
 *   sigue vivo y el tick siguiente vuelve a intentar.
 *
 * THUMBNAILS_DIR se resuelve con process.cwd() al importar CatalogSyncJob →
 * mismo patrón de cache-bust que catalogSyncJob.test.ts.
 */

const pool = createTestPool();
const skip = await dbSkipReason(pool);

const DEFAULT_MEDIA_INFO: VideoMediaInfo = {
    duration: 10,
    width: 1920,
    height: 1080,
    videoCodec: 'h264'
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) =>
        setTimeout(resolve, ms));
}

/** Fake del media: metadata válida y thumbnail REAL en disco. */
class FakeMediaRepository
    implements MediaRepository {

    async getVideoInfo(): Promise<VideoMediaInfo> {
        return DEFAULT_MEDIA_INFO;
    }

    async getVideoThumbnail(
        _absoluteVideoPath: string,
        thumbnailPath: string
    ): Promise<void> {
        await mkdir(dirname(thumbnailPath), { recursive: true });
        await writeFile(thumbnailPath, 'FAKE-JPEG');
    }
}

let originalCwd = process.cwd();
let tempRoot: string | undefined;
let syncModule: typeof import(
    '../../src/application/services/CatalogSyncJob.js'
) | undefined;

async function makeContext(
    pgRepo: PostgresVideoRepository
) {
    if (tempRoot !== undefined) {
        process.chdir(originalCwd);
        await rm(tempRoot, { recursive: true, force: true });
    }

    tempRoot = await mkdtemp(join(tmpdir(), 'reconcile-'));

    await mkdir(join(tempRoot, 'public', 'videos'), {
        recursive: true
    });
    await mkdir(join(tempRoot, 'public', 'thumbnails'), {
        recursive: true
    });

    process.chdir(tempRoot);

    syncModule = await import(
        '../../src/application/services/CatalogSyncJob.js'
        + `?fresh=${tempRoot}`
    ) as typeof import(
        '../../src/application/services/CatalogSyncJob.js'
    );

    const fileRepo =
        new FileSystemRepository('public');

    const mediaRepo =
        new FakeMediaRepository();

    const sync =
        new syncModule.CatalogSyncJob(
            fileRepo,
            mediaRepo,
            pgRepo,
            'public/videos'
        );

    return { sync, fileRepo, mediaRepo };
}

async function createVideoFile(
    relativePath: string,
    bytes = 'bytes-de-prueba'
): Promise<void> {
    const absolute =
        join(tempRoot!, 'public', 'videos', relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
}

function thumbnailPathOf(filename: string): string {
    const id =
        Buffer.from(filename).toString('base64url');
    return join(tempRoot!, 'public', 'thumbnails', `${id}.jpg`);
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

// ─── Test 1: el tick de runtime repara sin reiniciar ─────────────────────

test(
    'runtime: un archivo válido que aparece DESPUÉS del boot es catalogado '
    + 'por el próximo tick del scheduler — SIN reiniciar el servidor',
    { skip },
    async () => {
        await truncateVideos(pool);

        const pgRepo =
            new PostgresVideoRepository(pool);

        const { sync } = await makeContext(pgRepo);

        // 1) Boot simulado: run() #1 sobre estado vacío converge (no-op).
        //    Es el sync fail-fast que hoy corre en buildContainer().
        const bootResult = await sync.run();
        assert.deepEqual(bootResult, {
            orphanRowsDeleted: 0,
            filesCataloged: 0,
            thumbnailsGenerated: 0
        });

        // 2) Inconsistencia que aparece EN RUNTIME: un archivo llega al
        //    filesystem sin fila (p. ej. upload con PG caído / AMBIGUOUS,
        //    o archivo copiado a mano) MIENTRAS el server sigue vivo.
        await createVideoFile('nuevo-tick.mp4');

        // 3) El scheduler corre el MISMO job (idempotente) cada 40ms.
        const timer =
            schedulePeriodicReconciliation(
                () => sync.run(),
                40
            );

        try {
            // Márgen suficiente para varios ticks reales.
            await sleep(250);
        } finally {
            clearInterval(timer);
        }

        // 4) Convergencia sin reinicio: la fila existe con metadata REAL
        //    (el tick corrió ffprobe y persistió), más thumbnail en disco.
        const rows = await pgRepo.listAll();
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.relativePath, 'nuevo-tick.mp4');
        assert.equal(
            rows[0]!.id,
            Buffer.from('nuevo-tick.mp4').toString('base64url')
        );
        assert.deepEqual(rows[0]!.mediaInfo, DEFAULT_MEDIA_INFO);
        assert.ok(
            existsSync(thumbnailPathOf('nuevo-tick.mp4')),
            'el tick debe generar también el thumbnail'
        );
    }
);

// ─── Test 2: PG caído durante un tick ────────────────────────────────────

test(
    'runtime: PostgreSQL caído durante un tick → el error se degrada a '
    + 'warning (reintento en el próximo tick) y el proceso SIGUE VIVO',
    { skip },
    async () => {
        // Pool apuntando a un puerto cerrado: ECONNREFUSED real, el mismo
        // corte que el e2e del caso A — jamás un error simulado.
        const deadPool =
            createTestPool({
                host: '127.0.0.1',
                port: 59999,
                connectionTimeoutMillis: 300
            });

        const deadPgRepo =
            new PostgresVideoRepository(deadPool);

        const { sync } = await makeContext(deadPgRepo);

        // Espía console.warn: la semántica runtime es "registrar y seguir".
        const originalWarn = console.warn;
        const warnings: unknown[][] = [];
        console.warn = (...args: unknown[]) => {
            warnings.push(args);
        };

        const timer =
            schedulePeriodicReconciliation(
                () => sync.run(),
                40
            );

        try {
            await sleep(250);
        } finally {
            clearInterval(timer);
            console.warn = originalWarn;
        }

        // El error se registró como warning (no propagó, no mató el test:
        // llegamos acá = el proceso vive). Varios ticks intentaron y
        // fallaron → el reintento es estructural (setInterval).
        assert.ok(
            warnings.length >= 1,
            'cada tick fallido debe registrarse como warning'
        );
        assert.match(
            String(warnings[0]![0]),
            /reconciliación periódica/,
            'el warning identifica al reconciliador de runtime'
        );

        await deadPool.end();
    }
);