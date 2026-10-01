// Cliente WebSocket del navegador (SPEC 01).
// Mantiene la sesión en sessionStorage para reanudar tras recargar o tras un microcorte.

import { RECONNECT_GRACE_MS, message } from './protocol.js';

const SESSION_KEY = 'bobblejs.session';
const PING_MS = 2000;
const RETRY_DELAYS_MS = [250, 500, 1000, 2000];
const CLOSE_REPLACED = 4000; // el servidor cerró este socket porque otro reanudó la sesión

export function defaultServerUrl() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}

function readSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    return session?.token ? session : null;
  } catch {
    return null;
  }
}

function writeSession(session) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Almacenamiento bloqueado: la reconexión solo funciona sin recargar
  }
}

// Eventos: cualquier tipo del protocolo ('welcome', 'room', 'start', …) más
//   'status'  → 'connecting' | 'online' | 'reconnecting' | 'offline' | 'replaced'
//   'latency' → ms de ida y vuelta
export class NetClient {
  constructor({ url = defaultServerUrl() } = {}) {
    this.url = url;
    this.ws = null;
    this.status = 'offline';
    this.latency = null;
    this.session = readSession();
    this.listeners = new Map();
    this.pingTimer = null;
    this.retryTimer = null;
    this.lostAt = null;
    this.attempt = 0;
  }

  get hasSession() {
    return Boolean(this.session);
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
    return () => this.listeners.get(type).delete(fn);
  }

  emit(type, payload) {
    for (const fn of this.listeners.get(type) ?? []) fn(payload);
  }

  setStatus(status) {
    if (status === this.status) return;
    this.status = status;
    this.emit('status', status);
  }

  // Resuelve al abrir el socket; rechaza si el servidor no responde al primer intento
  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return Promise.resolve();
    clearTimeout(this.retryTimer);
    if (this.status !== 'reconnecting') this.setStatus('connecting');
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        this.setStatus('offline');
        reject(err);
        return;
      }
      this.ws = ws;
      let opened = false;
      ws.addEventListener('open', () => {
        opened = true;
        this.attempt = 0;
        this.lostAt = null;
        this.setStatus('online');
        if (this.session) this.send('resume', { token: this.session.token });
        this.startPing();
        resolve();
      });
      ws.addEventListener('message', (e) => this.onMessage(e.data));
      ws.addEventListener('close', (e) => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.stopPing();
        if (!opened) reject(new Error('Sin conexión con el servidor'));
        if (!opened && this.status === 'connecting') return this.setStatus('offline');
        this.onLost(e.code);
      });
    });
  }

  send(t, fields) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message(t, fields)));
    return true;
  }

  create(nick) {
    return this.send('create', { nick });
  }

  join(code, nick) {
    return this.send('join', { code, nick });
  }

  leave() {
    this.send('leave');
    this.setSession(null);
  }

  // Cierre voluntario: no se reintenta
  close() {
    this.setSession(null);
    clearTimeout(this.retryTimer);
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setStatus('offline');
  }

  // ---------- Internos ----------

  setSession(session) {
    this.session = session;
    writeSession(session);
  }

  onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.t) {
      case 'welcome':
        this.setSession({ token: msg.token, code: msg.code });
        break;
      case 'peer-left':
        this.setSession(null);
        break;
      case 'error':
        if (msg.code === 'bad_token') this.setSession(null);
        break;
      case 'pong':
        this.latency = Math.round(performance.now() - msg.ts);
        this.emit('latency', this.latency);
        break;
    }
    this.emit(msg.t, msg);
  }

  onLost(code) {
    if (code === CLOSE_REPLACED) {
      this.setSession(null);
      this.setStatus('replaced');
      return;
    }
    if (!this.session) {
      this.setStatus('offline');
      return;
    }
    // Reintentar mientras dure la gracia del servidor
    this.lostAt ??= performance.now();
    if (performance.now() - this.lostAt >= RECONNECT_GRACE_MS) {
      this.setSession(null);
      this.setStatus('offline');
      return;
    }
    this.setStatus('reconnecting');
    const delay = RETRY_DELAYS_MS[Math.min(this.attempt++, RETRY_DELAYS_MS.length - 1)];
    this.retryTimer = setTimeout(() => this.connect().catch(() => {}), delay);
  }

  startPing() {
    this.stopPing();
    const ping = () => this.send('ping', { ts: performance.now() });
    ping();
    this.pingTimer = setInterval(ping, PING_MS);
  }

  stopPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
