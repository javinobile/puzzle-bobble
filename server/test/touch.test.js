import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LAUNCHER_X, LAUNCHER_Y, MAX_ANGLE, MOBILE_BOARD_DX, MOBILE_BOARD_DY } from '../../js/config.js';
import { aimAngleToward, isCancelZone, toLogical } from '../../js/touch.js';

test('toLogical deshace el escalado CSS y la traslación móvil', () => {
  // Canvas de 180×320 mostrado a 360×640 a partir de (10, 20)
  const rect = { left: 10, top: 20, width: 360, height: 640 };
  const screenX = 10 + (LAUNCHER_X + MOBILE_BOARD_DX) * 2;
  const screenY = 20 + (LAUNCHER_Y + MOBILE_BOARD_DY) * 2;
  assert.deepEqual(toLogical(screenX, screenY, rect), { x: LAUNCHER_X, y: LAUNCHER_Y });
  assert.deepEqual(toLogical(10, 20, rect), { x: -MOBILE_BOARD_DX, y: -MOBILE_BOARD_DY });
});

test('un toque justo encima del lanzador apunta a 0°', () => {
  assert.equal(aimAngleToward(LAUNCHER_X, LAUNCHER_Y - 100), 0);
});

test('un toque a la izquierda da ángulo negativo y a la derecha positivo', () => {
  assert.ok(aimAngleToward(LAUNCHER_X - 50, LAUNCHER_Y - 50) < 0);
  assert.ok(Math.abs(aimAngleToward(LAUNCHER_X - 50, LAUNCHER_Y - 50) + 45) < 1e-9);
  assert.ok(aimAngleToward(LAUNCHER_X + 30, LAUNCHER_Y - 100) > 0);
});

test('el ángulo se recorta a ±85°', () => {
  assert.equal(aimAngleToward(LAUNCHER_X - 100, LAUNCHER_Y), -MAX_ANGLE);
  assert.equal(aimAngleToward(LAUNCHER_X + 100, LAUNCHER_Y + 50), MAX_ANGLE);
});

test('por debajo del lanzador es zona de cancelación', () => {
  assert.equal(isCancelZone(LAUNCHER_Y + 1), true);
  assert.equal(isCancelZone(LAUNCHER_Y), false);
  assert.equal(isCancelZone(LAUNCHER_Y - 50), false);
});

test('Game usa aimAngle del input táctil como ángulo del lanzador', async () => {
  const { Game } = await import('../../js/game.js');
  const sound = new Proxy({}, { get: () => () => {} });
  const input = { aimAngle: null, isHeld: () => false, consume: () => false, endFrame: () => {} };
  const game = new Game({ sound, input });
  game.startVersus({ seed: 3, you: 0, nicks: ['A', 'B'], send: () => {} });
  game.setState('playing');
  input.aimAngle = -40;
  game.update(1 / 60);
  assert.equal(game.shooter.angle, -40);
  input.aimAngle = null;
  game.update(1 / 60);
  assert.equal(game.shooter.angle, -40); // al soltar el dedo el ángulo se queda
});
