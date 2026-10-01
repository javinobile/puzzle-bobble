import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROTOCOL_VERSION, ROOM_CODE_ALPHABET, message, validateClientMessage } from '../../js/net/protocol.js';

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
  assert.equal(validateClientMessage({ v: 2, t: 'leave' }), false);
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
