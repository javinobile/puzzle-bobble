import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_ROOM_TTL_MS, PROTOCOL_VERSION, RECONNECT_GRACE_MS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '../../js/net/protocol.js';
import { Rooms } from '../rooms.js';

// Aleatoriedad determinista: `ints` se consume en orden y luego vuelve a 0
function fakeRandom(ints = []) {
  let n = 0;
  return {
    int: (max) => (ints.length ? ints.shift() : 0) % max,
    token: () => `token-${String(++n).padStart(4, '0')}`,
  };
}

const typesFor = (out, token) => out.filter((o) => o.to === token).map((o) => o.msg.t);

test('crear sala da código válido, token y mensajes welcome + room', () => {
  const rooms = new Rooms();
  const { token, out, error } = rooms.createRoom('JAV', 0);
  assert.equal(error, undefined);
  const welcome = out.find((o) => o.msg.t === 'welcome').msg;
  assert.equal(welcome.token, token);
  assert.equal(welcome.you, 0);
  assert.equal(welcome.code.length, ROOM_CODE_LENGTH);
  assert.ok([...welcome.code].every((ch) => ROOM_CODE_ALPHABET.includes(ch)));
  assert.deepEqual(typesFor(out, token), ['welcome', 'room']);
  assert.equal(rooms.size, 1);
});

test('unirse llena la sala y envía la misma semilla a ambos', () => {
  const rooms = new Rooms();
  const host = rooms.createRoom('JAV', 0);
  const code = host.out[0].msg.code;
  const guest = rooms.joinRoom(code, 'ANA', 10);

  assert.equal(guest.error, undefined);
  assert.equal(guest.out.find((o) => o.msg.t === 'welcome').msg.you, 1);
  assert.deepEqual(typesFor(guest.out, host.token), ['room', 'start']);
  assert.deepEqual(typesFor(guest.out, guest.token), ['welcome', 'room', 'start']);

  const room = guest.out.find((o) => o.msg.t === 'room').msg;
  assert.deepEqual(room.players, [
    { nick: 'JAV', connected: true },
    { nick: 'ANA', connected: true },
  ]);

  const seeds = guest.out.filter((o) => o.msg.t === 'start').map((o) => o.msg.seed);
  assert.equal(seeds.length, 2);
  assert.equal(seeds[0], seeds[1]);
  assert.ok(Number.isInteger(seeds[0]) && seeds[0] >= 0 && seeds[0] < 2 ** 32);
});

test('un tercer jugador recibe room_full', () => {
  const rooms = new Rooms();
  const code = rooms.createRoom('JAV', 0).out[0].msg.code;
  rooms.joinRoom(code, 'ANA', 0);
  const third = rooms.joinRoom(code, 'LUZ', 0);
  assert.equal(third.error, 'room_full');
  assert.equal(third.token, undefined);
  assert.deepEqual(third.out, []);
});

test('un código inexistente recibe room_not_found', () => {
  const rooms = new Rooms();
  assert.equal(rooms.joinRoom('ZZZZ', 'ANA', 0).error, 'room_not_found');
});

test('con el máximo de salas se responde server_full', () => {
  const rooms = new Rooms({ maxRooms: 2 });
  rooms.createRoom('A', 0);
  rooms.createRoom('B', 0);
  assert.equal(rooms.createRoom('C', 0).error, 'server_full');
  assert.equal(rooms.size, 2);
});

test('los códigos no colisionan con salas existentes', () => {
  // Las 4 primeras tiradas dan "AAAA" dos veces seguidas; la segunda sala debe esquivarlo
  const rooms = new Rooms({ random: fakeRandom([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1]) });
  const a = rooms.createRoom('A', 0).out[0].msg.code;
  const b = rooms.createRoom('B', 0).out[0].msg.code;
  assert.equal(a, 'AAAA');
  assert.equal(b, 'BBBB');
});

test('salir cierra la sala y avisa al rival con peer-left', () => {
  const rooms = new Rooms();
  const host = rooms.createRoom('JAV', 0);
  const guest = rooms.joinRoom(host.out[0].msg.code, 'ANA', 0);

  const { out } = rooms.leave(guest.token);
  assert.deepEqual(out, [{ to: host.token, msg: { v: PROTOCOL_VERSION, t: 'peer-left', reason: 'left' } }]);
  assert.equal(rooms.size, 0);
  assert.equal(rooms.find(host.token), null);
  assert.deepEqual(rooms.leave(host.token).out, []);
});

test('el anfitrión puede salir de una sala sin rival', () => {
  const rooms = new Rooms();
  const host = rooms.createRoom('JAV', 0);
  assert.deepEqual(rooms.leave(host.token).out, []);
  assert.equal(rooms.size, 0);
});

// ---------- Gracia, reconexión y expiración (paso 4) ----------

function fullRoom() {
  const rooms = new Rooms();
  const host = rooms.createRoom('JAV', 0);
  const guest = rooms.joinRoom(host.out[0].msg.code, 'ANA', 0);
  return { rooms, host: host.token, guest: guest.token, code: host.out[0].msg.code };
}

test('desconectarse avisa al rival con peer-lost y room actualizado', () => {
  const { rooms, host, guest } = fullRoom();
  const { out } = rooms.disconnect(guest, 1000);
  assert.deepEqual(typesFor(out, host), ['peer-lost', 'room']);
  assert.deepEqual(typesFor(out, guest), []);
  assert.equal(out[0].msg.graceMs, RECONNECT_GRACE_MS);
  assert.deepEqual(out[1].msg.players[1], { nick: 'ANA', connected: false });
});

test('reanudar dentro de la gracia devuelve welcome, room y start, y avisa peer-back', () => {
  const { rooms, host, guest } = fullRoom();
  rooms.disconnect(guest, 1000);
  rooms.tick(1000 + RECONNECT_GRACE_MS - 1);
  const resumed = rooms.resume(guest, 1000 + RECONNECT_GRACE_MS - 1);
  assert.equal(resumed.error, undefined);
  assert.deepEqual(typesFor(resumed.out, guest), ['welcome', 'room', 'start']);
  assert.deepEqual(typesFor(resumed.out, host), ['room', 'peer-back']);
  assert.equal(resumed.out.find((o) => o.msg.t === 'welcome').msg.you, 1);
  // Ya no caduca aunque pase el tiempo
  assert.deepEqual(rooms.tick(1000 + RECONNECT_GRACE_MS * 5).out, []);
  assert.equal(rooms.size, 1);
});

test('agotar la gracia envía peer-left timeout y cierra la sala', () => {
  const { rooms, host, guest } = fullRoom();
  rooms.disconnect(guest, 1000);
  assert.deepEqual(rooms.tick(1000 + RECONNECT_GRACE_MS - 1).out, []);
  const { out } = rooms.tick(1000 + RECONNECT_GRACE_MS);
  assert.deepEqual(out, [{ to: host, msg: { v: PROTOCOL_VERSION, t: 'peer-left', reason: 'timeout' } }]);
  assert.equal(rooms.size, 0);
  assert.equal(rooms.resume(guest, 1000 + RECONNECT_GRACE_MS).error, 'bad_token');
});

test('si se desconectan los dos, la partida termina al momento', () => {
  const { rooms, host, guest } = fullRoom();
  rooms.disconnect(guest, 1000);
  assert.deepEqual(rooms.disconnect(host, 2000).out, []);
  assert.equal(rooms.size, 0);
  assert.equal(rooms.resume(host, 2001).error, 'bad_token');
});

test('el anfitrión solo puede reanudar tras recargar dentro de la gracia', () => {
  const rooms = new Rooms();
  const host = rooms.createRoom('JAV', 0);
  rooms.disconnect(host.token, 1000);
  const resumed = rooms.resume(host.token, 5000);
  assert.deepEqual(typesFor(resumed.out, host.token), ['welcome', 'room']);
  assert.equal(rooms.find(host.token).room.emptySince, null);
});

test('una sala vacía desaparece como mucho a los 60 s', () => {
  const rooms = new Rooms();
  const host = rooms.createRoom('JAV', 0);
  rooms.disconnect(host.token, 1000);
  assert.equal(rooms.find(host.token).room.emptySince, 1000);
  rooms.tick(1000 + EMPTY_ROOM_TTL_MS);
  assert.equal(rooms.size, 0);
});

test('resume con token desconocido responde bad_token', () => {
  const rooms = new Rooms();
  assert.equal(rooms.resume('token-inexistente', 0).error, 'bad_token');
});

test('disconnect de un token desconocido o ya desconectado no emite nada', () => {
  const { rooms, guest } = fullRoom();
  assert.deepEqual(rooms.disconnect('nadie', 0).out, []);
  rooms.disconnect(guest, 0);
  assert.deepEqual(rooms.disconnect(guest, 1).out, []);
});

// ---------- Revancha (SPEC 02) ----------

test('revancha con un solo voto no emite start', () => {
  const { rooms, host } = fullRoom();
  assert.deepEqual(rooms.rematch(host).out, []);
  assert.deepEqual(rooms.rematch(host).out, []);
});

test('revancha con los dos votos emite start con semilla nueva y reinicia los votos', () => {
  const { rooms, host, guest } = fullRoom();
  const before = rooms.find(host).room.seed;
  rooms.rematch(host);
  const { out } = rooms.rematch(guest);
  assert.deepEqual(typesFor(out, host), ['start']);
  assert.deepEqual(typesFor(out, guest), ['start']);
  assert.equal(out[0].msg.seed, out[1].msg.seed);
  assert.notEqual(out[0].msg.seed, before);
  assert.equal(rooms.find(host).room.seed, out[0].msg.seed);
  assert.deepEqual(rooms.find(host).room.rematch, [false, false]);
  // Una nueva revancha vuelve a necesitar los dos votos
  assert.deepEqual(rooms.rematch(guest).out, []);
});

test('la semilla de la revancha nunca repite la anterior', () => {
  // Código AAAA (4 ceros), semilla 5, y la revancha tira 5 otra vez antes de 9
  const rooms = new Rooms({ random: fakeRandom([0, 0, 0, 0, 5, 5, 9]) });
  const host = rooms.createRoom('JAV', 0);
  const guest = rooms.joinRoom(host.out[0].msg.code, 'ANA', 0);
  assert.equal(rooms.find(host.token).room.seed, 5);
  rooms.rematch(host.token);
  assert.equal(rooms.rematch(guest.token).out[0].msg.seed, 9);
});

test('revancha sin partida empezada o con token desconocido no hace nada', () => {
  const rooms = new Rooms();
  const host = rooms.createRoom('JAV', 0);
  assert.deepEqual(rooms.rematch(host.token).out, []);
  assert.deepEqual(rooms.rematch('nadie').out, []);
});

test('reanudar tras una revancha devuelve la semilla nueva', () => {
  const { rooms, host, guest } = fullRoom();
  rooms.rematch(host);
  const seed = rooms.rematch(guest).out[0].msg.seed;
  rooms.disconnect(guest, 1000);
  const resumed = rooms.resume(guest, 2000);
  assert.equal(resumed.out.find((o) => o.msg.t === 'start').msg.seed, seed);
});
