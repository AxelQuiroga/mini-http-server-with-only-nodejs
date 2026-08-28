import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Pool } from 'pg';

const migrationsDir =
    join(process.cwd(), 'db', 'migrations');

/**
 * Aplica db/migrations/*.sql en orden alfabético (001_*, 002_*, ...).
 *
 * Idempotencia: cada .sql usa CREATE IF NOT EXISTS — re-ejecutar es seguro.
 * Ejecutar ANTES de CatalogSyncJob y de server.listen() (fail-fast sin DB).
 *
 * UNA tabla no justifica un framework de migraciones (ver ADR, no-goals):
 * un folder .sql + este aplicator mínimo alcanza.
 */
export async function applySchema(
    pool: Pool
): Promise<void> {
    const migrations =
        readdirSync(migrationsDir)
            .filter((name) =>
                name.endsWith('.sql'))
            .sort();

    for (const migration of migrations) {
        const sql =
            readFileSync(
                join(migrationsDir, migration),
                'utf8'
            );

        await pool.query(sql);

        console.log(
            `[applySchema] ${migration} aplicada`
        );
    }
}