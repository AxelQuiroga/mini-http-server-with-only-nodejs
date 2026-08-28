import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, PassThrough } from 'node:stream';

import { UploadService } from '../src/application/services/UploadService.js';
import { UploadError } from '../src/domain/types/upload.types.js';

import type { VideoMediaInfo } from '../src/domain/types/media.types.js';
import type { StoredVideoMetadata } from '../src/domain/types/catalog.types.js';
import type { FileMetadata } from '../src/domain/types/file.types.js';
import type { FileRepository } from '../src/domain/repositories/FileRepository.js';
import type { MediaRepository } from '../src/domain/repositories/MediaRepository.js';
import type { VideoRepository } from '../src/domain/repositories/VideoRepository.js';
import type { UploadHandle } from '../src/domain/types/upload.types.js';
import type { ReadStream } from 'node:fs';
import type { VideoStreamMetadata, ByteRange } from '../src/domain/types/video.types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

function pgError(code: string, message?: string): Error {
    const error = new Error(message ?? `PG ${code}`);
    (error as NodeJS.ErrnoException).code = code;
    return error;
}

function transportError(
    code: string,
    message: string,
    syscall?: string
): Error {
    const error = new Error(message);
    (error as NodeJS.ErrnoException).code = code;
    if (syscall !== undefined) {
        (error as NodeJS.ErrnoException).syscall = syscall;
    }
    return error;
}

function buildInput(fileName = 'mi-video.mp4'): {
    stream: Readable;
    fileName: string;
} {
    // Readable.from finaliza (emite end) — un PassThrough() vacío nunca
    // termina solo y colgaría el pipeline del test.
    return {
        stream: Readable.from([
            Buffer.from('video-bytes-de-prueba')
        ]),
        fileName
    };
}

const DEFAULT_MEDIA_INFO: VideoMediaInfo = {
    duration: 10,
    width: 1920,
    height: 1080,
    videoCodec: 'h264'
};

// ─── Fakes ────────────────────────────────────────────────────────────────

class FakeFileRepository
    implements FileRepository {

    deletedPaths: string[] = [];
    canceledUploads = 0;
    rollbackError: Error | null = null;
    uploadedSize = 1024;

    getFileMetadata(_relativePath: string): FileMetadata {
        return {
            size: this.uploadedSize,
            extension: '.mp4',
            modifiedTime: new Date()
        };
    }

    getFileStream(): ReadStream {
        throw new Error('not used in upload tests');
    }

    getPartialFileStream(): VideoStreamMetadata {
        throw new Error('not used in upload tests');
    }

    async listVideos(): Promise<string[]> {
        return [];
    }

    async createUpload(
        fileName: string
    ): Promise<UploadHandle> {
        return {
            absolutePath: `/tmp/videos/${fileName}.tmp`,
            writable: new PassThrough()
        };
    }

    async completeUpload(): Promise<void> {
        return;
    }

    async cancelUpload(): Promise<void> {
        this.canceledUploads++;
    }

    async deleteVideo(
        relativePath: string
    ): Promise<void> {
        if (this.rollbackError) {
            throw this.rollbackError;
        }
        this.deletedPaths.push(relativePath);
    }

    async cleanOrphanUploads(): Promise<void> {
        return;
    }
}

class FakeVideoRepository
    implements VideoRepository {

    saves: StoredVideoMetadata[] = [];
    enqueuedFailures: (Error | null)[] = [];

    async save(
        metadata: StoredVideoMetadata
    ): Promise<void> {
        this.saves.push(metadata);
        const failure =
            this.enqueuedFailures.shift() ?? null;
        if (failure) throw failure;
    }

    async listAll(): Promise<StoredVideoMetadata[]> {
        return [];
    }

    async deleteByRelativePath(): Promise<void> {
        return;
    }
}

class FakeMediaRepository
    implements MediaRepository {

    thumbnailFailures = 0;

    async getVideoInfo(): Promise<VideoMediaInfo> {
        return DEFAULT_MEDIA_INFO;
    }

    async getVideoThumbnail(): Promise<void> {
        if (this.thumbnailFailures > 0) {
            this.thumbnailFailures--;
            throw new Error('ffmpeg thumbnail failed');
        }
    }
}

// ─── Grupo 1: Éxito ───────────────────────────────────────────────────────

test('éxito: save 1 vez con metadata exacta y thumbnail generada', async () => {
    const videoRepo = new FakeVideoRepository();
    const fileRepo = new FakeFileRepository();
    const mediaRepo = new FakeMediaRepository();

    const service = new UploadService(
        fileRepo,
        mediaRepo,
        videoRepo
    );

    const mediaInfo =
        await service.uploadVideo(buildInput('mi-video.mp4'));

    // save se llamó UNA vez
    assert.equal(videoRepo.saves.length, 1);

    const saved = videoRepo.saves[0]!;

    // metadata coherente con el diseño
    assert.equal(
        saved.id,
        Buffer.from('mi-video.mp4').toString('base64url')
    );
    assert.equal(saved.relativePath, 'mi-video.mp4');
    assert.equal(saved.fileName, 'mi-video.mp4');
    assert.equal(saved.size, fileRepo.uploadedSize);
    assert.equal(saved.extension, '.mp4');
    assert.deepEqual(saved.mediaInfo, DEFAULT_MEDIA_INFO);
    assert.ok(saved.createdAt instanceof Date);
    assert.ok(saved.updatedAt instanceof Date);

    // thumbnail se generó (sin errores, mediaRepo thumbnailFailures = 0)
    // y no se rompió el response
    assert.deepEqual(mediaInfo, DEFAULT_MEDIA_INFO);
});

// ─── Grupo 2: Retryable → retry → éxito ───────────────────────────────────

test('retryable 1er falla → 2do ok: save 2 veces, misma metadata', async () => {
    const videoRepo = new FakeVideoRepository();
    const fileRepo = new FakeFileRepository();
    const mediaRepo = new FakeMediaRepository();

    videoRepo.enqueuedFailures = [
        pgError('40001', 'serialization_failure')
    ];

    const service = new UploadService(
        fileRepo,
        mediaRepo,
        videoRepo
    );

    const mediaInfo =
        await service.uploadVideo(buildInput('test.mp4'));

    assert.equal(videoRepo.saves.length, 2);
    assert.deepEqual(videoRepo.saves[0], videoRepo.saves[1]);
    assert.equal(fileRepo.deletedPaths.length, 0);
    assert.deepEqual(mediaInfo, DEFAULT_MEDIA_INFO);
});

// ─── Grupo 3: Retryable agotado → rollback ────────────────────────────────

test('retryable 2 fallas → CATALOG_ERROR + deleteVideo', async () => {
    const videoRepo = new FakeVideoRepository();
    const fileRepo = new FakeFileRepository();
    const mediaRepo = new FakeMediaRepository();

    videoRepo.enqueuedFailures = [
        pgError('57P03', 'cannot_connect_now'),
        pgError('57P03', 'cannot_connect_now')
    ];

    const service = new UploadService(
        fileRepo,
        mediaRepo,
        videoRepo
    );

    await assert.rejects(
        service.uploadVideo(buildInput('test.mp4')),
        (error: unknown) => {
            assert.ok(error instanceof UploadError);
            assert.equal(error.code, 'CATALOG_ERROR');
            return true;
        }
    );

    assert.equal(videoRepo.saves.length, 2);
    assert.deepEqual(fileRepo.deletedPaths, ['videos/test.mp4']);
});

// ─── Grupo 4: Fatal → rollback (1 solo intento) ───────────────────────────

test('fatal (23502) → CATALOG_ERROR + 1 solo save + deleteVideo', async () => {
    const videoRepo = new FakeVideoRepository();
    const fileRepo = new FakeFileRepository();
    const mediaRepo = new FakeMediaRepository();

    videoRepo.enqueuedFailures = [
        pgError('23502', 'null value in column')
    ];

    const service = new UploadService(
        fileRepo,
        mediaRepo,
        videoRepo
    );

    await assert.rejects(
        service.uploadVideo(buildInput('test.mp4')),
        (error: unknown) => {
            assert.ok(error instanceof UploadError);
            assert.equal(error.code, 'CATALOG_ERROR');
            return true;
        }
    );

    // FATAL: reintentar no cambia nada → 1 solo save
    assert.equal(videoRepo.saves.length, 1);
    assert.deepEqual(fileRepo.deletedPaths, ['videos/test.mp4']);
});

// ─── Grupo 5: NOT_EXECUTED → rollback ─────────────────────────────────────

test('NOT_EXECUTED (ECONNREFUSED) 2 veces → CATALOG_ERROR + deleteVideo', async () => {
    const videoRepo = new FakeVideoRepository();
    const fileRepo = new FakeFileRepository();
    const mediaRepo = new FakeMediaRepository();

    videoRepo.enqueuedFailures = [
        transportError('ECONNREFUSED', 'connect ECONNREFUSED', 'connect'),
        transportError('ECONNREFUSED', 'connect ECONNREFUSED', 'connect')
    ];

    const service = new UploadService(
        fileRepo,
        mediaRepo,
        videoRepo
    );

    await assert.rejects(
        service.uploadVideo(buildInput('test.mp4')),
        (error: unknown) => {
            assert.ok(error instanceof UploadError);
            assert.equal(error.code, 'CATALOG_ERROR');
            return true;
        }
    );

    assert.equal(videoRepo.saves.length, 2);
    assert.deepEqual(fileRepo.deletedPaths, ['videos/test.mp4']);
});

// ─── Grupo 6: AMBIGUOUS → nunca rollback ──────────────────────────────────

test('AMBIGUOUS (ECONNRESET read) 2 veces → CATALOG_ERROR + NINGÚN deleteVideo', async () => {
    const videoRepo = new FakeVideoRepository();
    const fileRepo = new FakeFileRepository();
    const mediaRepo = new FakeMediaRepository();

    videoRepo.enqueuedFailures = [
        transportError('ECONNRESET', 'read ECONNRESET', 'read'),
        transportError('ECONNRESET', 'read ECONNRESET', 'read')
    ];

    const service = new UploadService(
        fileRepo,
        mediaRepo,
        videoRepo
    );

    await assert.rejects(
        service.uploadVideo(buildInput('test.mp4')),
        (error: unknown) => {
            assert.ok(error instanceof UploadError);
            assert.equal(error.code, 'CATALOG_ERROR');
            return true;
        }
    );

    assert.equal(videoRepo.saves.length, 2);
    // CERTEZA: deleteVideo NUNCA se llamó
    assert.equal(fileRepo.deletedPaths.length, 0);
});

// ─── Grupo 6b: I1 — el historial AMBIGUOUS manda sobre el último FATAL ─────

test('I1: 1ro AMBIGUOUS + 2do FATAL → CATALOG_ERROR + NINGÚN deleteVideo', async () => {
    const videoRepo = new FakeVideoRepository();
    const fileRepo = new FakeFileRepository();
    const mediaRepo = new FakeMediaRepository();

    videoRepo.enqueuedFailures = [
        transportError('ECONNRESET', 'read ECONNRESET', 'read'),
        pgError('23502', 'null value in column')
    ];

    const service = new UploadService(
        fileRepo,
        mediaRepo,
        videoRepo
    );

    await assert.rejects(
        service.uploadVideo(buildInput('test.mp4')),
        (error: unknown) => {
            assert.ok(error instanceof UploadError);
            assert.equal(error.code, 'CATALOG_ERROR');
            return true;
        }
    );

    // 2 intentos: 1ro AMBIGUOUS (pudo aplicarse), 2do FATAL (no aplicado)
    assert.equal(videoRepo.saves.length, 2);
    // I1: el INSERT pudo haberse aplicado en el intento 1 → NUNCA rollback,
    // aunque el último veredicto haya sido FATAL.
    assert.equal(fileRepo.deletedPaths.length, 0);
});

// ─── Grupo 7: Rollback fallido → CATALOG ORPHAN ───────────────────────────

test('rollback fallido (EACCES) → CATALOG_ERROR igual, sin borro el archivo', async () => {
    const videoRepo = new FakeVideoRepository();
    const fileRepo = new FakeFileRepository();
    const mediaRepo = new FakeMediaRepository();

    videoRepo.enqueuedFailures = [
        pgError('23502', 'null value in column')
    ];
    fileRepo.rollbackError = new Error('EACCES');

    const service = new UploadService(
        fileRepo,
        mediaRepo,
        videoRepo
    );

    await assert.rejects(
        service.uploadVideo(buildInput('test.mp4')),
        (error: unknown) => {
            assert.ok(error instanceof UploadError);
            assert.equal(error.code, 'CATALOG_ERROR');
            return true;
        }
    );

    // El intento de rollback falló, pero el error seguía siendo CATALOG_ERROR
    // (el usuario recibió un 500, no un silencio).
    assert.equal(videoRepo.saves.length, 1);
});

// ─── Grupo 8: Thumbnail fallido → upload exitoso ───────────────────────────

test('thumbnail fallida no convierte éxito en error', async () => {
    const videoRepo = new FakeVideoRepository();
    const fileRepo = new FakeFileRepository();
    const mediaRepo = new FakeMediaRepository();

    mediaRepo.thumbnailFailures = 1;

    const service = new UploadService(
        fileRepo,
        mediaRepo,
        videoRepo
    );

    const mediaInfo =
        await service.uploadVideo(buildInput('test.mp4'));

    assert.equal(videoRepo.saves.length, 1);
    assert.deepEqual(mediaInfo, DEFAULT_MEDIA_INFO);
});

// ─── Grupo 9: Regresiones del pipeline / ffprobe ──────────────────────────

test('pipeline error → cancelUpload + error original propagado', async () => {
    const videoRepo = new FakeVideoRepository();
    const fileRepo = new FakeFileRepository();
    const mediaRepo = new FakeMediaRepository();

    const service = new UploadService(
        fileRepo,
        mediaRepo,
        videoRepo
    );

    // Stream que destruye inmediatamente → pipeline falla
    const brokenStream = new Readable({
        read() {
            this.destroy(new Error('network broke'));
        }
    });

    await assert.rejects(
        service.uploadVideo({
            stream: brokenStream,
            fileName: 'test.mp4'
        }),
        (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.equal(error.message, 'network broke');
            return true;
        }
    );

    // cancelUpload fue llamado una vez
    assert.equal(fileRepo.canceledUploads, 1);
    // save NUNCA se ejecutó (falló antes de ffprobe)
    assert.equal(videoRepo.saves.length, 0);
});

test('ffprobe error → cancelUpload + UNSUPPORTED_MEDIA', async () => {
    const videoRepo = new FakeVideoRepository();
    const fileRepo = new FakeFileRepository();
    const mediaRepo = new FakeMediaRepository();

    // Forzar ffprobe a fallar
    const failingMediaRepo: MediaRepository = {
        async getVideoInfo(): Promise<VideoMediaInfo> {
            throw new Error('corrupt file');
        },
        async getVideoThumbnail(): Promise<void> {
            return;
        }
    };

    const service = new UploadService(
        fileRepo,
        failingMediaRepo,
        videoRepo
    );

    await assert.rejects(
        service.uploadVideo(buildInput('test.mp4')),
        (error: unknown) => {
            assert.ok(error instanceof UploadError);
            assert.equal(error.code, 'UNSUPPORTED_MEDIA');
            return true;
        }
    );

    assert.equal(fileRepo.canceledUploads, 1);
    assert.equal(videoRepo.saves.length, 0);
});