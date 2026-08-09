import { readdirSync } from 'node:fs';
import { join, extname, parse, relative } from 'node:path';
import { FileService } from './FileService.js';
import type { VideoMetadata } from '../types/video.types.js';

export class VideoService {
  private readonly ALLOWED_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi']);
  private readonly absoluteVideosFolderPath: string;

  constructor(
    private readonly fileService: FileService,
    private readonly videosFolder: string = 'public/videos'
  ) {
    this.absoluteVideosFolderPath = join(process.cwd(), this.videosFolder);
  }

  /**
   * Obtiene todos los videos buscando recursivamente en todas las subcarpetas.
   */
  getAllVideos(): VideoMetadata[] {
    const videoRelativePaths = this.scanDirectoryRecursively(this.absoluteVideosFolderPath);

    return videoRelativePaths.map((relativePath) => this.mapToVideoMetadata(relativePath));
  }

  /**
   * Método auxiliar recursivo.
   * Recorre carpetas y devuelve rutas relativas respecto a public/videos (ej: 'trailers/video1.mp4')
   */
  private scanDirectoryRecursively(currentDirPath: string): string[] {
    let results: string[] = [];

    try {
      const entries = readdirSync(currentDirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullEntryPath = join(currentDirPath, entry.name);

        if (entry.isDirectory()) {
          // Llamada recursiva hacia la subcarpeta
          const subDirFiles = this.scanDirectoryRecursively(fullEntryPath);
          results = results.concat(subDirFiles);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();

          if (this.ALLOWED_EXTENSIONS.has(ext)) {
            // Obtenemos la ruta relativa desde la carpeta raíz de videos (ej: 'trailers/avengers.mp4')
            const relativeToVideosFolder = relative(this.absoluteVideosFolderPath, fullEntryPath);
            results.push(relativeToVideosFolder);
          }
        }
      }
    } catch (error: unknown) {
      // Manejo seguro si la carpeta aún no existe en disco
      console.warn(`[VideoService] No se pudo leer el directorio: ${currentDirPath}`);
    }

    return results;
  }

  /**
   * Convierte la ruta relativa de un video en un DTO formateado para la API.
   * @param relativeVideoPath Ruta relativa a la carpeta de videos (ej: 'trailers/avengers.mp4')
   */
  private mapToVideoMetadata(relativeVideoPath: string): VideoMetadata {
    // Normalizamos separadores para compatibilidad de URLs HTTP (reemplaza '\' por '/')
    const normalizedRelativePath = relativeVideoPath.replace(/\\/g, '/');

    // La ruta que FileService entiende (ej: 'videos/trailers/avengers.mp4')
    const fileServicePath = join('videos', normalizedRelativePath);

    const { size, extension } = this.fileService.getFileMetadata(fileServicePath);
    const fileInfo = parse(normalizedRelativePath);

    // Generamos un ID seguro en Base64 a partir de la ruta relativa completa
    const id = Buffer.from(normalizedRelativePath).toString('base64url');

    return {
      id,
      title: this.formatTitle(fileInfo.name),
      fileName: fileInfo.base,
      size,
      extension,
      // La URL exacta que resolverá el router y el StaticFileController
      streamUrl: `/videos/${normalizedRelativePath}`
    };
  }

  /**
   * Limpia el nombre del archivo para mostrar un título amigable.
   */
  private formatTitle(rawName: string): string {
    return rawName
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }
}