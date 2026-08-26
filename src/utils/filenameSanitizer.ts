const MAX_LENGTH = 200;
const SAFE_CHARS = /[^a-zA-Z0-9._-]/g;

export function sanitizeFilename(raw: string): string | null {
  // ① Reemplazar '\' por '/'
  const normalized = raw.replaceAll('\\', '/');

  // ¿La entrada original era una ruta?
  const isPath = normalized.includes('/');

  // ② Quedarse con el último segmento
  const filename = normalized.split('/').pop() ?? '';

  // ③ Reemplazar caracteres no permitidos
  const sanitized = filename.replace(SAFE_CHARS, '_');

  // ④ Longitud máxima
  if (sanitized.length > MAX_LENGTH) {
    return null;
  }

  // ⑤ Validaciones
  if (
    sanitized === '' ||
    /^\.+$/.test(sanitized) ||
    sanitized.startsWith('.') ||
    (!isPath && !sanitized.includes('.'))
  ) {
    return null;
  }

  // ⑥ Retornar
  return sanitized;
}