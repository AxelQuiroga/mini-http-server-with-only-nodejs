import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import {
    mkdtemp,
    mkdir,
    rm
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    FileSystemRepository
} from '../src/infraestructure/filesystem/FileSystemRepository.js';

import {
    FileServiceError
} from '../src/domain/types/file.types.js';

/**
 * Los tests del adaptador real necesitan un directorio aislado: el
 * constructor de FileSystemRepository resuelve contra process.cwd().
 * node --test ejecuta CADA archivo en un proceso separado → el chdir
 * de aquí es local a este archivo y no afecta a los demás tests.
 */

let originalCwd = process.cwd();
let tempRoot: string | undefined;

async function makeRepo(): Promise<FileSystemRepository> {
    // chdir repetido: limpiar el temp anterior si lo hubiera
    if (tempRoot !== undefined) {
        process.chdir(originalCwd);
        await rm(tempRoot, { recursive: true, force: true });
    }

    tempRoot = await mkdtemp(join(tmpdir(), 'fsrepo-'));

    // public/videos — estructura que espera el repo
    await mkdir(
        join(tempRoot, 'public', 'videos'),
        { recursive: true }
    );

    process.chdir(tempRoot);

    return new FileSystemRepository('public');
}

after(async () => {
    if (tempRoot !== undefined) {
        process.chdir(originalCwd);
        await rm(tempRoot, { recursive: true, force: true });
    }
});

test('C2: 2do createUpload mismo nombre → FILE_ALREADY_EXISTS y NO toca el lock ajeno', async () => {
    const repo = await makeRepo();

    // 1ro adquiere el lock 'same.mp4.lock'
    const first = await repo.createUpload('same.mp4');

    // 2do simultáneo: EEXIST del open(lock,'wx') se mapea a
    // FILE_ALREADY_EXISTS (antes: EEXIST crudo → 500 genérico, fix C2).
    await assert.rejects(
        repo.createUpload('same.mp4'),
        (error: unknown) => {
            assert.ok(error instanceof FileServiceError);
            assert.equal(error.code, 'FILE_ALREADY_EXISTS');
            return true;
        }
    );

    // El lock sigue vivo para su dueño: el 1ro puede cancelar/liberar
    // (cancelUpload es idempotente; ENOENT no es error)...
    await repo.cancelUpload(first);

    // ...y recién AHÍ un nuevo upload del mismo nombre es posible.
    const third = await repo.createUpload('same.mp4');
    await repo.cancelUpload(third);
});