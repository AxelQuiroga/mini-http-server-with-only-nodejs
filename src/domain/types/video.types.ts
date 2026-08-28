import type{ VideoMediaInfo } from './media.types.js';

/**
 * Whitelist de extensiones de video aceptadas (minúsculas, con punto).
 * Fuente para listVideos (FileSystemRepository) y el sync. UploadService y
 * VideoService tienen copias locales (limpieza pendiente, fuera de esta etapa).
 */
export const ALLOWED_VIDEO_EXTENSIONS: ReadonlySet<string> =
    new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi']);

export interface ByteRange {
  start: number;
  end: number;
}

export interface VideoStreamMetadata {
  stream: import('node:fs').ReadStream;
  start: number;
  end: number;
  totalSize: number;
  contentLength: number;
}

export interface VideoMetadata {
  id: string;          
  title: string;     
  fileName: string;    
  size: number;        
  extension: string;   
  streamUrl: string;
  mediaInfo?: VideoMediaInfo;
  thumbnailUrl?: string
}