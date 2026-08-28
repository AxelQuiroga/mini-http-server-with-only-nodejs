import { join, parse } from 'node:path';
import { existsSync } from 'node:fs';

import type {
    FileRepository
} from '../../domain/repositories/FileRepository.js';

import type {
    MediaRepository
} from '../../domain/repositories/MediaRepository.js';

import type {
    VideoRepository
} from '../../domain/repositories/VideoRepository.js';

import type {
    StoredVideoMetadata
} from '../../domain/types/catalog.types.js';

import type {
    VideoMediaInfo
} from '../../domain/types/media.types.js';

const THUMBNAILS_DIR =
    join(process.cwd(), 'public', 'thumbnails');

export interface CatalogSyncResult {
    orphanRowsDeleted: number;
    filesCataloged: number;
    thumbnailsGenerated: number;
}

/**
 * Reconciliación filesystem ↔ PostgreSQL (fuente de verdad dual, ver ADR).
 *
 * Corre SECUENCIALMENTE en el startup, DESPUÉS del schema y ANTES de listen()
 * (sin escritores concurrentes → el snapshot es coherente). Además es la
 * MIGRACIÓN inicial: la primera corrida con DB vacía cataloga todo lo existente.
 *
 * Fases (sets calculados del MISMO snapshot — idempotencia estructural):
 *   1. PG − FS   → filas huérfanas → deleteByRelativePath (SOLO filas)
 *   2. FS − PG   → ffprobe → save() → thumbnail  (archivos sin metadata)
 *   3. FS ∩ PG   → ensureThumbnail (no-op si el .jpg existe) — regeneración
 *                  de thumbnails fallidos en uploads previos
 *
 * Reglas de oro:
 *   - El sync NUNCA elimina archivos físicos (solo filas de PostgreSQL).
 *   - ffprobe falla → archivo OMITIDO con warn (reintentado en el próximo
 *     sync); jamás crea una fila sin metadata (duration es NOT NULL).
 *   - PostgreSQL falla → PROPAGA (fail-fast): PG caído es un fallo sistémico,
 *     no un problema del archivo; tragarse el error arrancaría un server con
 *     catálogo incompleto en silencio, violando la invariante "PG obligatorio".
 *   - Thumbnail falla → warn + la fila YA quedó guardada (el save es anterior
 *     al thumbnail a propósito); la fase 3 regenera en el próximo sync.
 *
 * Idempotencia: los sets se recalculan frescos en cada corrida → sobre un
 * filesystem estable la segunda corrida no encuentra diferencias (cero
 * borrados, cero salvados, cero thumbnails: todos no-op).
 *
 * Limitación conocida (documentada, aceptada — ver ADR D4):
 *   La reconciliación es de PRESENCIA/AUSENCIA. NO detecta un archivo
 *   REEMPLAZADO/MODIFICADO que conserva el mismo relativePath (mismo
 *   nombre y posición): la fila existente conserva metadata vieja hasta
 *   que un evento la sobreescriba (un upload del mismo nombre vía
 *   ON CONFLICT). Resolverlo exige content-address (hash/checksum) o
 *   mtime — decidido fuera de alcance de esta etapa, SIN columnas nuevas.
 */
export class CatalogSyncJob {

    private readonly absoluteVideosFolderPath: string;

    constructor(
        private readonly fileRepository: FileRepository,
        private readonly mediaRepository: MediaRepository,
        private readonly videoRepository: VideoRepository,
        videosFolder: string = 'public/videos'
    ) {
        this.absoluteVideosFolderPath =
            join(process.cwd(), videosFolder);
    }

    async run(): Promise<CatalogSyncResult> {

        // ─── Snapshot único ─────────────────────────────────────────────
        const rows =
            await this.videoRepository.listAll();

        const files =
            (await this.fileRepository.listVideos())
                // Normalización EXACTA de VideoService.mapToVideoMetadata
                .map((path) =>
                    path.replace(/\\/g, '/')
                );

        const rowPaths =
            new Set(rows.map((r) =>
                r.relativePath));

        const filePaths =
            new Set(files);

        const rowByPath =
            new Map(rows.map((r) =>
                [r.relativePath, r] as const));

        let orphanRowsDeleted = 0;
        let filesCataloged = 0;
        let thumbnailsGenerated = 0;

        // ─── Fase 1: filas huérfanas (PG − FS) ──────────────────────────
        for (const row of rows) {
            if (filePaths.has(row.relativePath)) {
                continue;
            }

            await this.videoRepository
                .deleteByRelativePath(row.relativePath);

            orphanRowsDeleted++;

            console.log(
                `[CatalogSyncJob] fila huérfana eliminada: ${row.relativePath}`
            );
        }

        // ─── Fase 2: archivos sin metadata (FS − PG) ────────────────────
        for (const relativePath of files) {
            if (rowPaths.has(relativePath)) {
                continue;
            }

            const outcome =
                await this.catalogFile(relativePath);

            if (outcome.cataloged) {
                filesCataloged++;
            }

            if (outcome.thumbnailGenerated) {
                thumbnailsGenerated++;
            }
        }

        // ─── Fase 3: thumbnails faltantes (FS ∩ PG) ─────────────────────
        for (const relativePath of files) {
            const row =
                rowByPath.get(relativePath);

            if (!row) {
                continue;
            }

            if (await this.ensureThumbnail(
                relativePath,
                row.id
            )) {
                thumbnailsGenerated++;
            }
        }

        console.log(
            `[CatalogSyncJob] resumen: ${orphanRowsDeleted} filas huérfanas, ` +
            `${filesCataloged} archivos catalogados, ` +
            `${thumbnailsGenerated} thumbnails generados`
        );

        return {
            orphanRowsDeleted,
            filesCataloged,
            thumbnailsGenerated
        };
    }

    /**
     * FS − PG: ffprobe → construir metadata → save() → thumbnail.
     * Devuelve qué pasó (para el resumen y los tests).
     */
    private async catalogFile(
        relativePath: string
    ): Promise<{
        cataloged: boolean;
        thumbnailGenerated: boolean;
    }> {

        const id =
            Buffer.from(relativePath)
                .toString('base64url');

        const absoluteFilePath =
            join(
                this.absoluteVideosFolderPath,
                relativePath
            );

        // ffprobe — fallo de ARCHIVO: se omite con warn, se reintenta
        // en el próximo sync. Sin metadata no hay fila válida (NOT NULL).
        let mediaInfo: VideoMediaInfo;

        try {
            mediaInfo =
                await this.mediaRepository
                    .getVideoInfo(absoluteFilePath);
        } catch (error) {
            console.warn(
                `[CatalogSyncJob] ffprobe falló, archivo omitido ` +
                `(reintento en próximo sync): ${relativePath}`
            );
            return {
                cataloged: false,
                thumbnailGenerated: false
            };
        }

        const fileServicePath =
            join('videos', relativePath);

        const { size, extension } =
            this.fileRepository
                .getFileMetadata(fileServicePath);

        const stored: StoredVideoMetadata = {
            id,
            relativePath,
            fileName: parse(relativePath).base,
            size,
            extension,
            mediaInfo,
            // La DB gobierna los timestamps (now()): save() ignora estos
            // valores; el dominio los recibe de vuelta en listAll().
            createdAt: new Date(),
            updatedAt: new Date()
        };

        // save() — los errores de PG PROPAGAN (fail-fast). El thumbnail
        // va DESPUÉS: si falla, la fila ya quedó persistida.
        await this.videoRepository.save(stored);

        const thumbnailGenerated =
            await this.ensureThumbnail(
                relativePath,
                id
            );

        console.log(
            `[CatalogSyncJob] catalogado: ${relativePath}` +
            (thumbnailGenerated
                ? ' (thumbnail generado)'
                : ' (thumbnail pendiente)')
        );

        return {
            cataloged: true,
            thumbnailGenerated
        };
    }

    /**
     * Genera el thumbnail SOLO si falta (existsSync → no-op).
     * Retorna true si se generó. Falla → warn, sin propagar (best-effort).
     */
    private async ensureThumbnail(
        relativePath: string,
        id: string
    ): Promise<boolean> {

        const thumbnailPath =
            join(THUMBNAILS_DIR, `${id}.jpg`);

        if (existsSync(thumbnailPath)) {
            return false;
        }

        try {
            await this.mediaRepository.getVideoThumbnail(
                join(
                    this.absoluteVideosFolderPath,
                    relativePath
                ),
                thumbnailPath
            );
            return true;
        } catch (error) {
            console.warn(
                `[CatalogSyncJob] thumbnail falló ` +
                `(reintento en próximo sync): ${relativePath}`
            );
            return false;
        }
    }
}