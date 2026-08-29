import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
    PostgresVideoRepository
} from '../../src/infraestructure/database/PostgresVideoRepository.js';

import {
    applySchema
} from '../../src/infraestructure/database/schema.js';

import {
    createTestPool,
    dbSkipReason,
    truncateVideos,
    buildStoredMetadata
} from './helpers.js';

/**
 * INTEGRATION — PostgresVideoRepository contra PostgreSQL REAL
 * (videocatalog_test). Demuestra las garantías del ADR que un fake no
 * puede: upsert idempotente real (ON CONFLICT), timestamps gobernados por
 * la DB (now()), conversión BIGINT→number y NULL→propiedad ausente, y
 * ordenamiento determinístico.
 *
 * Gating: si PostgreSQL no responde o videocatalog_test no existe, la suite
 * entera se salta con `{ skip }` (mensaje accionable) — jamás falla falso
 * en un entorno sin DB.
 */

const pool = createTestPool();
const skip = await dbSkipReason(pool);

const repo = new PostgresVideoRepository(pool);

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) =>
        setTimeout(resolve, ms));
}

before(async () => {
    if (!skip) {
        await applySchema(pool);
        await truncateVideos(pool);
    }
});

after(async () => {
    await pool.end();
});

// ─── Upsert idempotente ──────────────────────────────────────────────────

test(
    'save() dos veces con el mismo relativePath → 1 sola fila '
    + '(ON CONFLICT DO UPDATE es no-op lógico)',
    { skip },
    async () => {
        await truncateVideos(pool);

        await repo.save(buildStoredMetadata('a.mp4'));
        await repo.save(buildStoredMetadata('a.mp4'));

        const { rows } = await pool.query<{ n: number }>(
            'SELECT COUNT(*)::int AS n FROM videos'
        );

        assert.ok(rows[0]);
        assert.equal(rows[0].n, 1);
    }
);

// ─── Timestamps gobernados por la DB ─────────────────────────────────────

test(
    'el upsert PRESERVA created_at y AVANZA updated_at (now())',
    { skip },
    async () => {
        await truncateVideos(pool);

        const stored = buildStoredMetadata('t.mp4');
        await repo.save(stored);

        const read = async () => {
            const { rows } = await pool.query<{
                created_at: Date;
                updated_at: Date;
            }>(
                'SELECT created_at, updated_at FROM videos '
                + 'WHERE relative_path = $1',
                ['t.mp4']
            );
            return rows[0];
        };

        const first = await read();
        assert.ok(first);

        await sleep(40);

        // Misma identidad, metadata distinta → DO UPDATE debe aplicar
        await repo.save({
            ...stored,
            size: 99999
        });

        const second = await read();
        assert.ok(second);

        assert.equal(
            second.created_at.getTime(),
            first.created_at.getTime(),
            'created_at no debe cambiar en el conflicto'
        );
        assert.ok(
            second.updated_at.getTime() >
                first.updated_at.getTime(),
            'updated_at debe avanzar (now() sobre el DO UPDATE)'
        );

        // Y el DO UPDATE aplicó la metadata nueva (no quedó la vieja)
        const [updated] = await repo.listAll();
        assert.ok(updated);
        assert.equal(updated.size, 99999);
    }
);

// ─── Conversión de tipos (gotchas reales de node-postgres) ──────────────

test(
    'round-trip: BIGINT size → number; NULL audio_codec/fps → '
    + 'propiedades AUSENTES (exactOptionalPropertyTypes)',
    { skip },
    async () => {
        await truncateVideos(pool);

        // > 2^31 para forzar el problema de precisión del int4;
        // node-postgres entrega BIGINT como STRING (documentado).
        const big = 3_000_000_000;

        await repo.save(buildStoredMetadata('big.mp4', { size: big }));

        // 1) El gotcha crudo existe (el driver trae string)...
        const raw = await pool.query<{ size: string }>(
            'SELECT size FROM videos'
        );
        assert.ok(raw.rows[0]);
        assert.equal(typeof raw.rows[0].size, 'string');

        // 2) ...y el adaptador lo normaliza a number
        const [row] = await repo.listAll();
        assert.ok(row);
        assert.equal(row.size, big);
        assert.equal(typeof row.size, 'number');

        // 3) NULL (DB) → propiedad ausente (dominio)
        assert.equal(row.mediaInfo.audioCodec, undefined);
        assert.equal(row.mediaInfo.fps, undefined);
        assert.ok(
            !('audioCodec' in row.mediaInfo),
            'la key no debe existir (no undefined explícito)'
        );
        assert.ok(!('fps' in row.mediaInfo));
    }
);

test(
    'round-trip completo: audioCodec presente y fps decimal sobreviven',
    { skip },
    async () => {
        await truncateVideos(pool);

        await repo.save(buildStoredMetadata('full.mp4', {
            mediaInfo: {
                duration: 12.5,
                width: 1280,
                height: 720,
                videoCodec: 'avc1',
                audioCodec: 'aac',
                fps: 29.97
            }
        }));

        const [row] = await repo.listAll();
        assert.ok(row);

        assert.equal(row.mediaInfo.audioCodec, 'aac');
        assert.equal(row.mediaInfo.fps, 29.97);
        assert.equal(row.mediaInfo.duration, 12.5);
        assert.equal(row.relativePath, 'full.mp4');
    }
);

// ─── Borrado selectivo ───────────────────────────────────────────────────

test(
    'deleteByRelativePath borra SOLO la fila indicada',
    { skip },
    async () => {
        await truncateVideos(pool);

        await repo.save(buildStoredMetadata('keep.mp4'));
        await repo.save(buildStoredMetadata('drop.mp4'));

        await repo.deleteByRelativePath('drop.mp4');

        const rows = await repo.listAll();
        assert.equal(rows.length, 1);
        assert.ok(rows[0]);
        assert.equal(rows[0].relativePath, 'keep.mp4');
    }
);

// ─── Orden determinístico ────────────────────────────────────────────────

test(
    'listAll ordena created_at DESC + relative_path ASC (determinístico)',
    { skip },
    async () => {
        await truncateVideos(pool);

        await repo.save(buildStoredMetadata('older.mp4'));
        await sleep(40);
        await repo.save(buildStoredMetadata('newer.mp4'));

        const byTime = await repo.listAll();
        assert.ok(byTime[0]);
        assert.ok(byTime[1]);
        assert.equal(byTime[0].relativePath, 'newer.mp4');
        assert.equal(byTime[1].relativePath, 'older.mp4');

        await repo.save(buildStoredMetadata('b-tie.mp4'));
        await repo.save(buildStoredMetadata('a-tie.mp4'));

        // Empate REAL de created_at: dos now() podrían caer en microsegundos
        // distintos y volver el test frágil → forzamos timestamps idénticos
        // con SQL directo para probar la CLAÚSULA del repo (DESC + ASC),
        // no la igualdad de now().
        await pool.query(
            "UPDATE videos SET created_at = TIMESTAMPTZ '2026-01-01 00:00:00' "
            + "WHERE relative_path IN ('a-tie.mp4', 'b-tie.mp4')"
        );

        const ties = await repo.listAll();
        assert.ok(ties[0]);
        assert.ok(ties[1]);
        assert.ok(ties[2]);
        assert.ok(ties[3]);

        // DESC manda: los ties (2026) van después de older/newer (hoy)
        assert.equal(ties[0].relativePath, 'newer.mp4');
        assert.equal(ties[1].relativePath, 'older.mp4');

        // Mismo created_at → desempate ASC por relative_path: a-tie < b-tie
        assert.equal(ties[2].relativePath, 'a-tie.mp4');
        assert.equal(ties[3].relativePath, 'b-tie.mp4');
    }
);