import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRng, rngPick } from '../../js/rng.js';

const take = (rng, n) => Array.from({ length: n }, () => rng());

test('la misma semilla produce la misma secuencia', () => {
  assert.deepEqual(take(createRng(123), 50), take(createRng(123), 50));
});

test('semillas distintas producen secuencias distintas', () => {
  assert.notDeepEqual(take(createRng(123), 10), take(createRng(124), 10));
});

test('los valores están en [0, 1)', () => {
  for (const seed of [0, 1, 2 ** 32 - 1, 987654321]) {
    for (const x of take(createRng(seed), 1000)) assert.ok(x >= 0 && x < 1, `${x} con semilla ${seed}`);
  }
});

test('rngPick elige siempre elementos de la lista y es determinista', () => {
  const list = ['blue', 'red', 'yellow', 'green'];
  const picks = (rng) => Array.from({ length: 100 }, () => rngPick(rng, list));
  const a = picks(createRng(7));
  const b = picks(createRng(7));
  assert.deepEqual(a, b);
  assert.ok(a.every((c) => list.includes(c)));
  assert.equal(new Set(a).size, list.length);
});
