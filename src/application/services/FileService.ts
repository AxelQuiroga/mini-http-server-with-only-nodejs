/*import { createReadStream, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { ReadStream, Stats } from 'node:fs';

import { FileServiceError } from '../../domain/types/file.types.js';

import type {
  ByteRange,
  VideoStreamMetadata
} from '../../domain/types/video.types.js';

import type {
  FileMetadata
} from '../../domain/types/file.types.js';

export class FileService {
  private readonly publicDir: string;

  constructor(publicDirName: string = 'public') {
    this.publicDir = join(process.cwd(), publicDirName);
  }


  private validateAndResolvePath(relativePath: string): { fullPath: string; stats: Stats } {
    const normalizedPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
    const fullPath = join(this.publicDir, normalizedPath);

    // 1. Seguridad contra Path Traversal
    if (!fullPath.startsWith(this.publicDir)) {
      throw new FileServiceError('FILE_ACCESS_DENIED');
    }

    // 2. Verificación de existencia
    if (!existsSync(fullPath)) {
      throw new FileServiceError('FILE_NOT_FOUND');
    }

    // 3. Verificación de tipo
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      throw new FileServiceError('IS_A_DIRECTORY');
    }

    return { fullPath, stats };
  }

getFileMetadata(relativePath: string): FileMetadata {
  const { fullPath, stats } = this.validateAndResolvePath(relativePath);

  return {
    size: stats.size,
    extension: extname(fullPath).toLowerCase(),
    modifiedTime: stats.mtime // Date de última modificación
  };
}

  getFileStream(relativePath: string, options?: { start?: number; end?: number }): ReadStream {
    const { fullPath } = this.validateAndResolvePath(relativePath);

    return createReadStream(fullPath, options);
  }


  getPartialFileStream(relativePath: string, range: ByteRange): VideoStreamMetadata {
    const { fullPath, stats } = this.validateAndResolvePath(relativePath);
    const totalSize = stats.size;

    const stream = createReadStream(fullPath, {
      start: range.start,
      end: range.end
    });

    const contentLength = range.end - range.start + 1;

    return {
      stream,
      start: range.start,
      end: range.end,
      totalSize,
      contentLength
    };
  }
}*/