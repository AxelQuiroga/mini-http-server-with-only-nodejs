import type { FileMetadata } from '../domain/types/file.types.js';

/**
 * Genera un ETag determinístico a partir del tamaño y fecha de modificación en formato hexadecimal.
 * Ejemplo: W/"3817f4e-18c21a4f000"
 */
export function generateETag(metadata: FileMetadata): string {
  const sizeHex = metadata.size.toString(16);
  const mtimeHex = metadata.modifiedTime.getTime().toString(16);

  return `W/"${sizeHex}-${mtimeHex}"`;
}

/**
 * Evalúa si el cliente tiene la versión actualizada mediante ETag o Last-Modified.
 */
// src/utils/cacheUtils.ts

export function isCacheValid(
  headers: { 
    ifNoneMatch?: string | undefined; 
    ifModifiedSince?: string | undefined; 
  },
  etag: string,
  lastModified: Date
): boolean {
  const ifNoneMatch = headers.ifNoneMatch;
  const ifModifiedSince = headers.ifModifiedSince;

  // 1. Evaluación por ETag (If-None-Match)
  if (ifNoneMatch) {
    return ifNoneMatch
      .split(',')
      .some((tag) => tag.trim() === etag || tag.trim() === '*');
  }

  // 2. Evaluación por fecha (If-Modified-Since)
  if (ifModifiedSince) {
    const clientDate = Date.parse(ifModifiedSince);
    if (!isNaN(clientDate)) {
      const serverTimeInSeconds = Math.floor(lastModified.getTime() / 1000) * 1000;
      return serverTimeInSeconds <= clientDate;
    }
  }

  return false;
}