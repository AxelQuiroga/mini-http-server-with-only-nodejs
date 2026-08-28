# Diseño: Catálogo de videos con PostgreSQL — `VideoRepository`

> Documento de decisiones técnicas (ADR). Estado: **APROBADO** → implementación pendiente.
> Etapa: persistir los metadatos de los videos en PostgreSQL local (WSL). Los binarios NO viven en la base de datos.

---

## 1. Objetivo

### Problema actual (verificado en código)

1. Cada `GET /api/videos` ejecuta `scanDirectoryRecursively` + **ffprobe por archivo** (`VideoService.getAllVideos` → `mapToVideoMetadata` → `MediaRepository.getVideoInfo`) → techo **O(n)**. Con ~200 videos, 30-60s por refresh.
2. El mismo endpoint **genera thumbnails en el read path** (`getVideoThumbnail` si no existe el `.jpg`) — otro costo O(n) oculto.
3. La metadata computada durante el upload (`UploadService.uploadVideo` → ffprobe) se **descarta tras la respuesta**.

### Solución

- PostgreSQL como **fuente de verdad del catálogo**: el read path pasa a ser un `SELECT`.
- El write path **persiste lo que ya pagó**: la metadata del ffprobe del upload se guarda, no se tira.
- Un **`CatalogSyncJob`** de arranque reconcilia la consistencia entre filesystem y base de datos.

```
ANTES:
  read:   readdir → ffprobe(n) → thumbnail(n) → response      [O(n) por refresh]
  write:  file → ffprobe → response → mediaInfo DESCARTADO

DESPUÉS:
  read:   SELECT → response                                     [O(1), ~ms]
  write:  file → ffprobe → rename → save() → thumbnail → response
```

---

## 2. D1 — Fuente de verdad dual

| Verdad | Repositorio | Pregunta que responde |
|--------|-------------|----------------------|
| **Existe el archivo** | Filesystem (`FileRepository`) | "¿El binario está físicamente?" |
| **Metadata del catálogo** | PostgreSQL (`VideoRepository`) | "¿Qué es, cuánto dura, códecs?" |

Reglas que rigen todo el diseño:

1. **Los binarios jamás entran a PostgreSQL.** El filesystem/storage es el único hogar del archivo físico.
2. **Una fila solo debe existir describiendo un archivo que existe.** → ordena el flujo de escritura (D3).
3. **Invariante deseado**: `{filas} ↔ {archivos}`. La deriva entre ambos la reconcilia el sync (D4).
4. `FileSystemRepository` conserva el rol de storage; `FFmpegMediaRepository` queda como **analizador efímero** (ffprobe/ffmpeg), nunca como catálogo.

---

## 3. D2 — `relativePath` como identidad lógica

### Qué se persiste y qué no

| Noción | ¿Se persiste? | Por qué |
|--------|:---:|---------|
| `relativePath` (normalizado, forward slashes, relativo a `public/videos`) | **SÍ** | Identidad **lógica** del archivo: de él derivan `id`, `streamUrl`, `thumbnailUrl`. Estable, portable, no depende de la máquina. Es el futuro S3 key. |
| `absolutePath` | **NO** | Efímero, atada a una máquina y ruta de instalación. Se deriva en infraestructura: `join(VIDEOS_ROOT, relativePath)`. |

### Contrato de derivación — preservado 1:1 (verificado en `VideoService`)

Algoritmo real del `id` (NO asumido — leído de `VideoService.mapToVideoMetadata`):

```ts
const normalizedRelativePath = relativeVideoPath.replace(/\\/g, '/');  // ← normalizar SIEMPRE
const id = Buffer.from(normalizedRelativePath).toString('base64url');
```

| Campo | Derivación exacta | Fuente |
|-------|-------------------|--------|
| `id` | `Buffer.from(relativePath).toString('base64url')` | VideoService:79 |
| `thumbnailUrl` | `'/thumbnails/' + id + '.jpg'` | VideoService:84 |
| `streamUrl` | `'/videos/' + relativePath` | VideoService:94 |
| `title` | `formatTitle(basename sin ext)`: `[-_]` → espacio + capitalizar palabras | VideoService:100-104 |
| `fileName` | basename CON extensión | VideoService:91 |

Consecuencias:

- **`relativePath` se almacena SIEMPRE en forma normalizada** (forward slashes) — lo que alimenta `Buffer.from` hoy.
- **base64 es inyectivo sobre bytes** → dos `relativePath` distintos jamás colisionan en `id`. Unicidad garantizada por el UNIQUE de la columna.
- Las URLs y el `title` son **derivación de aplicación** (`VideoService`), no datos almacenados.

---

## 4. D3 — Orden `rename → INSERT` y matriz de fallas

### Regla de oro operativa

> La fila solo describe un archivo que existe → **el rename ocurre ANTES del INSERT**.

Esto hace imposible el caso "INSERT ok pero el archivo no existe".

### Matriz de fallas

| Caso | Cuándo | Decisión | Resultado |
|------|--------|----------|-----------|
| **A. Archivo OK, INSERT falla** | PG caído/transient justo tras el rename | 1 retry → **rollback best-effort**: `FileRepository.deleteVideo('videos/' + fileName)` → si el rollback falla: log `CATALOG ORPHAN` + el sync lo cura en el próximo arranque. En ambos caminos: `UploadError('CATALOG_ERROR')` → **HTTP 500** `{error: "CATALOG_ERROR"}` | Retry del usuario limpio (sin 409 fantasma). Peor caso: archivo huérfano que el sync convierte en fila |
| **B. INSERT ok, archivo falla** | Imposible por orden (rename primero). Solo crash entre ambos | Archivo existe sin fila → **caso D** | Cobertura total por el mismo mecanismo |
| **C. Archivo eliminado a mano** | Usuario borra el binario | El sync detecta fila sin archivo → `deleteByRelativePath` | Catálogo auto-limpio en el próximo arranque |
| **D. Archivo sin metadata** | Drop manual, crash entre rename e INSERT, rollback fallido del caso A | El sync hace `ffprobe → save → thumbnail` | Cura solo |
| **E. Metadata sin archivo** | Idéntico a C, otra causa | Delete de fila en sync | Ídem |

**`CATALOG_ERROR`**: nuevo código de error del contrato API. El frontend gana entrada explícita en `ERROR_CODE_MAP` (sin ella caería al fallback genérico — funcionaría, pero el mensaje quedaría impreciso).

**`deleteVideo(relativePath)`**: método NUEVO en el puerto `FileRepository` (único uso: rollback del caso A). **Idempotente** — ENOENT no es error (misma filosofía que `cancelUpload`). Convención de path idéntica a `getFileMetadata` (`'videos/' + fileName`).

**Window `unlock → rollback` (409 prematuro — documentado, aceptado):** en el caso A, entre `completeUpload` (que libera el lock) y el rollback existe una ventana donde un segundo upload del mismo nombre puede adquirir el lock y recibir `FILE_ALREADY_EXISTS` (409) por un archivo que el primer intento está por destruir. Reintento inmediato → OK (la fila nunca se creó si el rollback fue exitoso). Es **benigno e inherente** al orden lock-antes-de-save: no hay pérdida de datos, y esperar/encolar el lock sería overengineering para una carrera de milisegundos. No se rediseña.

**Decisión postergada (registrada en auditoría, NO implementada):** los FATAL de *configuración* (`28P01` auth fallida, `3D000` catálogo inexistente, `53300` too many connections) destruyen la subida del usuario con rollback aunque el origen sea del server, no del archivo. El rollback es **seguro** (el server rechazó antes de ejecutar — certeza de no-aplicación), pero la política es agresiva: el problema no está en el archivo del usuario. Alternativa futura: clasificar estos FATAL como no-retry → CATALOG ORPHAN **sin** rollback (el binario sobrevive hasta que la config se corrija y el sync fase 2 lo cataloga). Evaluar en la etapa de integración; la matriz actual NO cambia.

---

## 5. D4 — `CatalogSyncJob`: reconciliación en startup

Secuencial. Corre DESPUÉS del schema y ANTES de `server.listen()`.

```
filas   = VideoRepository.listAll()        → Set(relativePath)
files   = FileRepository.listVideos()      → Set(relativePath)

Fase 1 — filas ∖ files → deleteByRelativePath(...)        # filas huérfanas
Fase 2 — files ∖ filas → ffprobe → save() → thumbnail     # archivos sin metadata
Fase 3 — files ∩ filas → getVideoThumbnail(...)           # no-op si el .jpg existe → regeneración
```

- **Fase 2 es la migración inicial**: primera corrida con BD vacía → todos los archivos existentes entran al catálogo. No hace falta script de backfill.
- **Fase 3 es la red de regeneración de thumbnails**: cura los thumbnails fallidos en uploads previos (D6).
- `cleanOrphanUploads` existente sigue cubriendo `.tmp`/`.lock` — responsabilidades separadas, mismo momento de ejecución.
- El sync **nunca borra archivos**: solo filas.

### Limitación conocida (documentada, aceptada)

Con un catálogo M grande, el startup paga **M ffprobe** (fase 2) y M `existsSync` (fase 3). Es el MISMO costo que hoy paga cada `GET /api/videos`, consolidado en un solo momento. Escala mal con el catálogo, y esta etapa lo acepta explícitamente:

- **NO** workers / colas / background sync.
- **NO** intervalos de re-sync.
- Mitigación prevista (fuera de alcance): correr el scan con edad (mtime TTL) o en segundo plano en una etapa futura.

**Segunda limitación (presencia/ausencia, no contenido):** la reconciliación detecta filas sin archivo y archivos sin fila, pero NO detecta un archivo **reemplazado/modificado que conserva el mismo `relativePath`** — la fila queda con metadata vieja hasta que un evento la sobreescriba (upload del mismo nombre → `ON CONFLICT`). Detección de contenido (hash/checksum) o `mtime` queda **explicitamente fuera de esta etapa**: no-goal, sin columnas nuevas.

---

## 6. D5 — ffprobe fuera del read path

`FFmpegMediaRepository.getVideoInfo` deja de ejecutarse en `GET /api/videos`. Sus únicos llamadores:

| Llamador | Por qué |
|----------|---------|
| `UploadService.uploadVideo` | Validación + cómputo de la metadata que se persiste (el costo YA se pagó) |
| `CatalogSyncJob` (fase 2) | Reconciliación de archivos desconocidos |

Zero ffprobe en el read path → el techo O(n) desaparece. El endpoint baja de decenas de segundos a milisegundos; **medición obligatoria** con `console.time` antes/después documentada en esta etapa (semilla de observabilidad).

---

## 7. D6 — Thumbnail como dato derivado

### Hallazgo que obligó esta decisión

Los thumbnails HOY se generan en el **read path** (`VideoService.mapToVideoMetadata` → `getVideoThumbnail` con `existsSync` de guarda). El upload NO los genera. Si el read path pasa a ser solo DB sin reubicar la generación, **ningún video vuelve a tener thumbnail** — el contrato visual del frontend se rompe en silencio.

### Decisión

1. **El thumbnail es un recurso DERIVADO**, regenerable desde el video original. Nunca es fuente de verdad.
2. **Falla de generación ≠ falla de upload**: si falla → `console.warn` + `thumbnailUrl` undefined (semántica IDENTICA a la actual) + el upload continúa exitoso.
3. **Reubicación de la generación:**
   - Upload (post rename+save): `getVideoThumbnail` best-effort (~300ms sobre un flujo de segundos).
   - Sync fase 3: regeneración de faltantes (no-op si el `.jpg` existe).
4. **Read path: nunca genera thumbnails.**

---

## 8. D7 — `VideoRepository`: puerto mínimo

```ts
export interface VideoRepository {
    save(metadata: StoredVideoMetadata): Promise<void>;            // upsert: ON CONFLICT (relative_path)
    listAll(): Promise<StoredVideoMetadata[]>;                     // ORDER BY created_at DESC, relative_path ASC
    deleteByRelativePath(relativePath: string): Promise<void>;     // solo CatalogSyncJob (fila huérfana)
}
```

- **`findByRelativePath` DESCARTADO (YAGNI)**: auditoría de consumidores reales — el upload usa el lock del `FileRepository` (no busca por path), el sync usa `listAll()` una vez (1 query > N queries), el streaming resuelve por `streamUrl` sin pasar por el catálogo, y no hay endpoints de detalle/delete en alcance. Cero consumidores → cero métodos.
- **`StoredVideoMetadata` ≠ `VideoMetadata`**: el repositorio devuelve tipos de dominio (`id`, `relativePath`, `fileName`, `size`, `extension`, `mediaInfo`, `createdAt`, `updatedAt`). Las URLs y el `title` son derivación de `VideoService` (capa de aplicación) → el contrato HTTP de `GET /api/videos` no cambia ni un byte.

### `ON CONFLICT` — preservación de `created_at`

```sql
ON CONFLICT (relative_path) DO UPDATE SET
    file_name = EXCLUDED.file_name,
    size = EXCLUDED.size,
    extension = EXCLUDED.extension,
    duration = EXCLUDED.duration,
    width = EXCLUDED.width,
    height = EXCLUDED.height,
    video_codec = EXCLUDED.video_codec,
    audio_codec = EXCLUDED.audio_codec,
    fps = EXCLUDED.fps,
    updated_at = now()
    -- created_at NO aparece → se preserva del INSERT original
```

---

## 9. Modelo de datos

```sql
CREATE TABLE IF NOT EXISTS videos (
    id             TEXT PRIMARY KEY,             -- base64url(relative_path) — mismo algoritmo que thumbnails
    relative_path  TEXT NOT NULL UNIQUE,         -- identidad lógica del archivo (normalizada, forward slashes)
    file_name      TEXT NOT NULL,                -- nombre sanitizado con extensión
    size           BIGINT NOT NULL,              -- bytes (fs.stat puede exceder 32 bits)
    extension      TEXT NOT NULL,                -- .mp4
    duration       DOUBLE PRECISION NOT NULL,
    width          INTEGER NOT NULL,             -- requerido por el dominio (fallback 0 de ffprobe)
    height         INTEGER NOT NULL,
    video_codec    TEXT NOT NULL,                -- requerido (fallback 'unknown' de ffprobe)
    audio_codec    TEXT,                         -- NULL si no tiene audio (opcional en dominio)
    fps            DOUBLE PRECISION,             -- NULL si no aplica (opcional en dominio)
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Decisiones:

- **`id` = `base64url(relative_path)`, NO serial**: preserva el contrato de URLs del frontend (`/thumbnails/{id}.jpg`). Persistirlo (no recalcularlo por lectura) lo vuelve estable.
- **NULL ↔ `undefined`**: los campos OPCIONALES del dominio (`audioCodec`, `fps`) son NULL en la DB y se mapean a `undefined` en el dominio — cuidado con `exactOptionalPropertyTypes` (null nunca es `string`). Los REQUERIDOS (`width`, `height`, `videoCodec`) son NOT NULL, espejando `VideoMediaInfo` (ffprobe garantiza valores con fallbacks).
- **`TIMESTAMPTZ`**: instante absoluto, no hora local del server.
- **`BIGINT` / `DOUBLE PRECISION`**: `size` puede superar 2GB (límite INT); `duration` y `fps` son racionales de ffprobe.
- **Schema idempotente** (`CREATE TABLE IF NOT EXISTS`) aplicado al arranque — UNA tabla no justifica un framework de migraciones (ver no-goals).

---

## 10. Configuración — variables de entorno

- Variables **estándar de node-postgres**: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` — el driver las lee solo, cero código de parsing.
- **`.env` gitignoreado** + **`.env.example`** commiteado con placeholders.
- Carga: `--env-file` nativo de Node 22 (cero dependencias) — verificar que `tsx` pase el flag; fallback `dotenv`.
- **`PGPASSWORD` sin default → fail-fast** con mensaje accionable ("copiá `.env.example` a `.env`").
- Nunca loguear la password.
- **PostgreSQL es obligatorio**: sin conexión (`SELECT 1`) el proceso muere ANTES de `listen()` con error claro indicando `sudo service postgresql start`. No existe estado parcialmente funcional.

---

## 11. Estrategia de tests

| Capa | Qué cubre | Infraestructura |
|------|-----------|-----------------|
| **Unit** | `VideoService` con `VideoRepository` fake: contrato de derivación (id/URLs/title), shape HTTP idéntico. Mapeo row→dominio con pool stub: NULL→undefined, tipos. | Sin DB, siempre verdes |
| **Integración (PG local)** | `save`→`listAll`; upsert idempotente preservando `created_at`; orden `created_at DESC`; **sync fases 1-2-3** (fila sin archivo → borrada; archivo sin fila → insert con metadata correcta; thumbnail faltante → regenerado); **falla caso A** (pool que rechaza → estado final consistente); **concurrencia** (2 uploads mismo nombre → 1 éxito + 1×409 + EXACTAMENTE 1 fila) | Script `test:integration`, gateado por disponibilidad de PG (skip claro si no responde) |

`npm test` (unit) sigue verde sin DB; el setup de WSL es prerequisito documentado de `test:integration`, no una muralla.

---

## 12. No-goals — overengineering explícito

| NO | Por qué |
|----|---------|
| Framework de migraciones (Prisma/drizzle/node-pg-migrate) | UNA tabla → `db/migrations/001_init.sql` idempotente alcanza |
| ORM | El SQL plano es el punto de la etapa |
| Workers/colas para ffprobe | Un video por upload; no hay cola que vaciar; limitación del sync aceptada (D4) |
| Redis / cache de metadata | La DB YA es el cache; el `SELECT` es barato |
| Replicas de lectura / particionado | Sin carga que lo justifique |
| Docker para PostgreSQL en WSL | Es un laboratorio local; `apt` alcanza |
| Endpoint DELETE de videos | No hay UI de borrado; el sync cubre el borrado manual |
| Uploads resumibles (tus) | Fuera del alcance de metadata |

---

## 13. Orden de implementación

```
[0]  Setup PostgreSQL en WSL: apt install + role/db + service start + pg_isready
[1]  docs/postgres-metadata-design.md          ← este ADR (APROBADO por el usuario)
[2]  src/domain/types/catalog.types.ts         → StoredVideoMetadata
[3]  db/migrations/001_init.sql + applicator    → schema idempotente
[4]  src/domain/repositories/VideoRepository.ts → port (3 métodos, YAGNI)
[5]  src/infraestructure/database/Pool.ts       → conexión + fail-fast accionable
[6]  src/infraestructure/database/PostgresVideoRepository.ts → impl (parametrizado, ON CONFLICT, row→dominio)
[7]  FileRepository + FileSystemRepository      → + deleteVideo(relativePath) idempotente
[8]  src/application/services/CatalogSyncJob.ts → fases 1-2-3, secuencial
[9]  UploadService                              → save post-rename + rollback + CATALOG_ERROR + thumbnail best-effort
[10] VideoService                               → getAllVideos() = listAll() + derivación (sin ffprobe/thumbnails)
[11] container.ts + server.ts                   → bootstrap async fail-fast antes de listen()
[12] .env / .env.example / carga + gitignore    → PG* estándar
[13] frontend: ERROR_CODE_MAP + CATALOG_ERROR   → mensaje explícito
[14] tests unit + integración + concurrencia    → test:integration gateado
[15] Medición: console.time GET /api/videos antes/después (documentada)
```