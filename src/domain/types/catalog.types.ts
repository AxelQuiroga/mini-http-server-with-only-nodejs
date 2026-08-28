import type { VideoMediaInfo } from './media.types.js';

/**
 * Registro persistido del catálogo (fuente de verdad: PostgreSQL).
 *
 * NO es la proyección HTTP (VideoMetadata): las URLs (streamUrl, thumbnailUrl)
 * y el título son derivación de la capa de aplicación (VideoService).
 */
export interface StoredVideoMetadata {
    /** base64url(relativePath) — mismo algoritmo y valor que el id de thumbnails/stream */
    id: string;
    /**
     * Identidad LÓGICA del archivo: normalizada (forward slashes), relativa a
     * public/videos. Es el futuro S3 key. NUNCA se persiste el path absoluto.
     */
    relativePath: string;
    /** Nombre sanitizado, con extensión */
    fileName: string;
    /** Tamaño en bytes (BIGINT en DB — un archivo puede superar 2GB) */
    size: number;
    /** Extensión en minúsculas con punto (ej: .mp4) */
    extension: string;
    /** Metadata que ffprobe ya computó en el upload (se persiste, no se descarta) */
    mediaInfo: VideoMediaInfo;
    createdAt: Date;
    updatedAt: Date;
}