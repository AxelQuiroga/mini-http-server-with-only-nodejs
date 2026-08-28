import type { Pool } from 'pg';

import type {
    StoredVideoMetadata
} from '../../domain/types/catalog.types.js';

import type {
    VideoRepository
} from '../../domain/repositories/VideoRepository.js';

/**
 * Fila cruda de la tabla `videos` (PG types).
 *
 * GOTCHA de node-postgres: BIGINT (int8) se entrega como STRING para
 * evitar pérdida de precisión > 2^53 — `size` se convierte con Number().
 * INTEGER (int4) y DOUBLE PRECISION llegan como number; TIMESTAMPTZ como Date.
 */
interface VideoRow {
    id: string;
    relative_path: string;
    file_name: string;
    size: string;
    extension: string;
    duration: number;
    width: number;
    height: number;
    video_codec: string;
    audio_codec: string | null;
    fps: number | null;
    created_at: Date;
    updated_at: Date;
}

/**
 * Mapeo row → dominio. Regla exacta:
 *   - NULL (DB) → propiedad AUSENTE (undefined), respetando exactOptionalPropertyTypes.
 *   - Solo los opcionales del dominio (audioCodec, fps) pueden ser NULL.
 *     Los requeridos (width/height/videoCodec) son NOT NULL en la tabla.
 *   - BIGINT → number con Number() (size).
 */
function rowToStoredMetadata(
    row: VideoRow
): StoredVideoMetadata {
    return {
        id: row.id,
        relativePath: row.relative_path,
        fileName: row.file_name,
        size: Number(row.size),
        extension: row.extension,
        mediaInfo: {
            duration: row.duration,
            width: row.width,
            height: row.height,
            videoCodec: row.video_codec,
            ...(row.audio_codec !== null
                ? { audioCodec: row.audio_codec }
                : {}),
            ...(row.fps !== null
                ? { fps: row.fps }
                : {})
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/**
 * Implementación de infraestructura del catálogo.
 *
 * ÚNICA capa que conoce SQL y pg: el puerto (VideoRepository) es dominio puro
 * y no sabe que detrás hay PostgreSQL. Recibe el pool ÚNICO compartido desde
 * el composition root — jamás crea conexiones propias.
 *
 * Consistencia (ADR):
 *   - Todas las queries parametrizadas ($1, $2, ...) — nunca interpolación.
 *   - save(): INSERT ... ON CONFLICT (relative_path) DO UPDATE — el conflicto
 *     actualiza SOLO metadata mutable + updated_at; created_at se preserva.
 *   - listAll(): ORDER BY created_at DESC, relative_path ASC (determinístico).
 *   - deleteByRelativePath(): solo para CatalogSyncJob (fila huérfana);
 *     el archivo físico es responsabilidad exclusiva de FileRepository.
 */
export class PostgresVideoRepository
    implements VideoRepository {

    constructor(
        private readonly pool: Pool
    ) {}

    async save(
        metadata: StoredVideoMetadata
    ): Promise<void> {

        const { mediaInfo } = metadata;

        await this.pool.query(
            `INSERT INTO videos
                (id, relative_path, file_name, size, extension,
                 duration, width, height, video_codec, audio_codec, fps,
                 created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
             ON CONFLICT (relative_path) DO UPDATE SET
                file_name = EXCLUDED.file_name,
                size = EXCLUDED.size,
                extension = EXCLUDED.extension,
                duration = EXCLUDED.duration,
                width = EXCLUDED.width,
                height = EXCLUDED.height,
                video_codec = EXCLUDED.video_codec,
                audio_codec = EXCLUDED.audio_codec,
                fps = EXCLUDED.fps,
                updated_at = now()`,
            [
                metadata.id,
                metadata.relativePath,
                metadata.fileName,
                metadata.size,
                metadata.extension,
                mediaInfo.duration,
                mediaInfo.width,
                mediaInfo.height,
                mediaInfo.videoCodec,
                mediaInfo.audioCodec ?? null,
                mediaInfo.fps ?? null
            ]
        );
    }

    async listAll(): Promise<StoredVideoMetadata[]> {

        const result =
            await this.pool.query<VideoRow>(
                `SELECT id, relative_path, file_name, size, extension,
                        duration, width, height, video_codec, audio_codec, fps,
                        created_at, updated_at
                 FROM videos
                 ORDER BY created_at DESC, relative_path ASC`
            );

        return result.rows.map(
            rowToStoredMetadata
        );
    }

    async deleteByRelativePath(
        relativePath: string
    ): Promise<void> {

        await this.pool.query(
            `DELETE FROM videos
             WHERE relative_path = $1`,
            [relativePath]
        );
    }
}