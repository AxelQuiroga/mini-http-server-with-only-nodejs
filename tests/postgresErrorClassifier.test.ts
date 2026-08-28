import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    classifyPgError
} from '../src/utils/postgresErrorClassifier.js';

import type {
    PgErrorClass
} from '../src/utils/postgresErrorClassifier.js';

function makeError(
    code: string | undefined,
    message: string,
    syscall?: string
): Error {
    const error = new Error(message);

    if (code !== undefined) {
        (error as NodeJS.ErrnoException).code = code;
    }

    if (syscall !== undefined) {
        (error as NodeJS.ErrnoException).syscall = syscall;
    }

    return error;
}

interface ClassifierCase {
    name: string;
    error: unknown;
    expected: PgErrorClass;
}

const cases: ClassifierCase[] = [
    // ─── DatabaseError (SQLSTATE): rechazo confirmado, statement NO aplicado ──
    {
        name: '40001 serialization_failure',
        error: makeError('40001', 'could not serialize access'),
        expected: 'RETRYABLE'
    },
    {
        name: '40P01 deadlock_detected',
        error: makeError('40P01', 'deadlock detected'),
        expected: 'RETRYABLE'
    },
    {
        name: '57P03 no se puede conectar (PG arrancando)',
        error: makeError('57P03', 'cannot_connect_now'),
        expected: 'RETRYABLE'
    },
    {
        name: '23502 not_null_violation',
        error: makeError('23502', 'null value in column'),
        expected: 'FATAL'
    },
    {
        name: '23505 unique_violation',
        error: makeError('23505', 'duplicate key value'),
        expected: 'FATAL'
    },
    {
        name: '3D000 invalid_catalog_name',
        error: makeError('3D000', 'database does not exist'),
        expected: 'FATAL'
    },
    {
        name: '42601 syntax_error',
        error: makeError('42601', 'syntax error'),
        expected: 'FATAL'
    },
    // ─── Transporte: certeza de que la query NUNCA salió ────────────────────
    {
        name: 'ECONNREFUSED syscall=connect (TCP no establecido)',
        error: makeError('ECONNREFUSED', 'connect ECONNREFUSED', 'connect'),
        expected: 'NOT_EXECUTED'
    },
    {
        name: 'ETIMEDOUT syscall=connect',
        error: makeError('ETIMEDOUT', 'connect ETIMEDOUT', 'connect'),
        expected: 'NOT_EXECUTED'
    },
    {
        name: 'EAI_AGAIN syscall=getaddrinfo (DNS temporal)',
        error: makeError('EAI_AGAIN', 'getaddrinfo EAI_AGAIN', 'getaddrinfo'),
        expected: 'NOT_EXECUTED'
    },
    {
        // C1: SystemError de Node con errno de 5 chars + syscall connect.
        // El code matchea SQLSTATE_PATTERN, pero syscall !== undefined lo
        // descarta de la rama SQLSTATE → cae en la rama de adquisición.
        name: 'E2BIG syscall=connect (errno 5 chars, TCP no establecido)',
        error: makeError('E2BIG', 'connect E2BIG', 'connect'),
        expected: 'NOT_EXECUTED'
    },
    {
        name: 'pool sin conexión libre (timeout exceeded when trying to connect)',
        error: new Error('timeout exceeded when trying to connect'),
        expected: 'NOT_EXECUTED'
    },
    // ─── Transporte: AMBIGUOUS (la query pudo o no haberse enviado) ─────────
    {
        name: 'ECONNRESET syscall=read (respuesta perdida)',
        error: makeError('ECONNRESET', 'read ECONNRESET', 'read'),
        expected: 'AMBIGUOUS'
    },
    {
        name: 'ETIMEDOUT syscall=read (transmisión)',
        error: makeError('ETIMEDOUT', 'read ETIMEDOUT', 'read'),
        expected: 'AMBIGUOUS'
    },
    {
        name: 'Connection terminated unexpectedly',
        error: new Error('Connection terminated unexpectedly'),
        expected: 'AMBIGUOUS'
    },
    {
        name: 'socket hang up',
        error: makeError('ECONNRESET', 'socket hang up'),
        expected: 'AMBIGUOUS'
    },
    {
        // C1: 'write EPIPE' = socket muerto durante el envío. EPIPE matchea
        // SQLSTATE_PATTERN pero trae syscall → NO es SQLSTATE. La query pudo
        // haberse recibido y ejecutado → AMBIGUOUS (jamás FATAL/delete).
        name: 'write EPIPE (SystemError 5 chars con syscall)',
        error: makeError('EPIPE', 'write EPIPE', 'write'),
        expected: 'AMBIGUOUS'
    },
    // ─── Desconocidos: default conservador ─────────────────────────────────
    {
        name: 'error sin code ni syscall',
        error: new Error('algo raro pasó'),
        expected: 'AMBIGUOUS'
    },
    {
        name: 'objeto que no es Error',
        error: { message: 'no soy un Error real' },
        expected: 'AMBIGUOUS'
    },
    {
        name: 'null',
        error: null,
        expected: 'AMBIGUOUS'
    }
];

for (const c of cases) {
    test(`classifyPgError: ${c.name}`, () => {
        assert.equal(
            classifyPgError(c.error),
            c.expected
        );
    });
}