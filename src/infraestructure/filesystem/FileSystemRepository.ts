import {
    createReadStream,
    createWriteStream,
    existsSync,
    statSync
} from 'node:fs';

import {
    open,
    rename,
    unlink,
    readdir,
    stat,
    access
} from 'node:fs/promises';

import { join, extname } from 'node:path';

import type {
    ReadStream,
    Stats
} from 'node:fs';

import type {
    FileMetadata
} from '../../domain/types/file.types.js';

import {
    FileServiceError
} from '../../domain/types/file.types.js';

import type {
    ByteRange,
    VideoStreamMetadata
} from '../../domain/types/video.types.js';

import type {
    FileRepository
} from '../../domain/repositories/FileRepository.js';

import type {
    UploadHandle
} from '../../domain/types/upload.types.js';

export class FileSystemRepository
    implements FileRepository
{
    private readonly publicDir: string;
    private readonly videosDir: string;

    constructor(
        publicDirName: string = 'public'
    ) {
        this.publicDir = join(
            process.cwd(),
            publicDirName
        );
        this.videosDir = join(
            this.publicDir,
            'videos'
        );
    }

    // ─── Utilidades ────────────────────────────────────────────────────

    /**
     * Resuelve una ruta relativa contra publicDir
     * con traversal check. NO verifica existencia.
     */
    private resolveUploadPath(
        relativePath: string
    ): string {

        const normalizedPath =
            relativePath.startsWith('/')
                ? relativePath.slice(1)
                : relativePath;

        const fullPath = join(
            this.publicDir,
            normalizedPath
        );

        if (
            !fullPath.startsWith(this.publicDir)
        ) {
            throw new FileServiceError(
                'FILE_ACCESS_DENIED'
            );
        }

        return fullPath;
    }

    private validateAndResolvePath(
        relativePath: string
    ): {
        fullPath: string;
        stats: Stats;
    } {

        const normalizedPath =
            relativePath.startsWith('/')
                ? relativePath.slice(1)
                : relativePath;

        const fullPath = join(
            this.publicDir,
            normalizedPath
        );

        if (
            !fullPath.startsWith(this.publicDir)
        ) {
            throw new FileServiceError(
                'FILE_ACCESS_DENIED'
            );
        }

        if (!existsSync(fullPath)) {
            throw new FileServiceError(
                'FILE_NOT_FOUND'
            );
        }

        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
            throw new FileServiceError(
                'IS_A_DIRECTORY'
            );
        }

        return { fullPath, stats };
    }

    // ─── Lectura ──────────────────────────────────────────────────────

    getFileMetadata(
        relativePath: string
    ): FileMetadata {

        const {
            fullPath,
            stats
        } = this.validateAndResolvePath(
            relativePath
        );

        return {
            size: stats.size,
            extension:
                extname(fullPath).toLowerCase(),
            modifiedTime: stats.mtime
        };
    }

    getFileStream(
        relativePath: string,
        options?: {
            start?: number;
            end?: number;
        }
    ): ReadStream {

        const { fullPath } =
            this.validateAndResolvePath(
                relativePath
            );

        return createReadStream(
            fullPath,
            options
        );
    }

    getPartialFileStream(
        relativePath: string,
        range: ByteRange
    ): VideoStreamMetadata {

        const {
            fullPath,
            stats
        } = this.validateAndResolvePath(
            relativePath
        );

        const totalSize = stats.size;

        const stream = createReadStream(
            fullPath,
            {
                start: range.start,
                end: range.end
            }
        );

        const contentLength =
            range.end - range.start + 1;

        return {
            stream,
            start: range.start,
            end: range.end,
            totalSize,
            contentLength
        };
    }

    // ─── Upload (async) ────────────────────────────────────────────────

    /**
     * Propiedad clave: una vez adquirido el .lock,
     * ningún otro upload puede reservar ese nombre.
     * El existsSync del final DESPUÉS del lock no tiene race condition.
     */
    async createUpload(
        fileName: string
    ): Promise<UploadHandle> {

        const lockPath =
            this.resolveUploadPath(
                `videos/${fileName}.lock`
            );

        const tmpPath =
            this.resolveUploadPath(
                `videos/${fileName}.tmp`
            );

        const finalPath =
            this.resolveUploadPath(
                `videos/${fileName}`
            );

        // 1. Crear lock atómico (wx)
        const lockHandle =
            await open(lockPath, 'wx');

        await lockHandle.close();

        try {
            // 2. Verificar si el final ya existe
            try {
                await stat(finalPath);

                // Existe → limpiar lock y fallar
                await unlink(lockPath);

                throw new FileServiceError(
                    'FILE_ALREADY_EXISTS'
                );
            } catch (error) {
                if (
                    error instanceof
                    FileServiceError
                ) {
                    throw error;
                }

                const code =
                    (error as NodeJS.ErrnoException)
                        .code;

                if (code !== 'ENOENT') {
                    // Error distinto a ENOENT
                    // → limpiar lock y propagar
                    await unlink(lockPath)
                        .catch(() => {});
                    throw error;
                }

                // ENOENT → no existe → continuar
            }

            // 3. Crear temporal atómico (wx)
            const fileHandle =
                await open(tmpPath, 'wx');

            const writable =
                createWriteStream(
                    '',
                    { fd: fileHandle }
                );

            return {
                absolutePath: tmpPath,
                writable
            };

        } catch (error) {
            // Limpiar lock ante cualquier error
            await unlink(lockPath)
                .catch(() => {});
            throw error;
        }
    }

    /**
     * rename .tmp → final, luego delete .lock.
     * Si el proceso muere entre ambas:
     *   - final existe, .lock existe, .tmp no
     * → cleanOrphanUploads lo resuelve al startup.
     */
    async completeUpload(
        handle: UploadHandle
    ): Promise<void> {

        const tmpPath =
            handle.absolutePath;

        // .tmp → .lock: quitar los últimos 4 chars (".tmp")
        const basePath =
            tmpPath.slice(0, -4);

        const finalPath = basePath;
        const lockPath =
            `${basePath}.lock`;

        await rename(tmpPath, finalPath);
        await unlink(lockPath);
    }

    /**
     * Idempotente: ENOENT en .tmp o .lock no es error.
     * El temporal debe terminar sin existir.
     */
    async cancelUpload(
        handle: UploadHandle
    ): Promise<void> {

        const tmpPath =
            handle.absolutePath;

        const basePath =
            tmpPath.slice(0, -4);

        const lockPath =
            `${basePath}.lock`;

        await unlink(tmpPath)
            .catch(() => {});

        await unlink(lockPath)
            .catch(() => {});
    }

    /**
     * Ejecutar ANTES de server.listen().
     * Limpia solo artefactos de nuestro mecanismo:
     *   - *.lock → borrar + borrar .tmp asociado
     *   - *.tmp sueltos (sin .lock) → borrar
     * No toca archivos arbitrarios del directorio.
     */
    async cleanOrphanUploads(): Promise<void> {

        try {
            await access(this.videosDir);
        } catch {
            return;
        }

        const entries =
            await readdir(this.videosDir);

        // Fase 1: locks y sus temporales
        const lockBases =
            new Set<string>();

        for (const entry of entries) {
            if (entry.endsWith('.lock')) {
                const base =
                    entry.slice(0, -5);

                lockBases.add(base);

                await unlink(
                    join(
                        this.videosDir,
                        entry
                    )
                ).catch(() => {});
            }
        }

        for (const base of lockBases) {
            await unlink(
                join(
                    this.videosDir,
                    `${base}.tmp`
                )
            ).catch(() => {});
        }

        // Fase 2: temporales huérfanos
        for (const entry of entries) {
            if (entry.endsWith('.tmp')) {
                const base =
                    entry.slice(0, -4);

                if (!lockBases.has(base)) {
                    await unlink(
                        join(
                            this.videosDir,
                            entry
                        )
                    ).catch(() => {});
                }
            }
        }
    }
}