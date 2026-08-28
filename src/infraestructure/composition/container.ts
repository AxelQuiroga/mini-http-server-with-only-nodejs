import type { Pool } from 'pg';

import { FileSystemRepository } from '../filesystem/FileSystemRepository.js';
import { FFmpegMediaRepository } from '../media/FFmpegMediaRepository.js';
import { PostgresVideoRepository } from '../database/PostgresVideoRepository.js';
import { createPool } from '../database/pool.js';
import { applySchema } from '../database/schema.js';

import { VideoService } from '../../application/services/VideoService.js';
import { UploadService } from '../../application/services/UploadService.js';
import { CatalogSyncJob } from '../../application/services/CatalogSyncJob.js';

import { StaticFileController } from '../../presentation/controllers/StaticFileController.js';
import { VideoController } from '../../presentation/controllers/VideoController.js';
import { UploadController } from '../../presentation/controllers/UploadController.js';

import type {
    FileRepository
} from '../../domain/repositories/FileRepository.js';

import type {
    MediaRepository
} from '../../domain/repositories/MediaRepository.js';

import type {
    VideoRepository
} from '../../domain/repositories/VideoRepository.js';

/**
 * Composition root (ADR §11).
 *
 * ÚNICA capa del sistema que conoce las implementaciones concretas y las
 * instancia. Ningún service crea Pool, repositorios ni infraestructura:
 * todos reciben sus dependencias por constructor.
 *
 * Orden del bootstrap (fail-fast, sin modo degradado):
 *   pool → SELECT 1 → schema → repositories → services → sync → controllers
 * Cualquier paso obligatorio que falle aborta ANTES de server.listen().
 */
export interface Container {
    pool: Pool;
    fileRepository: FileRepository;
    mediaRepository: MediaRepository;
    videoRepository: VideoRepository;
    videoService: VideoService;
    uploadService: UploadService;
    catalogSyncJob: CatalogSyncJob;
    staticFileController: StaticFileController;
    videoController: VideoController;
    uploadController: UploadController;
}

export async function buildContainer(): Promise<Container> {

    // 1. Pool único (PGPASSWORD obligatoria → DatabaseConfigError accionable)
    const pool = createPool();

    // 2. Verificación de conexión — fail-fast. PG caído = proceso muerto
    //    ANTES de listen(); jamás un server con catálogo parcial.
    try {
        await pool.query('SELECT 1');
    } catch (error) {
        console.error(
            '[bootstrap] No se pudo conectar a PostgreSQL. ' +
            'Verificá que el servicio esté activo ' +
            '(sudo service postgresql start) y que el .env ' +
            'tenga las variables PG* correctas.'
        );
        throw error;
    }

    // 3. Schema idempotente (db/migrations/*.sql)
    await applySchema(pool);

    // 4. Repositorios concretos
    const fileRepository: FileRepository =
        new FileSystemRepository();

    const mediaRepository: MediaRepository =
        new FFmpegMediaRepository();

    const videoRepository: VideoRepository =
        new PostgresVideoRepository(pool);

    // Limpieza de uploads huérfanos (sube desde server.ts:
    // mismo momento de ejecución que el sync, responsabilidad separada)
    await fileRepository.cleanOrphanUploads();

    // 5. Services — inyección por constructor
    const videoService = new VideoService(
        fileRepository,
        mediaRepository
    );

    const uploadService = new UploadService(
        fileRepository,
        mediaRepository,
        videoRepository
    );

    const catalogSyncJob = new CatalogSyncJob(
        fileRepository,
        mediaRepository,
        videoRepository
    );

    // 6. Sync del catálogo — fail-fast: un error de PG aquí propaga
    //    (save/deleteByRelativePath lanzan) y el proceso muere.
    const syncResult =
        await catalogSyncJob.run();

    console.log(
        `[bootstrap] Catálogo sincronizado: ` +
        `${syncResult.orphanRowsDeleted} filas huérfanas, ` +
        `${syncResult.filesCataloged} archivos catalogados, ` +
        `${syncResult.thumbnailsGenerated} thumbnails regenerados`
    );

    // 7. Controllers
    const staticFileController =
        new StaticFileController(fileRepository);

    const videoController =
        new VideoController(videoService);

    const uploadController =
        new UploadController(uploadService);

    return {
        pool,
        fileRepository,
        mediaRepository,
        videoRepository,
        videoService,
        uploadService,
        catalogSyncJob,
        staticFileController,
        videoController,
        uploadController
    };
}