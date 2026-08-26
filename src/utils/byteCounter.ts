import { Transform } from 'node:stream';
import type {
    TransformCallback
} from 'node:stream';

import {
    UploadError
} from '../domain/types/upload.types.js';

export const MAX_UPLOAD_SIZE =
    500 * 1024 * 1024; // 500 MB

export class ByteCounter extends Transform {

    private count = 0;
    private readonly maxSize: number;

    constructor(
        maxSize: number = MAX_UPLOAD_SIZE
    ) {
        super();
        this.maxSize = maxSize;
    }

    _transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
    ): void {

        this.count += chunk.length;

        if (this.count > this.maxSize) {
            callback(
                new UploadError(
                    'PAYLOAD_TOO_LARGE'
                )
            );
            return;
        }

        // Pasar el chunk sin modificar
        callback(null, chunk);
    }
}
