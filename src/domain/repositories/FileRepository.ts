import type { ReadStream } from 'node:fs';

import type {
    FileMetadata
} from '../types/file.types.js';

import type {
    ByteRange,
    VideoStreamMetadata
} from '../types/video.types.js';

export interface FileRepository {

    getFileMetadata(
        relativePath: string
    ): FileMetadata;

    getFileStream(
        relativePath: string,
        options?: {
            start?: number;
            end?: number;
        }
    ): ReadStream;

    getPartialFileStream(
        relativePath: string,
        range: ByteRange
    ): VideoStreamMetadata;
}