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

import type {
    MediaRepository
} from '../../src/domain/repositories/MediaRepository.js';

import type {
    VideoMediaInfo
} from '../../src/domain/types/media.types.js';

import {
    createTestPool,
    dbSkipReason,
    truncateVideos,
    buildStoredMetadata
} from './helpers.js';

/**
 * INTEGRATION — CatalogSyncJob con filesystem REAL + PostgreSQL REAL
 * (videocatalog_test) + fake del MEDIA (ffprobe/ffmpeg), escribiendo la
 * thumbnail REALMENTE en disco (la fase 3 decide con existsSync() real).
 *
 * THUMBNAILS_DIR se resuelve con process.cwd() AL IMPORTAR el módulo →
 * cada test usa chdir a un tempRoot NUEVO + import dinámico con cache-bust
 * (?fresh=) que re-evalúa la constante contra el cwd vigente.
 *
 * Gating: idéntico al resto de las suites (helpers.dbSkipReason).
 */

const pool = createTestPool();
const skip = await dbSkipReason(pool);

const pgRepo = new PostgresVideoRepository(pool);

const DEFAULT_MEDIA_INFO: VideoMediaInfo = {
    duration: 10,
    width: 1920,
    height: 1080,
    videoCodec: 'h264'
};

/**
 * Fake del adaptador de media: metadata configurable y getVideoThumbnail
 * que ESCRIBE el archivo destino real — la fase 3 del sync (existsSync)
 * y los asserts del test ven el efecto REAL en disco.
 */
class FakeMediaRepository
    implements MediaRepository {

    /** ffprobe falla N veces (archivos corruptos) */
    videoInfoFailures = 0;

    /** Destinos que el fake "generó" (para asserts de llamado) */
    readonly thumbnailTargets: string[] = [];

    async getVideoInfo(): Promise<VideoMediaInfo> {
        if (this.videoInfoFailures > 0) {
            this.videoInfoFailures--;
            throw new Error('ffprobe: corrupt file');
        }
        return DEFAULT_MEDIA_INFO;
    }

    async getVideoThumbnail(
        _absoluteVideoPath: string,
        thumbnailPath: string
    ): Promise<void> {
        this.thumbnailTargets.push(thumbnailPath);
        await mkdir(dirname(thumbnailPath), { recursive: true });
        await writeFile(thumbnailPath, 'FAKE-JPEG');
    }
}

// ─── Contexto por test: FS aislado + import fresco del sync ───────────────

let originalCwd = process.cwd();
let tempRoot: string | undefined;
let syncModule: typeof import(
    '../../src/application/services/CatalogSyncJob.js'
) | undefined;

async function makeSyncContext() {
    // chdir repetido: limpiar el temp anterior
    if (tempRoot !== undefined) {
        process.chdir(originalCwd);
        await rm(tempRoot, { recursive: true, force: true });
    }

    tempRoot = await mkdtemp(join(tmpdir(), 'catalogsync-'));

    // Estructura que espera la app: public/videos + public/thumbnails
    await mkdir(join(tempRoot, 'public', 'videos'), {
        recursive: true
    });
    await mkdir(join(tempRoot, 'public', 'thumbnails'), {
        recursive: true
    });

    process.chdir(tempRoot);

    // Import FRESCO: re-evalúa THUMBNAILS_DIR contra el cwd VIGENTE.
    // El ?fresh= es cache-bust del módulo (specifier distinto por test).
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

/** Escribe un "video" real en public/videos (recursivo si tiene /) */
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

// ─── Fase 1: filas huérfanas (PG − FS) ───────────────────────────────────

test(
    'fase 1: fila sin archivo físico → se borra LA FILA (el archivo '
    + 'inexistente ya no está; nada físico se toca)',
    { skip },
    async () => {
        await truncateVideos(pool);
        const { sync } = await makeSyncContext();

        // Fila en PG sin archivo correspondiente (huérfana de verdad)
        await pgRepo.save(buildStoredMetadata('fantasma.mp4'));

        const result = await sync.run();

        assert.deepEqual(result, {
            orphanRowsDeleted: 1,
            filesCataloged: 0,
            thumbnailsGenerated: 0
        });

        assert.equal(
            (await pgRepo.listAll()).length,
            0,
            'la fila huérfana debe desaparecer del catálogo'
        );
    }
);

// ─── Fase 2: archivos sin metadata (FS − PG) ─────────────────────────────

test(
    'fase 2: archivo sin fila se cataloga con ffprobe y genera thumbnail; '
    + 'el id converge con UploadService (base64url) y el size es el REAL',
    { skip },
    async () => {
        await truncateVideos(pool);
        const { sync } = await makeSyncContext();

        // Incluye una subcarpeta: listVideos real es recursivo y
        // la normalización \ → / produce relativePath con slash.
        await createVideoFile('nuevo.mp4');
        await createVideoFile('carpeta/anidado.mp4');

        const result = await sync.run();

        assert.deepEqual(result, {
            orphanRowsDeleted: 0,
            filesCataloged: 2,
            thumbnailsGenerated: 2
        });

        const rows = await pgRepo.listAll();
        assert.equal(rows.length, 2);

        const flat = rows.find((r) =>
            r.relativePath === 'nuevo.mp4')!;
        assert.ok(flat);

        // Convergencia con UploadService: mismo id y misma mediaInfo
        assert.equal(
            flat.id,
            Buffer.from('nuevo.mp4').toString('base64url')
        );
        assert.deepEqual(flat.mediaInfo, DEFAULT_MEDIA_INFO);
        // El size es el REAL del filesystem (no el del fake)
        assert.equal(flat.size, 'bytes-de-prueba'.length);

        const nested = rows.find((r) =>
            r.relativePath === 'carpeta/anidado.mp4')!;
        assert.ok(nested);

        // Thumbnails REALES en disco
        assert.ok(
            existsSync(thumbnailPathOf('nuevo.mp4')),
            'thumbnail del archivo plano debe existir'
        );
        assert.ok(
            existsSync(thumbnailPathOf('carpeta/anidado.mp4')),
            'thumbnail del archivo anidado debe existir'
        );
    }
);

test(
    'fase 2b: ffprobe falla → archivo OMITIDO sin fila (reintento futuro), '
    + 'jamás una fila sin metadata',
    { skip },
    async () => {
        await truncateVideos(pool);
        const { sync, mediaRepo } =
            await makeSyncContext();

        await createVideoFile('corrupto.mp4');
        mediaRepo.videoInfoFailures = 1;

        const result = await sync.run();

        assert.deepEqual(result, {
            orphanRowsDeleted: 0,
            filesCataloged: 0,
            thumbnailsGenerated: 0
        });

        assert.equal(
            (await pgRepo.listAll()).length,
            0,
            'sin metadata no hay fila (duration es NOT NULL)'
        );
        assert.ok(
            existsSync(
                join(tempRoot!, 'public', 'videos', 'corrupto.mp4')
            ),
            'el archivo físico NO se toca jamás'
        );
    }
);

// ─── Fase 3: thumbnails faltantes (FS ∩ PG) ───────────────────────────────

test(
    'fase 3: fila + archivo con thumbnail faltante → genera SOLO el '
    + 'thumbnail (no recataloga: filesCataloged 0)',
    { skip },
    async () => {
        await truncateVideos(pool);
        const { sync } = await makeSyncContext();

        // Fila + archivo real, thumbnail ausente
        await createVideoFile('viejo.mp4');
        let stored =
            buildStoredMetadata('viejo.mp4');
        stored = {
            ...stored,
            size: 'bytes-de-prueba'.length
        };
        await pgRepo.save(stored);

        const result = await sync.run();

        assert.deepEqual(result, {
            orphanRowsDeleted: 0,
            filesCataloged: 0,
            thumbnailsGenerated: 1
        });

        assert.ok(
            existsSync(thumbnailPathOf('viejo.mp4')),
            'el thumbnail faltante se regeneró'
        );
    }
);

test(
    'fase 3b + idempotencia: con todo convergente (fila + archivo + '
    + 'thumbnail) la 2da corrida es 0/0/0 — nada se toca dos veces',
    { skip },
    async () => {
        await truncateVideos(pool);
        const { sync } = await makeSyncContext();

        await createVideoFile('estable.mp4');
        let stored =
            buildStoredMetadata('estable.mp4');
        stored = { ...stored, size: 'bytes-de-prueba'.length };
        await pgRepo.save(stored);
        await writeFile(thumbnailPathOf('estable.mp4'), 'JPEG');

        const first = await sync.run();
        const second = await sync.run();

        assert.deepEqual(first, {
            orphanRowsDeleted: 0,
            filesCataloged: 0,
            thumbnailsGenerated: 0
        });
        assert.deepEqual(
            second,
            { orphanRowsDeleted: 0, filesCataloged: 0, thumbnailsGenerated: 0 },
            'la corrida sobre un filesystem estable no encuentra diferencias'
        );

        // Ni una fila duplicada tras las dos corridas
        assert.equal((await pgRepo.listAll()).length, 1);
    }
);

// ─── Consistencia end-to-end del sync ─────────────────────────────────────

test(
    'reconciliación completa: huérfana + nueva + convergente en UNA corrida',
    { skip },
    async () => {
        await truncateVideos(pool);
        const { sync } = await makeSyncContext();

        // Huérfana (solo fila)
        await pgRepo.save(buildStoredMetadata('solo-fila.mp4'));
        // Convergente (fila + archivo + thumbnail)
        await createVideoFile('lista.mp4');
        let stored =
            buildStoredMetadata('lista.mp4');
        stored = { ...stored, size: 'bytes-de-prueba'.length };
        await pgRepo.save(stored);
        await writeFile(thumbnailPathOf('lista.mp4'), 'JPEG');
        // Nueva (solo archivo → recatalogar)
        await createVideoFile('fresca.mp4');

        const result = await sync.run();

        assert.deepEqual(result, {
            orphanRowsDeleted: 1,
            filesCataloged: 1,
            thumbnailsGenerated: 1
        });

        const paths =
            (await pgRepo.listAll()).map((r) =>
                r.relativePath).sort();
        assert.deepEqual(paths, ['fresca.mp4', 'lista.mp4']);
    }
);