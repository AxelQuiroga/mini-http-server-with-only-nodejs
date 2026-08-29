import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VideoService } from '../src/application/services/VideoService.js';

import type { VideoRepository } from '../src/domain/repositories/VideoRepository.js';
import type { StoredVideoMetadata } from '../src/domain/types/catalog.types.js';
import type { VideoMediaInfo } from '../src/domain/types/media.types.js';

/**
 * READ PATH (GET /api/videos) — VideoService ya NO inspecciona contenido:
 * el constructor acepta SOLO el VideoRepository (PostgreSQL). No hay
 * ffprobe, no hay ffmpeg, no hay filesystem: el mapeo fila → VideoMetadata
 * es una función pura. Cualquier reintento de dependencia multimedia en el
 * read rompe la firma del constructor y, con ella, todos estos tests.
 */

const b64 = (relativePath: string): string =>
    Buffer.from(relativePath).toString('base64url');

const ID = b64('e2e.mp4');

const MIN_MEDIA_INFO: VideoMediaInfo = {
    duration: 10,
    width: 1920,
    height: 1080,
    videoCodec: 'h264'
};

function row(
    overrides: Partial<StoredVideoMetadata> = {}
): StoredVideoMetadata {
    return {
        id: ID,
        relativePath: 'e2e.mp4',
        fileName: 'e2e.mp4',
        size: 1024,
        extension: '.mp4',
        mediaInfo: MIN_MEDIA_INFO,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        ...overrides
    };
}

class FakeVideoRepository
    implements VideoRepository {

    listAllCalls = 0;

    constructor(
        private readonly rows: StoredVideoMetadata[]
    ) {}

    async save(_metadata: StoredVideoMetadata): Promise<void> {
        // no-op: el read path nunca escribe
    }

    async listAll(): Promise<StoredVideoMetadata[]> {
        this.listAllCalls += 1;
        return this.rows;
    }

    async deleteByRelativePath(
        _relativePath: string
    ): Promise<void> {
        // no-op: solo lo usa CatalogSyncJob
    }
}

async function getAll(rows: StoredVideoMetadata[]) {
    const service = new VideoService(
        new FakeVideoRepository(rows)
    );
    return service.getAllVideos();
}

test(
    'mapea la fila persistida al shape HTTP EXACTO del frontend '
    + '(mismas claves, sin campos extra ni faltantes)',
    async () => {
        const videos = await getAll([row()]);

        assert.deepEqual(videos, [{
            id: ID,
            title: 'E2e',
            fileName: 'e2e.mp4',
            size: 1024,
            extension: '.mp4',
            streamUrl: '/videos/e2e.mp4',
            mediaInfo: MIN_MEDIA_INFO,
            thumbnailUrl: `/thumbnails/${ID}.jpg`
        }]);
    }
);

test(
    'deriva títulos, streamUrl e id desde filas en subcarpetas '
    + '(el sync cataloga anidadas)',
    async () => {
        const nestedPath = 'carpeta/anidado.mp4';
        const nestedId = b64(nestedPath);

        const videos = await getAll([
            row({
                id: nestedId,
                relativePath: nestedPath,
                fileName: 'anidado.mp4'
            })
        ]);

        assert.deepEqual(videos, [{
            id: nestedId,
            title: 'Anidado',
            fileName: 'anidado.mp4',
            size: 1024,
            extension: '.mp4',
            streamUrl: '/videos/carpeta/anidado.mp4',
            mediaInfo: MIN_MEDIA_INFO,
            thumbnailUrl: `/thumbnails/${nestedId}.jpg`
        }]);
    }
);

test(
    'metadata opcional ausente (audioCodec/fps NULL en DB): el item '
    + 'NO expone esas propiedades — jamás nulls fantasma',
    async () => {
        const videos = await getAll([
            row({ mediaInfo: MIN_MEDIA_INFO })
        ]);

        const mediaInfo = videos[0]!.mediaInfo;
        assert.ok(mediaInfo);
        assert.deepEqual(mediaInfo, MIN_MEDIA_INFO);
        assert.equal(
            'audioCodec' in mediaInfo,
            false,
            'el frontend desestructura estos campos: ausencia ≠ null'
        );
        assert.equal(
            'fps' in mediaInfo,
            false
        );
    }
);

test(
    'preserva el orden del repository (created_at DESC ya viene de DB); '
    + 'el service no lo altera ni reordena',
    async () => {
        const nuevo = row({
            id: b64('nuevo.mp4'),
            relativePath: 'nuevo.mp4',
            fileName: 'nuevo.mp4',
            createdAt: new Date('2026-02-01T00:00:00Z')
        });
        const viejo = row({
            id: b64('viejo.mp4'),
            relativePath: 'viejo.mp4',
            fileName: 'viejo.mp4',
            createdAt: new Date('2026-01-01T00:00:00Z')
        });

        // El fake devuelve lo que la DB ya ordenó (DESC)
        const videos = await getAll([nuevo, viejo]);

        assert.deepEqual(
            videos.map((v) => v.fileName),
            ['nuevo.mp4', 'viejo.mp4']
        );
    }
);

test(
    'el read consulta el catálogo UNA sola vez (única fuente: PostgreSQL)',
    async () => {
        const fake = new FakeVideoRepository([row()]);
        const service = new VideoService(fake);

        const videos = await service.getAllVideos();
        await service.getAllVideos();

        assert.equal(fake.listAllCalls, 2);
        assert.equal(videos.length, 1);
    }
);