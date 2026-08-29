import { Pool } from 'pg';

import type {
    StoredVideoMetadata
} from '../../src/domain/types/catalog.types.js';

import type {
    VideoMediaInfo
} from '../../src/domain/types/media.types.js';

/**
 * ─── Infra compartida de los tests de integración (PostgreSQL REAL) ─────
 *
 * Contrato de cada suite de integración (tests/integration/*.test.ts):
 *
 *   1. Crear el pool con createTestPool() y correr la BARRA (gate) de
 *      disponibilidad con dbSkipReason() ANTES de registrar los tests
 *      (top-level await — los archivos corren como ESM con --import tsx).
 *
 *   2. Si el gate devuelve un motivo → marcar CADA test con
 *      `{ skip: reason }`: la suite se salta con mensaje accionable y
 *      NUNCA falla falsamente en un entorno sin PostgreSQL.
 *
 *   3. applySchema() al inicio de la suite (idempotente) + truncateVideos()
 *      por test: DB de test limpia SIEMPRE, aislamiento total entre suites
 *      (node --test con --test-concurrency=1 las serializa).
 *
 * Nada de esto toca producción: helpers crea su PROPIO Pool (no createPool()
 * de src/, que exige PGPASSWORD y apunta a videocatalog) y las suites corren
 * en procesos node --test separados contra videocatalog_test.
 */

export const TEST_DATABASE =
    process.env.PGTEST_DATABASE ?? 'videocatalog_test';

export interface TestPoolOptions {
    host?: string;
    port?: number;
    database?: string;
    /** Default 2000ms: el gate debe fallar rápido, no colgar la suite */
    connectionTimeoutMillis?: number;
}

export function createTestPool(
    options: TestPoolOptions = {}
): Pool {
    return new Pool({
        host: options.host ?? process.env.PGHOST ?? 'localhost',
        port: options.port ?? Number(process.env.PGPORT ?? 5432),
        user: process.env.PGUSER ?? 'videouser',
        password: process.env.PGPASSWORD,
        database: options.database ?? TEST_DATABASE,
        connectionTimeoutMillis:
            options.connectionTimeoutMillis ?? 2000
    });
}

/**
 * Gate de disponibilidad. Devuelve:
 *   - false                 → PostgreSQL responde, la suite puede correr.
 *   - string (motivo)       → motivo accionable para pasar a `{ skip }`.
 */
export async function dbSkipReason(
    pool: Pool
): Promise<string | false> {
    try {
        await pool.query('SELECT 1');
        return false;
    } catch (error) {
        const code =
            (error as NodeJS.ErrnoException).code;

        if (code === '3D000') {
            return (
                `La base de test '${pool.options.database}' no existe. ` +
                `Corré: bash scripts/setup-test-db.sh`
            );
        }

        return (
            `PostgreSQL no responde (${code ?? 'desconocido'}). ` +
            `Corré: bash scripts/setup-postgres.sh y verificá el .env`
        );
    }
}

/** Vacía la tabla del catálogo (los tests SIEMPRE parten de estado limpio) */
export async function truncateVideos(
    pool: Pool
): Promise<void> {
    await pool.query('TRUNCATE TABLE videos');
}

/**
 * Metadata de catálogo válida para los tests (mismo algoritmo que
 * UploadService/CatalogSyncJob: id = base64url(relativePath)).
 */
export function buildStoredMetadata(
    fileName: string,
    options: {
        size?: number;
        mediaInfo?: VideoMediaInfo;
    } = {}
): StoredVideoMetadata {
    const mediaInfo =
        options.mediaInfo ?? {
            duration: 10,
            width: 1920,
            height: 1080,
            videoCodec: 'h264'
        };

    return {
        id: Buffer
            .from(fileName)
            .toString('base64url'),
        relativePath: fileName,
        fileName,
        size: options.size ?? 1024,
        extension: '.mp4',
        mediaInfo,
        // La DB gobierna los timestamps (now()): save() los ignora.
        createdAt: new Date(),
        updatedAt: new Date()
    };
}