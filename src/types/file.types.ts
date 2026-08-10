// Union type para restringir las extensiones soportadas
export type SupportedExtension = '.html' | '.css' | '.js' | '.json' | '.png' | '.jpg' | '.svg' | '.jpeg' | '.mp4' ;

// Mapas de MimeTypes tipados estrictamente
export const MIME_TYPES: Record<SupportedExtension, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.jpeg': 'image/jpeg',
    '.mp4': 'video/mp4',
};

// Errores de Dominio tipados
export type FileServiceErrorCode = 
  | 'FILE_NOT_FOUND' 
  | 'FILE_ACCESS_DENIED' 
  | 'IS_A_DIRECTORY';

export class FileServiceError extends Error {
  constructor(public readonly code: FileServiceErrorCode) {
    super(code);
    this.name = 'FileServiceError';
  }
}

export interface FileMetadata {
  size: number;
  extension: string;
  modifiedTime: Date;
}