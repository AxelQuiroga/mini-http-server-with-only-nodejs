import type { RangeParseResult } from '../domain/types/RangeParse.js';
/**
 * Parsea y valida únicamente los formatos:
 * - bytes=start-end (ej: bytes=0-1024)
 * - bytes=start-    (ej: bytes=1024-)
 * 
 * Devuelve `ByteRange` si es un rango válido.
 * Devuelve `null` si no hay header, si el formato no coincide o si el rango es fuera de límites.
 */
export function parseByteRange(
  rangeHeader: string | undefined,
  totalFileSize: number
): RangeParseResult {

  if (!rangeHeader) {
    return { type: 'none' };
  }

  if (!rangeHeader.startsWith('bytes=')) {
    return { type: 'invalid' };
  }

  const rawRange = rangeHeader.replace('bytes=', '').trim();
  const rangeValues = rawRange.split('-');

  if (rangeValues.length !== 2) {
    return { type: 'invalid' };
  }

  const startStr = rangeValues[0] ?? '';
  const endStr = rangeValues[1] ?? '';

  // MVP: no soportamos bytes=-500
  if (startStr === '') {
    return { type: 'invalid' };
  }

  const start = parseInt(startStr, 10);

  if (
    Number.isNaN(start) ||
    start < 0 ||
    start >= totalFileSize
  ) {
    return { type: 'invalid' };
  }

  let end: number;

  if (endStr === '') {
    end = totalFileSize - 1;
  } else {
    end = parseInt(endStr, 10);

    if (Number.isNaN(end) || end < start) {
      return { type: 'invalid' };
    }

    end = Math.min(end, totalFileSize - 1);
  }

  return {
    type: 'valid',
    range: { start, end }
  };
}