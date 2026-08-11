import { readdirSync } from 'node:fs';
import { join, extname, parse, relative } from 'node:path';
import { FileService } from './FileService.js';
import { MediaService } from './MediaService.js'; // 1. Importamos MediaService
import type { VideoMetadata } from '../types/video.types.js';

export class VideoService {
  private readonly ALLOWED_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi']);
  private readonly absoluteVideosFolderPath: string;

  constructor(
    private readonly fileService: FileService,
    private readonly mediaService: MediaService, // 2. Inyectamos MediaService
    private readonly videosFolder: string = 'public/videos'
  ) {
    this.absoluteVideosFolderPath = join(process.cwd(), this.videosFolder);
  }

  /**
   * Obtiene todos los videos buscando recursivamente.
   * Ahora es ASÍNCRONO porque ffprobe ejecuta un proceso asíncrono.
   */
  async getAllVideos(): Promise<VideoMetadata[]> {
    const videoRelativePaths = this.scanDirectoryRecursively(this.absoluteVideosFolderPath);

    // Mapeamos de forma asíncrona todos los archivos
    const metadataPromises = videoRelativePaths.map((relativePath) =>
      this.mapToVideoMetadata(relativePath)
    );

    return Promise.all(metadataPromises);
  }

  private scanDirectoryRecursively(currentDirPath: string): string[] {
    let results: string[] = [];

    try {
      const entries = readdirSync(currentDirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullEntryPath = join(currentDirPath, entry.name);

        if (entry.isDirectory()) {
          const subDirFiles = this.scanDirectoryRecursively(fullEntryPath);
          results = results.concat(subDirFiles);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();

          if (this.ALLOWED_EXTENSIONS.has(ext)) {
            const relativeToVideosFolder = relative(this.absoluteVideosFolderPath, fullEntryPath);
            results.push(relativeToVideosFolder);
          }
        }
      }
    } catch (error: unknown) {
      console.warn(`[VideoService] No se pudo leer el directorio: ${currentDirPath}`);
    }

    return results;
  }

  /**
   * Ahora es ASÍNCRO para consultar a MediaService por la duración, resolución, etc.
   */
  private async mapToVideoMetadata(relativeVideoPath: string): Promise<VideoMetadata> {
    const normalizedRelativePath = relativeVideoPath.replace(/\\/g, '/');
    const fileServicePath = join('videos', normalizedRelativePath);

    // Metadata básica de disco (size, extension)
    const { size, extension } = this.fileService.getFileMetadata(fileServicePath);
    const fileInfo = parse(normalizedRelativePath);

    // Ruta absoluta que necesita ffprobe para inspeccionar
    const absoluteFilePath = join(this.absoluteVideosFolderPath, normalizedRelativePath);

    // 3. Inspección con ffprobe mediante MediaService
    const mediaInfo = await this.mediaService.getVideoInfo(absoluteFilePath);

    const id = Buffer.from(normalizedRelativePath).toString('base64url');

    return {
  id,
  title: this.formatTitle(fileInfo.name),
  fileName: fileInfo.base,
  size,
  extension,
  streamUrl: `/videos/${normalizedRelativePath}`,
  mediaInfo // <-- Le pasás el objeto completo que te devolvió MediaService
};
  }

  private formatTitle(rawName: string): string {
    return rawName
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}