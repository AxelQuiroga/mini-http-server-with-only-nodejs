import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCacheValid, generateETag } from '../src/utils/cacheUtils.js';
// Helper: el mismo metadata para todos los tests
function makeMetadata() {
  return { size: 100, extension: '.mp4', modifiedTime: new Date(1234567890) };
}

// 1. El valor EXACTO: 100 → hex "64", 1234567890 → hex "499602d2"
test('generateETag devuelve el valor exacto', () => {
  const etag = generateETag(makeMetadata());
  assert.equal(etag, 'W/"64-499602d2"');
});

// 2. Determinismo: misma entrada → misma salida
test('generateETag es determinístico', () => {
  const etag1 = generateETag(makeMetadata());
  const etag2 = generateETag(makeMetadata());
  assert.equal(etag1, etag2);
});

// 3. Si cambia el tamaño, el ETag cambia
test('generateETag cambia si cambia el tamaño', () => {
  const original = generateETag(makeMetadata());
  const conOtroTamanio = generateETag({ ...makeMetadata(), size: 101 });
  assert.notEqual(original, conOtroTamanio);
});

// 4. Si cambia la fecha de modificación, el ETag cambia
test('generateETag cambia si cambia la fecha', () => {
  const original = generateETag(makeMetadata());
  const conOtraFecha = generateETag({ ...makeMetadata(), modifiedTime: new Date(999999999) });
  assert.notEqual(original, conOtraFecha);
});

test('If-None-Match que coincide devuelve true (304)', () => {
  const etag = generateETag(makeMetadata());
  const resultado = isCacheValid({ ifNoneMatch: etag }, etag, new Date(1234567890));
  assert.equal(resultado, true);
});

test('If-None-Match que NO coincide devuelve false (200)', () => {
  const etag = generateETag(makeMetadata());
  const resultado = isCacheValid({ ifNoneMatch: 'W/"otro"' }, etag, new Date(4535));
  assert.equal(resultado, false);
});

test('el comodin, tenes archivo? si, devuelve true', () => {
  const etag = generateETag(makeMetadata());
  const resultado = isCacheValid({ ifNoneMatch: "*" }, etag, new Date(1234567890));
  assert.equal(resultado, true);
});