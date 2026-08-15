import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseByteRange } from '../src/utils/rangeParser.js';

test('sin header de Range devuelve type none', () => {
  const resultado = parseByteRange(undefined, 1000);
  assert.equal(resultado.type, 'none');
});

test('rango válido bytes=0-10 devuelve start y end', () => {
  const resultado = parseByteRange('bytes=0-10', 1000);
  assert.equal(resultado.type, 'valid');
  assert.deepEqual(resultado.range, { start: 0, end: 10 });
});

test('start igual al tamaño total es inválido (caso 416)', () => {
  const resultado = parseByteRange('bytes=1000-', 1000);
  assert.equal(resultado.type, 'invalid');
});

test('rango abierto al final llega hasta el último byte', () => {
  const resultado = parseByteRange('bytes=0-', 1000);
  assert.equal(resultado.type, 'valid');
  assert.deepEqual(resultado.range, { start: 0, end: 999 });
});

test('start desde 900 hasta el final', () => {
  const resultado = parseByteRange('bytes=900-', 1000);
  assert.equal(resultado.type, 'valid');
  assert.deepEqual(resultado.range, { start: 900, end: 999 });
});

test('start desde 0 hasta 5000', () => {
  const resultado = parseByteRange('bytes=0-5000', 1000);
  assert.equal(resultado.type, 'valid');
  assert.deepEqual(resultado.range, { start: 0, end: 999 });
});

test('end menor que start es inválido', () => {
  const resultado = parseByteRange('bytes=10-5', 1000);
  assert.equal(resultado.type, 'invalid');
});

test('rango sufijo (bytes desde el final)', () => {
  const resultado = parseByteRange('bytes=-500', 1000);
  assert.equal(resultado.type, 'invalid');
});

test('no numérico → NaN', () => {
  const resultado = parseByteRange('bytes=abc-def', 1000);
  assert.equal(resultado.type, 'invalid');
});

test('no empieza con bytes=', () => {
  const resultado = parseByteRange('items=0-10', 1000);
  assert.equal(resultado.type, 'invalid');
});

test('multi-rango (el split(-) da 3 partes)', () => {
  const resultado = parseByteRange('bytes=0-10,20-30', 1000);
  assert.equal(resultado.type, 'invalid');
});

test('sin guión, un solo valor', () => {
  const resultado = parseByteRange('bytes=0', 1000);
  assert.equal(resultado.type, 'invalid');
});