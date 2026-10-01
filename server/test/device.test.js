import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectMobile, IS_MOBILE } from '../../js/device.js';

const env = (pointer, maxTouchPoints) => ({
  matchMedia: (query) => ({ matches: query === `(pointer: ${pointer})` }),
  maxTouchPoints,
});

test('puntero coarse con toques es móvil', () => {
  assert.equal(detectMobile(env('coarse', 5)), true);
});

test('puntero fine (ratón o trackpad) es escritorio aunque la pantalla sea táctil', () => {
  assert.equal(detectMobile(env('fine', 10)), false);
});

test('sin puntos de toque es escritorio', () => {
  assert.equal(detectMobile(env('coarse', 0)), false);
  assert.equal(detectMobile({ matchMedia: env('coarse').matchMedia }), false);
});

test('sin matchMedia no se considera móvil', () => {
  assert.equal(detectMobile({ maxTouchPoints: 5 }), false);
  assert.equal(detectMobile(undefined), false);
});

test('fuera del navegador IS_MOBILE es false', () => {
  assert.equal(IS_MOBILE, false);
});
