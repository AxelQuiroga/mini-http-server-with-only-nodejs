import { createReadStream, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { ReadStream } from 'node:fs';

export interface FileMetadata {
    stream: ReadStream;
    size: number;
    extension: string;
}

export class FileService {
    private readonly publicDir: string;

    constructor(publicDirName: string = 'public'){
        this.publicDir = join(process.cwd(), publicDirName);
    }

    getFileStream(relativePath: string): FileMetadata {
        const normalizedPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath; 
        const fullPath =  join(this.publicDir, normalizedPath);

        if(!fullPath.startsWith(this.publicDir)) {
            throw new Error('FILE_ACCESS_DENIED');
        }

        if (!existsSync(fullPath)) {
            throw new Error('FILE_NOT_FOUND');
        }

        const stats = statSync(fullPath);
        if(stats.isDirectory()) {
            throw new Error('IS_A_DIRECTORY');
        }

        const stream = createReadStream(fullPath);
        const extension = extname(fullPath).toLowerCase();

        return {
            stream,
            size: stats.size,
            extension
        };
    }

}
