FASE 1 ─── FUNDAMENTOS HTTP
             │
             ├── GET                         ✅
             ├── Static files                ✅
             ├── MIME types                  ✅
             ├── Streams                     ✅
             ├── Range requests              ✅
             ├── 206 Partial Content         ✅
             ├── 416 Range Not Satisfiable   ✅
             └── API /api/videos             ✅

FASE 2 ─── FRONTEND
             │
             ├── Biblioteca                  ✅
             ├── Video seleccionado          ✅   
             ├── Loading states              ✅
             ├── Error states                ✅
             ├── Búsqueda                    ✅
             └── Responsive UI               ✅

FASE 3 ─── HTTP PROFESIONAL       
             │
             ├── HEAD                        ✅
             ├── ETag                        ✅
             ├── Last-Modified               ✅
             ├── 304                         ✅
             ├── Cache-Control               ✅
             └── mejor manejo de errores     ✅

FASE 4 ─── MEDIA     
             │
             ├── thumbnails                  ✅               
             ├── metadata                    ✅
             ├── duración                    ✅
             ├── formatos                    ✅
             └── ffmpeg                      ✅

FASE 5 ─── ARQUITECTURA    ← AHORA
             │
             ├── interfaces
             ├── repositories
             ├── dependency injection
             ├── tests
             └── separación de dominio/infraestructura
FASE 5 — ARQUITECTURA

[ ] Definir dominio
[ ] Separar dominio de infraestructura
[ ] Crear interfaces
[ ] Crear VideoRepository
[ ] Implementar FileSystemVideoRepository
[ ] Abstraer FFprobe
[ ] Dependency Injection manual
[ ] Refactorizar VideoService
[ ] Unit tests
[ ] Integration tests
[ ] Mantener funcionando API
[ ] Mantener funcionando streaming



FASE 6 ─── PRODUCCIÓN
             │
             ├── Docker
             ├── logging
             ├── configuración
             ├── límites
             ├── seguridad
             └── deployment



src/
├── domain/
│   ├── repositories/
│   └── types/
│
├── application/
│   └── services/
│       └── VideoService.ts
│
├── infrastructure/
│   ├── filesystem/
│   │   └── FileSystemRepository.ts
│   └── media/
│       └── FFmpegMediaRepository.ts
│
├── presentation/
│   ├── controllers/
│   │   ├── StaticFileController.ts
│   │   └── VideoController.ts
│   └── routes/
│       └── router.ts
│
└── server.ts
StaticFileController
        │
        ▼
  FileRepository   ← contrato
        ▲
        │
FileSystemRepository ← implementación concreta