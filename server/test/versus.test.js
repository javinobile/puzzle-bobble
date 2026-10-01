import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../../js/game.js';
import { validateRelay } from '../../js/net/protocol.js';

// Game sin navegador: sonido mudo y teclado vacío
const sound = new Proxy({}, { get: () => () => {} });
const input = { isHeld: () => false, consume: () => false, endFrame: () => {} };

function versusGame({ seed = 42, you = 0 } = {}) {
  const sent = [];
  const game = new Game({ sound, input });
  game.startVersus({ seed, you, nicks: ['JAV', 'ANA'], send: (data) => sent.push(data) });
  return { game, sent };
}

const snapshot = (game) => game.grid.rows.map((row) => row.join(','));

test('los dos jugadores empiezan con el mismo tablero', () => {
  const a = versusGame({ seed: 1234, you: 0 }).game;
  const b = versusGame({ seed: 1234, you: 1 }).game;
  assert.deepEqual(snapshot(a), snapshot(b));
  assert.ok(a.grid.count() > 0);
  assert.notDeepEqual(snapshot(a), snapshot(versusGame({ seed: 1235 }).game));
});

test('la fila nº k que baja con el techo es igual en ambos aunque disparen distinto', () => {
  const a = versusGame({ seed: 99, you: 0 }).game;
  const b = versusGame({ seed: 99, you: 1 }).game;
  // b consume su generador de tiros más veces que a: no debe afectar al tablero
  for (let i = 0; i < 7; i++) b.randomColor();
  a.lowerCeiling();
  b.lowerCeiling();
  a.lowerCeiling();
  b.lowerCeiling();
  assert.deepEqual(a.grid.rows.slice(0, 2), b.grid.rows.slice(0, 2));
});

test('startVersus arranca con cuenta atrás de 3 s y luego juega', () => {
  const { game } = versusGame();
  assert.equal(game.state, 'countdown');
  for (let i = 0; i < 179; i++) game.update(1 / 60);
  assert.equal(game.state, 'countdown');
  game.update(2 / 60);
  assert.equal(game.state, 'playing');
});

test('hacer caer 5 burbujas envía 3 de basura; 2 o menos no envían nada', () => {
  const { game, sent } = versusGame();
  game.sendGarbage(5);
  game.sendGarbage(2);
  game.sendGarbage(0);
  assert.deepEqual(sent, [{ k: 'garbage', n: 3 }]);
});

test('la basura recibida se aplica en huecos con soporte al asentar el siguiente tiro', () => {
  const { game } = versusGame();
  const before = game.grid.count();
  game.versus.pendingGarbage = 3;
  game.applyGarbage();
  assert.equal(game.grid.count(), before + 3);
  assert.equal(game.versus.pendingGarbage, 0);
  assert.deepEqual(game.grid.findFloating(), []);
});

test('el snapshot enviado es un relay válido', () => {
  const { game, sent } = versusGame();
  game.sendSnapshot();
  assert.equal(sent[0].k, 'snap');
  assert.ok(validateRelay(sent[0]));
});

test('perder en versus envía snap + lost y termina en Derrota sin guardar récord', () => {
  const { game, sent } = versusGame();
  game.setState('playing');
  game.gameOver();
  assert.deepEqual(
    sent.map((d) => d.k),
    ['snap', 'lost'],
  );
  for (let i = 0; i < 200; i++) game.update(1 / 60);
  assert.equal(game.state, 'versus-end');
  assert.equal(game.versus.result, 'lose');
});

test('limpiar el tablero en versus rellena filas y sigue jugando', () => {
  const { game } = versusGame();
  game.setState('playing');
  game.grid.rows = [];
  game.boardCleared();
  assert.equal(game.state, 'playing');
  assert.ok(game.grid.count() > 0);
});

test('abandonar envía quit y da derrota', () => {
  const { game, sent } = versusGame();
  game.setState('playing');
  game.quitVersus();
  assert.deepEqual(sent, [{ k: 'quit' }]);
  assert.equal(game.state, 'versus-end');
  assert.equal(game.versus.result, 'lose');
  assert.equal(game.versus.resultReason, 'quit');
});

test('congelar y descongelar vuelve al estado anterior', () => {
  const { game } = versusGame();
  game.setState('playing');
  game.freeze('peer', 10_000);
  assert.equal(game.state, 'frozen');
  game.update(1);
  assert.equal(game.versus.frozen.left, 9);
  game.freeze('self');
  game.unfreeze('peer');
  assert.equal(game.state, 'frozen');
  game.unfreeze('self');
  assert.equal(game.state, 'playing');
});

// ---------- Datos del rival por relay ----------

test('recibir lost estando vivo da victoria', () => {
  const { game } = versusGame();
  game.setState('playing');
  game.onRelay({ k: 'lost' });
  assert.equal(game.state, 'versus-end');
  assert.equal(game.versus.result, 'win');
  assert.equal(game.versus.resultReason, 'line');
});

test('recibir lost después de haber perdido da empate', () => {
  const { game } = versusGame();
  game.setState('playing');
  game.gameOver();
  game.onRelay({ k: 'lost' });
  for (let i = 0; i < 200; i++) game.update(1 / 60);
  assert.equal(game.state, 'versus-end');
  assert.equal(game.versus.result, 'draw');
});

test('recibir quit da victoria por abandono', () => {
  const { game } = versusGame();
  game.setState('playing');
  game.onRelay({ k: 'quit' });
  assert.equal(game.versus.result, 'win');
  assert.equal(game.versus.resultReason, 'quit');
});

test('la basura recibida se acumula con tope', () => {
  const { game } = versusGame();
  game.onRelay({ k: 'garbage', n: 3 });
  game.onRelay({ k: 'garbage', n: 2 });
  assert.equal(game.versus.pendingGarbage, 5);
  game.onRelay({ k: 'garbage', n: 20 });
  assert.equal(game.versus.pendingGarbage, 20);
});

test('snap y aim actualizan el tablero del rival', () => {
  const a = versusGame({ seed: 5, you: 0 });
  const b = versusGame({ seed: 5, you: 1 });
  a.game.lowerCeiling();
  a.game.sendSnapshot();
  b.game.onRelay(a.sent.at(-1));
  b.game.onRelay({ k: 'aim', a: -30 });
  const rival = b.game.versus.rival;
  assert.deepEqual(snapshot({ grid: rival.grid }), snapshot(a.game));
  assert.equal(rival.grid.shift, a.game.grid.shift);
  assert.equal(rival.angle, -30);
  assert.equal(rival.current, a.game.current);
});

test('un relay malformado no lanza ni cambia el estado', () => {
  const { game } = versusGame();
  game.setState('playing');
  for (const data of [null, 'x', { k: 'snap', rows: 5 }, { k: 'garbage', n: -1 }, { k: 'aim', a: 'x' }, { k: 'nope' }]) {
    assert.doesNotThrow(() => game.onRelay(data));
  }
  assert.equal(game.state, 'playing');
  assert.equal(game.versus.pendingGarbage, 0);
});

test('el ángulo se envía como mucho cada 100 ms y solo si cambia', () => {
  const held = new Set(['left']);
  const sent = [];
  const game = new Game({ sound, input: { ...input, isHeld: (a) => held.has(a) } });
  game.startVersus({ seed: 1, you: 0, nicks: ['A', 'B'], send: (d) => sent.push(d) });
  game.setState('playing');
  for (let i = 0; i < 60; i++) game.update(1 / 60); // 1 s apuntando
  const aims = sent.filter((d) => d.k === 'aim').length;
  assert.ok(aims >= 8 && aims <= 10, `${aims} mensajes aim en 1 s`);
  held.clear();
  sent.length = 0;
  for (let i = 0; i < 60; i++) game.update(1 / 60);
  assert.equal(sent.filter((d) => d.k === 'aim').length, 0);
});

test('perder en versus no guarda récord', () => {
  const writes = [];
  globalThis.localStorage = { getItem: () => null, setItem: (k, v) => writes.push([k, v]) };
  try {
    const { game } = versusGame();
    game.setState('playing');
    game.addScore(999999);
    game.gameOver();
    for (let i = 0; i < 200; i++) game.update(1 / 60);
    assert.equal(game.state, 'versus-end');
    assert.deepEqual(writes, []);
  } finally {
    delete globalThis.localStorage;
  }
});
