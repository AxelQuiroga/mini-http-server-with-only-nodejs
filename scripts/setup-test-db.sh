#!/usr/bin/env bash
#
# Crea la base de datos de TEST 'videocatalog_test' (PostgreSQL local WSL) — IDEMPOTENTE.
# 1) Verifica el estado del entorno de desarrollo (setup-postgres.sh ya corrido).
# 2) Crea videocatalog_test (owner videouser) si no existe.
#
# Uso:   bash scripts/setup-test-db.sh
# Pre:   bash scripts/setup-postgres.sh (rol + .env con PGPASSWORD)
#
# Si sudo pide password en un contexto no interactivo (CI/agent):
#   wsl -d Ubuntu-24.04 -u root -- bash -lc 'cd ~/node-streams && bash scripts/setup-test-db.sh'
#
# El SCHEMA NO se crea aquí a propósito: applySchema()
# (src/infraestructure/database/schema.ts) se ejecuta al inicio de CADA suite de
# integración (CREATE IF NOT EXISTS, idempotente) — los tests corren siempre
# contra el migration más reciente, sin estado fantasma pre-cableado.
#
set -euo pipefail

cd "$(dirname "$0")/.." # raíz del proyecto

ENV_FILE=".env"
PG_USER="${PG_USER:-videouser}"
PG_TEST_DB="${PGTEST_DATABASE:-videocatalog_test}"

echo "==> [1/4] verificando $ENV_FILE"
if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: falta $ENV_FILE. Ejecutá primero: bash scripts/setup-postgres.sh" >&2
    exit 1
fi

PG_PASSWORD_VALUE="$(grep '^PGPASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
if [ -z "$PG_PASSWORD_VALUE" ]; then
    echo "ERROR: $ENV_FILE no define PGPASSWORD. Ejecutá primero: bash scripts/setup-postgres.sh" >&2
    exit 1
fi

echo "==> [2/4] verificando servicio PostgreSQL"
if pg_isready -q; then
    echo "    PostgreSQL ya está arriba — sin sudo"
else
    echo "    arrancando servicio (WSL: sin systemd)"
    # sudo -n: jamás pedir password interactiva (cuelga sin tty).
    # Si el sudo requiere password, el mensaje del rol lo va a avisar.
    sudo -n service postgresql start || {
        echo "ERROR: no pude arrancar PostgreSQL sin password. " >&2
        echo "       Corré a mano: sudo service postgresql start" >&2
        exit 1
    }
fi

echo "==> [3/4] verificando rol '$PG_USER'"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${PG_USER}'" | grep -q 1; then
    echo "ERROR: el rol '$PG_USER' no existe. Ejecutá primero: bash scripts/setup-postgres.sh" >&2
    exit 1
fi

echo "==> [3.5/4] creando base de TEST '$PG_TEST_DB' (si no existe)"
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_TEST_DB}'" | grep -q 1; then
    echo "    base ya existe — respetada"
else
    sudo -u postgres createdb -O "${PG_USER}" "${PG_TEST_DB}"
fi

echo "==> [4/4] verificación (conexión con el rol de aplicación)"
PGPASSWORD="${PG_PASSWORD_VALUE}" psql -h localhost -U "${PG_USER}" -d "${PG_TEST_DB}" -tAc "SELECT 'TEST_DB_OK'"

echo "SETUP_TEST_DB_OK"