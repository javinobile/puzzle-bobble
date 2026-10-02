import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET, message, validateClientMessage, validateRelay } from '../../js/net/protocol.js';

const valid = (fields) => validateClientMessage(message(fields.t, fields));

test('el alfabeto de códigos no contiene I ni O', () => {
  assert.ok(!ROOM_CODE_ALPHABET.includes('I'));
  assert.ok(!ROOM_CODE_ALPHABET.includes('O'));
});

test('message() añade la versión del protocolo', () => {
  assert.deepEqual(message('leave'), { v: PROTOCOL_VERSION, t: 'leave' });
});

test('acepta todos los mensajes válidos', () => {
  assert.ok(valid({ t: 'create', nick: 'JAV' }));
  assert.ok(valid({ t: 'create', nick: 'A1' }));
  assert.ok(valid({ t: 'join', code: 'KXQM', nick: 'P2' }));
  assert.ok(valid({ t: 'resume', token: '2f1c9a7e-8b3d-4c5e-9f00-123456789abc' }));
  assert.ok(valid({ t: 'leave' }));
  assert.ok(valid({ t: 'ping', ts: 123.4 }));
  assert.ok(valid({ t: 'relay', data: { anything: [1, 2, 3] } }));
  assert.ok(valid({ t: 'relay', data: null }));
  assert.ok(valid({ t: 'rematch' }));
});

test('rechaza apodos inválidos', () => {
  for (const nick of ['', 'ABCD', 'jav', 'A B', 'Ñ', 42, undefined]) {
    assert.equal(valid({ t: 'create', nick }), false, `nick ${nick}`);
  }
});

test('rechaza códigos de sala inválidos', () => {
  for (const code of ['KXQ', 'KXQMM', 'kxqm', 'KXIO', 'KX1M', 1234, undefined]) {
    assert.equal(valid({ t: 'join', code, nick: 'JAV' }), false, `code ${code}`);
  }
});

test('rechaza versión, tipo o forma incorrectos', () => {
  assert.equal(validateClientMessage({ v: 1, t: 'leave' }), false);
  assert.equal(validateClientMessage({ v: PROTOCOL_VERSION + 1, t: 'leave' }), false);
  assert.equal(validateClientMessage({ t: 'leave' }), false);
  assert.equal(validateClientMessage(message('welcome')), false);
  assert.equal(validateClientMessage(message('toString')), false);
  assert.equal(validateClientMessage(message('__proto__')), false);
  assert.equal(validateClientMessage(null), false);
  assert.equal(validateClientMessage('leave'), false);
  assert.equal(validateClientMessage([PROTOCOL_VERSION, 'leave']), false);
  assert.equal(valid({ t: 'ping', ts: 'ayer' }), false);
  assert.equal(valid({ t: 'ping', ts: Infinity }), false);
  assert.equal(valid({ t: 'resume', token: 'corto' }), false);
  assert.equal(valid({ t: 'relay' }), false);
});

test('la versión del protocolo es 3 (SPEC 04)', () => {
  assert.equal(PROTOCOL_VERSION, 3);
});

test('validateRelay acepta los datos de relay válidos', () => {
  assert.ok(validateRelay({ k: 'snap', rows: ['RRYY..BG', 'BBGGRRY', ''], shift: 1, drops: 2, current: 'R', next: 'B' }));
  assert.ok(validateRelay({ k: 'snap', rows: [], shift: 0, drops: 0, current: null, next: null }));
  assert.ok(validateRelay({ k: 'aim', a: -32.5 }));
  assert.ok(validateRelay({ k: 'garbage', n: 3 }));
  assert.ok(validateRelay({ k: 'lost' }));
  assert.ok(validateRelay({ k: 'quit' }));
});

test('validateRelay rechaza datos malformados sin lanzar', () => {
  const bad = [
    null,
    undefined,
    42,
    'snap',
    [],
    {},
    { k: 'toString' },
    { k: '__proto__' },
    { k: 'snap' },
    { k: 'snap', rows: 'RRYY', shift: 0, drops: 0, current: 'R', next: 'B' },
    { k: 'snap', rows: ['RRYYBBGGX'], shift: 0, drops: 0, current: 'R', next: 'B' },
    { k: 'snap', rows: ['rr'], shift: 0, drops: 0, current: 'R', next: 'B' },
    { k: 'snap', rows: [1], shift: 0, drops: 0, current: 'R', next: 'B' },
    { k: 'snap', rows: Array(21).fill(''), shift: 0, drops: 0, current: 'R', next: 'B' },
    { k: 'snap', rows: [], shift: 2, drops: 0, current: 'R', next: 'B' },
    { k: 'snap', rows: [], shift: 0, drops: -1, current: 'R', next: 'B' },
    { k: 'snap', rows: [], shift: 0, drops: 0, current: 'red', next: 'B' },
    { k: 'aim', a: 'izquierda' },
    { k: 'aim', a: NaN },
    { k: 'aim', a: 400 },
    { k: 'garbage', n: 0 },
    { k: 'garbage', n: 2.5 },
    { k: 'garbage', n: 1000 },
  ];
  for (const data of bad) assert.equal(validateRelay(data), false, JSON.stringify(data));
});

test('validateClientMessage rechaza un cliente v2 (SPEC 04)', () => {
  assert.equal(validateClientMessage({ v: 2, t: 'leave' }), false);
});

test('validateRelay acepta shot y snap con pop/fall (SPEC 04)', () => {
  assert.ok(validateRelay({ k: 'shot', a: -32.5, c: 'R' }));
  assert.ok(validateRelay({ k: 'shot', a: 90, c: 'B' }));
  const snap = { k: 'snap', rows: ['RRYY..BG'], shift: 0, drops: 0, current: 'R', next: 'B' };
  assert.ok(validateRelay(snap), 'snap sin pop/fall sigue siendo válido');
  assert.ok(validateRelay({ ...snap, pop: [[3, 4], [3, 5], [4, 4]], fall: [[5, 2]] }));
  assert.ok(validateRelay({ ...snap, pop: [], fall: [] }));
  assert.ok(validateRelay({ ...snap, pop: Array(96).fill([0, 0]) }));
});

test('validateRelay rechaza shot y pop/fall malformados sin lanzar (SPEC 04)', () => {
  const snap = { k: 'snap', rows: [], shift: 0, drops: 0, current: null, next: null };
  const bad = [
    { k: 'shot' },
    { k: 'shot', a: 10 },
    { k: 'shot', c: 'R' },
    { k: 'shot', a: 91, c: 'R' },
    { k: 'shot', a: NaN, c: 'R' },
    { k: 'shot', a: 0, c: 'X' },
    { k: 'shot', a: 0, c: 'red' },
    { k: 'shot', a: 0, c: null },
    { ...snap, pop: 'nada' },
    { ...snap, pop: [[1]] },
    { ...snap, pop: [[1, 2, 3]] },
    { ...snap, pop: [[-1, 0]] },
    { ...snap, pop: [[0, 8]] },
    { ...snap, pop: [[20, 0]] },
    { ...snap, pop: [[1.5, 0]] },
    { ...snap, pop: [null] },
    { ...snap, fall: [['1', '2']] },
    { ...snap, pop: Array(97).fill([0, 0]) },
  ];
  for (const data of bad) assert.equal(validateRelay(data), false, JSON.stringify(data));
});
