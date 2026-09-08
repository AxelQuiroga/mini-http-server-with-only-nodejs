import { createServer } from "http";
import { handleRoutes } from "./presentation/routes/router.js";
import { buildContainer } from "./infraestructure/composition/container.js";
import { schedulePeriodicReconciliation } from "./infraestructure/reconciliation/reconciliationScheduler.js";

const PORT = process.env.PORT || 3000;

// Bootstrap completo en el composition root: pool → SELECT 1 → schema →
// repositories/services → sync → controllers. Cualquier fallo obligatorio
// aborta el proceso ANTES de listen(): no existe modo degradado sin PostgreSQL.
const container =
    await buildContainer();

const server = createServer(async (req, res) => {

    try {
        await handleRoutes(req, res, container);
    } catch (error) {
        console.error('Unhandled error: ', error);
        res.writeHead(500, {'content-type': 'application/json'});
        res.end(JSON.stringify({ error: 'Internal Server Error'}));

    }
})

server.listen(PORT, () => {
    console.log(`Servidor HTTP nativo corriendo en http://localhost:${PORT}`)

    // ─── Reconciliación periódica en RUNTIME ────────────────────────────
    // El boot ya corrió el sync fail-fast dentro de buildContainer() con
    // cleanOrphanUploads() ANTES de listen(). Este timer corre SOLO las
    // fases de reconcilación (CatalogSyncJob.run) cada 60s para que las
    // inconsistencias convergean sin reiniciar.
    //
    // El scheduler recibe únicamente el job: jamás cleanOrphanUploads().
    // En runtime puede existir legítimamente .tmp/.lock de un upload ACTIVO;
    // limpiarlos sería borrar una subida en curso — boot-only por diseño.
    schedulePeriodicReconciliation(
        () => container.catalogSyncJob.run()
    );
})