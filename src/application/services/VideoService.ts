import { parse } from 'node:path';

import type { VideoRepository } from '../../domain/repositories/VideoRepository.js';
import type { StoredVideoMetadata } from '../../domain/types/catalog.types.js';
import type { VideoMetadata } from '../../domain/types/video.types.js';

/**
 * Proyección del catálogo para el frontend (GET /api/videos).
 *
 * READ PATH = SELECT puro: el catálogo se lee de PostgreSQL (VideoRepository),
 * la fuente de verdad de la metadata calculada UNA sola vez durante el write
 * path (upload/sync). Este servicio NO ejecuta ffprobe, NO ejecuta ffmpeg y
 * NO escanea public/videos: mapea filas persistidas al contrato HTTP
 * (VideoMetadata). El costo de procesar contenido aparece cuando hay
 * contenido NUEVO, jamás por consulta.
 *
 * La convergencia fila ↔ archivo físico la garantiza CatalogSyncJob en el
 * bootstrap (filas ∖ archivos → delete; archivos ∖ filas → save).
 */
export class VideoService {

    constructor(
        private readonly videoRepository: VideoRepository
    ) {}

    async getAllVideos(): Promise<VideoMetadata[]> {
        const rows = await this.videoRepository.listAll();
        return rows.map((row) =>
            this.mapRowToVideoMetadata(row)
        );
    }

    private mapRowToVideoMetadata(
        row: StoredVideoMetadata
    ): VideoMetadata {
        const parsedName = parse(row.relativePath).name;

        return {
            id: row.id,
            title: this.formatTitle(parsedName),
            fileName: row.fileName,
            size: row.size,
            extension: row.extension,
            streamUrl: `/videos/${row.relativePath}`,
            // La URL se CONSTRUYE con el id convergente (base64url del
            // relativePath, mismo algoritmo en upload/sync/read). El read
            // no verifica ni genera el thumbnail: si el .jpg falta, es una
            // inconsistencia que CatalogSyncJob reconcilia en el bootstrap.
            mediaInfo: row.mediaInfo,
            thumbnailUrl: `/thumbnails/${row.id}.jpg`
        };
    }

    private formatTitle(rawName: string): string {
        return rawName
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }
}