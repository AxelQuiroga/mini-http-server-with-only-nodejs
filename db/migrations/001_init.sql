-- Etapa PostgreSQL: catálogo de metadata de videos (sin binarios).
-- Idempotente (CREATE TABLE IF NOT EXISTS): se aplica en cada bootstrap, ANTES de
-- CatalogSyncJob y de server.listen().
--
-- Decisiones documentadas en docs/postgres-metadata-design.md (ADR):
--   * relative_path = identidad lógica (normalizada, forward slashes) — futuro S3 key
--   * id = base64url(relative_path) — contrato preservado del frontend (thumbnails/stream)
--   * NULL solo en los campos OPCIONALES del dominio (audioCodec, fps)
--   * TIMESTAMPTZ = instante absoluto, vía created_at/updated_at
CREATE TABLE IF NOT EXISTS videos (
    id            TEXT PRIMARY KEY,            -- base64url(relativePath)
    relative_path TEXT NOT NULL UNIQUE,        -- identidad lógica del archivo
    file_name     TEXT NOT NULL,               -- nombre sanitizado con extensión
    size          BIGINT NOT NULL,             -- bytes (fs.stat puede exceder 32 bits)
    extension     TEXT NOT NULL,               -- .mp4
    duration      DOUBLE PRECISION NOT NULL,
    width         INTEGER NOT NULL,            -- requerido por el dominio (fallback 0 de ffprobe)
    height        INTEGER NOT NULL,
    video_codec   TEXT NOT NULL,               -- requerido (fallback 'unknown' de ffprobe)
    audio_codec   TEXT,                        -- opcional en el dominio
    fps           DOUBLE PRECISION,            -- opcional en el dominio
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_videos_relative_path ON videos (relative_path);