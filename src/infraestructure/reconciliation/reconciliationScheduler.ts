/**
 * Scheduler del reconciliador de catálogo en RUNTIME.
 * src/infraestructure/reconciliation/reconciliationScheduler.ts
 *
 * SEMÁNTICA BOOT / RUNTIME (sin duplicar lógica):
 *   - CatalogSyncJob.run() es la ÚNICA lógica de fases (fila huérfana →
 *     elimina; archivo sin fila → cataloga; thumbnail faltante → regenera)
 *     y es idempotente: sobre un filesystem estable la 2da corrida es no-op.
 *   - El scheduler decide SOLO la política de error del runtime:
 *       * PG caído en un tick → warn + el tick siguiente reintenta.
 *         Nunca tumbar el proceso: el server ya está vivo y sigue sirviendo
 *         el READ (el catálogo es la DB; la reconciliación es un fondo).
 *       * El boot (server.ts → buildContainer) sigue siendo fail-fast y
 *         NO pasa por este scheduler.
 *
 * GARANTÍA ESTRUCTURAL (crítica):
 *   El scheduler recibe ÚNICAMENTE `run` (el job). NO conoce FileRepository
 *   ni cleanOrphanUploads(): que el timer jamás borre artefactos .tmp/.lock
 *   de un upload ACTIVO es una propiedad del tipo, no una convención.
 *   cleanOrphanUploads() es exclusivamente de boot (container.ts, antes de
 *   listen(), cuando no existen uploads vivos).
 *
 * GUARD DE REENTRADA:
 *   si un tick sigue corriendo cuando llega el siguiente, este se OMITE
 *   (running): un setInterval no debe encolar corridas solapadas de un
 *   reconciliador que presume un snapshot coherente.
 *
 * unref(): el timer no debe mantener vivo el proceso por su cuenta — el
 * server HTTP ya lo mantiene mientras escucha.
 */
export const RECONCILIATION_INTERVAL_MS = 60_000;

export function schedulePeriodicReconciliation(
    run: () => Promise<unknown>,
    intervalMs: number = RECONCILIATION_INTERVAL_MS
): NodeJS.Timeout {

    let running = false;

    const tick = async (): Promise<void> => {
        if (running) {
            // Tick anterior aún ejecutándose: se omite este turno.
            // La convergencia la garantiza el tick siguiente.
            return;
        }

        running = true;

        try {
            await run();
        } catch (error) {
            // PG caído u otro fallo de runtime: degradado a warn. El
            // próximo tick vuelve a intentar; el proceso sigue vivo.
            console.warn(
                '[reconciliación periódica] falló en este tick; ' +
                'se reintentará en el próximo:',
                error
            );
        } finally {
            running = false;
        }
    };

    const timer =
        setInterval(() => {
            void tick();
        }, intervalMs);

    timer.unref();

    return timer;
}