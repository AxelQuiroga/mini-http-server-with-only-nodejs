import type {
    StoredVideoMetadata
} from '../types/catalog.types.js';

/**
 * Puerto del catálogo (fuente de verdad: PostgreSQL).
 *
 * El filesystem sigue siendo la fuente de verdad de la EXISTENCIA del archivo;
 * este repositorio es la fuente de verdad de la METADATA del catálogo.
 * El CatalogSyncJob reconcilia ambos (filas ∖ archivos → delete; archivos ∖ filas → save).
 *
 * YAGNI (auditado contra casos de uso reales en docs/postgres-metadata-design.md):
 * NO hay findByRelativePath — ningún consumidor lo necesita.
 */
export interface VideoRepository {

    /**
     * Upsert: INSERT ... ON CONFLICT (relative_path) DO UPDATE.
     * El conflicto actualiza SOLO metadata mutable + updated_at;
     * created_at se preserva del INSERT original.
     */
    save(
        metadata: StoredVideoMetadata
    ): Promise<void>;

    /**
     * Catálogo completo, ordenado explícitamente por created_at DESC
     * (tiebreak determinístico: relative_path ASC).
     * NUNCA ejecuta ffprobe (read path = SELECT puro).
     */
    listAll(): Promise<StoredVideoMetadata[]>;

    /**
     * Solo para CatalogSyncJob: elimina una fila cuyo archivo físico
     * ya no existe (fila huérfana). No toca archivos.
     */
    deleteByRelativePath(
        relativePath: string
    ): Promise<void>;
}