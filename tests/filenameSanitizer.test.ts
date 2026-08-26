import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilename } from '../src/utils/filenameSanitizer.js';

// ─── Grupo A: no romper archivos legítimos ───────────────────────────────

test('un nombre limpio pasa intacto', () => {
  assert.equal(sanitizeFilename('mi-video.mp4'), 'mi-video.mp4');
});

test('los puntos internos son legales', () => {
  assert.equal(sanitizeFilename('mi.video.v2.mp4'), 'mi.video.v2.mp4');
});

// ─── Grupo B: matar path traversal ──────────────────────────────────────

test('ruta relativa con / se reduce al último segmento', () => {
  assert.equal(sanitizeFilename('../../etc/server.ts'), 'server.ts');
});

test('backslashes también se cortan (trampa Linux)', () => {
  assert.equal(sanitizeFilename('..\\..\\evil.mp4'), 'evil.mp4');
});

test('ruta absoluta queda solo con el nombre final', () => {
  assert.equal(sanitizeFilename('/etc/passwd'), 'passwd');
});

// ─── Grupo C: domesticar caracteres raros ───────────────────────────────

test('espacios y signos raros se reemplazan por guión bajo', () => {
  assert.equal(sanitizeFilename('hola mundo!.mp4'), 'hola_mundo_.mp4');
});

test('unicode (acentos) también se reemplaza', () => {
  assert.equal(sanitizeFilename('pepé.mp4'), 'pep_.mp4');
});

// ─── Grupo D: rechazar lo irrecuperable ─────────────────────────────────

test('string vacío devuelve null', () => {
  assert.equal(sanitizeFilename(''), null);
});

test('solo puntos devuelve null', () => {
  assert.equal(sanitizeFilename('..'), null);
});

test('extensión sin nombre devuelve null', () => {
  assert.equal(sanitizeFilename('.mp4'), null);
});

test('nombre sin extensión devuelve null', () => {
  assert.equal(sanitizeFilename('documento'), null);
});

test('nombre demasiado largo devuelve null', () => {
  assert.equal(sanitizeFilename('a'.repeat(201) + '.mp4'), null);
});
