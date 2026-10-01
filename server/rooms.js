// Lógica de salas en memoria, sin sockets (SPEC 01).
// Cada operación devuelve { token?, error?, out } donde `out` es la lista de
// mensajes a emitir: [{ to: <token del jugador>, msg }]. server/index.js solo
// traduce tokens a sockets.

import { randomInt, randomUUID } from 'node:crypto';
import {
  EMPTY_ROOM_TTL_MS,
  MAX_ROOMS,
  RECONNECT_GRACE_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  message,
} from '../js/net/protocol.js';

const PLAYERS_PER_ROOM = 2;
const UINT32 = 2 ** 32;

const defaultRandom = {
  int: (max) => randomInt(max),
  token: () => randomUUID(),
};

export class Rooms {
  constructor({ random = defaultRandom, maxRooms = MAX_ROOMS } = {}) {
    this.random = random;
    this.maxRooms = maxRooms;
    this.rooms = new Map(); // code → Room
    this.byToken = new Map(); // token → code
  }

  get size() {
    return this.rooms.size;
  }

  // ---------- Consultas ----------

  find(token) {
    const room = this.rooms.get(this.byToken.get(token));
    if (!room) return null;
    const you = room.players.findIndex((p) => p.token === token);
    return { room, you, player: room.players[you] };
  }

  // Tokens de los demás jugadores de la sala
  peersOf(token) {
    const found = this.find(token);
    if (!found) return [];
    return found.room.players.filter((p) => p.token !== token).map((p) => p.token);
  }

  // ---------- Operaciones ----------

  createRoom(nick, now) {
    if (this.rooms.size >= this.maxRooms) return { error: 'server_full', out: [] };
    const code = this.newCode();
    const room = { code, seed: null, createdAt: now, emptySince: null, players: [] };
    this.rooms.set(code, room);
    const token = this.addPlayer(room, nick);
    return { token, out: [this.welcome(room, token), ...this.roomUpdate(room)] };
  }

  joinRoom(code, nick, now) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'room_not_found', out: [] };
    if (room.players.length >= PLAYERS_PER_ROOM) return { error: 'room_full', out: [] };
    const token = this.addPlayer(room, nick);
    room.emptySince = null;
    const out = [this.welcome(room, token), ...this.roomUpdate(room)];
    if (room.players.length === PLAYERS_PER_ROOM) {
      room.seed = this.random.int(UINT32);
      out.push(...this.broadcast(room, message('start', { seed: room.seed })));
    }
    return { token, out };
  }

  // Salir voluntariamente cierra la sala: el rival vuelve al lobby
  leave(token) {
    const found = this.find(token);
    if (!found) return { out: [] };
    const out = this.peersOf(token).map((to) => ({ to, msg: message('peer-left', { reason: 'left' }) }));
    this.closeRoom(found.room);
    return { out };
  }

  // El socket se cerró sin `leave`: empieza la gracia de reconexión.
  // Si ya no queda nadie conectado en una sala de dos, la partida termina.
  disconnect(token, now) {
    const found = this.find(token);
    if (!found?.player.connected) return { out: [] };
    const { room, player } = found;
    player.connected = false;
    player.lostAt = now;

    const connected = room.players.filter((p) => p.connected);
    if (connected.length === 0) {
      if (room.players.length === PLAYERS_PER_ROOM) {
        this.closeRoom(room);
        return { out: [] };
      }
      room.emptySince = now;
      return { out: [] };
    }
    const lost = message('peer-lost', { graceMs: RECONNECT_GRACE_MS });
    return { out: [...connected.map((p) => ({ to: p.token, msg: lost })), ...this.roomUpdate(room, connected)] };
  }

  // Reconexión con el token recibido en `welcome`
  resume(token, now) {
    const found = this.find(token);
    if (!found) return { error: 'bad_token', out: [] };
    const { room, player } = found;
    const wasLost = !player.connected;
    player.connected = true;
    player.lostAt = null;
    room.emptySince = null;

    const out = [this.welcome(room, token), ...this.roomUpdate(room)];
    if (room.seed !== null) out.push({ to: token, msg: message('start', { seed: room.seed }) });
    if (wasLost) {
      for (const to of this.peersOf(token)) out.push({ to, msg: message('peer-back') });
    }
    return { token, out };
  }

  // Llamado periódicamente: caduca gracias vencidas y salas vacías
  tick(now) {
    const out = [];
    for (const room of [...this.rooms.values()]) {
      const expired = room.players.some((p) => !p.connected && now - p.lostAt >= RECONNECT_GRACE_MS);
      const stale = room.emptySince !== null && now - room.emptySince >= EMPTY_ROOM_TTL_MS;
      if (!expired && !stale) continue;
      const left = message('peer-left', { reason: 'timeout' });
      for (const p of room.players) if (p.connected) out.push({ to: p.token, msg: left });
      this.closeRoom(room);
    }
    return { out };
  }

  // ---------- Internos ----------

  newCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[this.random.int(ROOM_CODE_ALPHABET.length)];
    } while (this.rooms.has(code));
    return code;
  }

  addPlayer(room, nick) {
    const token = this.random.token();
    room.players.push({ nick, token, connected: true, lostAt: null });
    this.byToken.set(token, room.code);
    return token;
  }

  closeRoom(room) {
    for (const p of room.players) this.byToken.delete(p.token);
    this.rooms.delete(room.code);
  }

  welcome(room, token) {
    const you = room.players.findIndex((p) => p.token === token);
    return { to: token, msg: message('welcome', { token, code: room.code, you }) };
  }

  roomUpdate(room, recipients = room.players) {
    const players = room.players.map(({ nick, connected }) => ({ nick, connected }));
    const msg = message('room', { code: room.code, players });
    return recipients.map((p) => ({ to: p.token, msg }));
  }

  broadcast(room, msg) {
    return room.players.map((p) => ({ to: p.token, msg }));
  }
}
