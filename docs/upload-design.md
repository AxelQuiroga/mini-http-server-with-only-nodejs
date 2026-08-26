# Diseño: Upload de videos — `POST /api/upload`

> Documento de decisiones técnicas (ADR). Estado: **APROBADO**.
> Feature: cargar videos desde el frontend, con lógica defensiva.

---

## 1. Objetivo

Permitir que el usuario suba videos desde el navegador. Al terminar, el video entra
al catálogo automáticamente gracias a la arquitectura existente:

```
POST /api/upload → se guarda en public/videos/
                        ↓
        scanDirectoryRecursively lo encuentra solo
                        ↓
        ffprobe le saca metadata solo (lazy)
                        ↓
        ffmpeg genera la thumbnail solo (lazy)
                        ↓
        aparece en el frontend solo
```

Cero cambios en el catálogo: la feature aprovecha la arquitectura existente.

---

## 2. D1 — Protocolo: binario directo (no multipart)

### Qué es

El body del POST ES el archivo (bytes puros). La metadata viaja en headers:

```
POST /api/upload
Content-Type: video/mp4            ← declarado por el cliente (no confiable)
X-Filename: mi-video.mp4           ← encodeURIComponent() en cliente, decodeURIComponent() en server
Content-Length: 734003200          ← declarado por el cliente (no confiable)
Body: <bytes del video>
```

### Por qué no multipart/form-data

El estándar de los `<form>` requiere parsear manualmente el formato multipart
(boundary, partes, headers internos de cada parte) sin librerías. El binario directo
permite streamear `req` directo a disco.

### Consideraciones técnicas

1. **Los headers son metadata, no verdad**: los declara el cliente. Sirven para
   optimizar, nunca para confiar. La validación real se hace sobre contenido.
2. **Content-Length puede mentir o faltar**: Node NO limita el tamaño del body por
   defecto → hay que contar bytes durante el stream además del pre-chequeo.
3. **Backpressure**: siempre `pipeline(req, writeStream)` — maneja la pausa automática
   si el disco es más lento que la red. Nunca pipes manuales ni eventos `data` sueltos.
4. **Timeouts**: un cliente colgado a mitad de subida sostiene memoria + fd → timeout.
5. **Errores a mitad**: `pipeline` destruye los streams ante error → borrar el `.tmp`
   huérfano en el catch.
6. **Espejo del streaming existente**: descargar es `pipeline(fileStream, res)`;
   subir es `pipeline(req, writeStream)`. Mismo patrón, dirección opuesta.

---

## 3. D2 — Lógica defensiva: 5 capas y sus trampas

### Capa 1 — Límite de tamaño

- Pre-chequeo de `Content-Length` (rápido, mentible) + contador de bytes durante el
  stream (confiable, tardío).
- **Trampa del 413 invisible**: al cortar la conexión (`destroy`), el navegador NO ve
  la respuesta 413 — ve error de red (`ERR_CONNECTION_RESET`). Consumir el resto del
  body gigante para dar una respuesta elegante derrocharía recursos.
- **Decisión**: cortar ya (`destroy`) + borrar `.tmp`. El frontend interpreta el
  error de red como "archivo demasiado grande". Eficiencia > elegancia del error.

### Capa 2 — Tipo permitido (whitelist)

- Extensión contra `ALLOWED_EXTENSIONS` (.mp4/.mkv/.webm/.mov/.avi) — rechazo rápido
  de basura obvia.
- **Trampa**: MIME y extensión son declaraciones del cliente (spoofable).
- **Decisión**: validación final con **ffprobe** después de guardar. Si ffprobe no
  puede leerlo como video → borrar + `415 Unsupported Media Type`.
  Reutiliza `MediaRepository.getVideoInfo` como validador gratis.

### Capa 3 — Nombre sanitizado

- **Sanitizar ≠ validar**: sanitizar transforma (`mi peli!?.mp4` → `mi_peli_.mp4`),
  validar rechaza. **Decisión**: sanitizar agresivo (mejor UX, acepta más archivos).
- Pipeline: `path.basename()` (mata path traversal) → regex whitelist `[a-zA-Z0-9._-]`
  (reemplaza el resto por `_`) → límite de longitud (≤ 100 chars) → rechazar vacío,
  solo puntos o sin extensión válida.

### Capa 4 — Colisiones (TOCTOU)

- **Trampa**: check-then-act con dos uploads simultáneos del mismo nombre — entre el
  check y el rename pasan minutos (la duración de la subida). El último rename pisaría
  al primero.
- **Decisión**: flag `'wx'` al abrir el stream (falla atómicamente a nivel SO si
  existe) → `409 Conflict` inmediato, sin carrera posible.

### Capa 5 — Escritura atómica

- Stream a `<nombre>.mp4.tmp` → rename al final (atómico en el mismo filesystem).
  Si la conexión muere a mitad: no queda archivo corrupto en el catálogo.
- **Trampa**: `.tmp` huérfanos si el proceso muere → limpieza al arrancar el server
  (borrar `*.tmp` viejos en public/videos).
- Si muere ENTRE rename y thumbnail: el video entra sin thumbnail y
  `getVideoThumbnail` lazy la genera en el próximo escaneo. Arquitectura resiliente ✓.

---

## 4. D3 — Flujo y auditoría de seguridad

```
POST /api/upload
  → pre-chequeos (Content-Length, filename presente)
  → sanitizeFilename()
  → open 'wx' en public/videos/<sanitized>.tmp   (409 si existe)
  → pipeline(req, writeStream) contando bytes    (413 si excede)
  → rename a <sanitized>                          (escritura atómica)
  → getVideoInfo (ffprobe valida que sea video)   (415 si no lo es)
  → 201 Created { id, title, ... }
  → en cualquier error: borrar .tmp, responder/cortar
```

| Vector | Riesgo | Mitigación |
|--------|--------|------------|
| Path traversal | Alto (clásico) | basename + whitelist chars → destino siempre dentro de videosDir |
| Disco lleno (DoS tamaño) | Alto sin límite | Capa 1 obligatoria |
| Archivo disfrazado | Medio | ffprobe como juez final |
| Stored XSS | Solo con .html | whitelist video-only lo elimina |
| Descarga de lo subido | Es LA función | aceptable |
| Sin autenticación | ⚠️ REAL | **RIESGO ACEPTADO** (MVP personal/LAN) |
| HTTP plano (sin TLS) | ⚠️ REAL | **RIESGO ACEPTADO** (MVP personal/LAN) |

**Veredicto**: seguro para su alcance (media server personal en LAN), con riesgos
aceptados documentados explícitamente. Ingeniería honesta = saber qué se acepta y por qué.

---

## 5. Contrato API

| Status | Cuándo |
|--------|--------|
| `201 Created` | Video guardado y validado |
| `400 Bad Request` | Falta X-Filename / nombre inválido tras sanitizar |
| `409 Conflict` | Ya existe un video con ese nombre |
| `413 Payload Too Large` | Excede el límite de tamaño |
| `415 Unsupported Media Type` | Extensión fuera de whitelist o ffprobe dice "no es video" |
| `500 Internal Server Error` | Error de disco/proceso |

---

## 6. Arquitectura (patrón aplicado: Clean Architecture / Hexagonal)

La feature respeta las capas del proyecto:

| Pieza nueva | Capa | Responsabilidad |
|-------------|------|-----------------|
| `sanitizeFilename()` | `src/utils/` (pura) | string in → string out, testeable como cacheUtils |
| `UploadService` | `src/application/services/` | orquesta defensas y decide status codes |
| Puerto de escritura en `FileRepository` | `src/domain/repositories/` | contrato: stream exclusivo, finalize, cleanup |
| Adaptador en `FileSystemRepository` | `src/infrastructure/filesystem/` | 'wx', .tmp + rename, borrado |
| `UploadController` | `src/presentation/controllers/` | HTTP puro: headers, delega, responde |
| Rama POST `/api/upload` | `src/presentation/routes/router.ts` | routing |
| Wiring | `container.ts` | inyección de dependencias |

Regla de las capas: las DECISIONES (validaciones, límites) viven en utils/application;
la I/O vive en infraestructure; el HTTP vive en presentation. Las dependencias apuntan
hacia adentro (presentation → application → domain), igual que en el resto del proyecto.

---

## 7. Orden de implementación

1. `sanitizeFilename()` pura + sus tests (TDD: test primero, como rangeParser)
2. Puerto de escritura en `FileRepository` + adaptador en `FileSystemRepository`
   ('wx' exclusivo, .tmp + rename, borrado de huérfanos)
3. `UploadService`: pre-chequeos → stream con contador → validación ffprobe
4. `UploadController` (status codes del contrato)
5. Rama en router + wiring en container
6. Pruebas manuales con curl: caso feliz, muy grande, colisión, nombre raro, no-video
7. Frontend: input file + barra de progreso (XMLHttpRequest.upload.onprogress) +
   refresh del catálogo
