// Lobby del versus online (SPEC 01): apodo, crear/unirse y sala de espera.
// SPEC 02: al llegar `start` arranca la partida versus en el Game (vista 'match')
// y al terminar muestra Victoria/Derrota/Empate con revancha.

import { NetClient } from './net/client.js';
import { NICK_RE, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './net/protocol.js';

const NICK_KEY = 'bobblejs.nickname';
const VIEWS = ['online', 'room', 'versus-end'];
const MATCH = 'match'; // partida en curso: ningún overlay del lobby visible

const RESULT_TITLE = { win: '¡Victoria!', lose: 'Derrota', draw: 'Empate' };
const RESULT_CLASS = { win: 'won', lose: 'lost', draw: 'draw' };
const RESULT_REASON = {
  'win:line': 'Tu rival cruzó la línea',
  'win:quit': 'Ganaste: el rival abandonó',
  'win:timeout': 'Ganaste: tu rival no volvió a conectarse',
  'win:left': 'Ganaste: tu rival se fue de la sala',
  'lose:line': 'Cruzaste la línea',
  'lose:quit': 'Abandonaste la partida',
  'draw:line': 'Los dos cruzaron la línea a la vez',
};

const ERROR_TEXT = {
  bad_version: 'Versión distinta a la del servidor: recarga la página',
  bad_message: 'El servidor no entendió el mensaje',
  too_big: 'Mensaje demasiado grande',
  room_not_found: 'Sala no encontrada',
  room_full: 'La sala está llena',
  server_full: 'Servidor lleno, prueba en un rato',
  bad_token: 'La sala ya no existe',
};
const OFFLINE_TEXT = 'Sin conexión con el servidor';

const $ = (sel, root = document) => root.querySelector(sel);

function loadNick() {
  try {
    const nick = localStorage.getItem(NICK_KEY) ?? '';
    return NICK_RE.test(nick) ? nick : '';
  } catch {
    return '';
  }
}

function saveNick(nick) {
  try {
    localStorage.setItem(NICK_KEY, nick);
  } catch {
    // Almacenamiento bloqueado: el apodo solo dura esta visita
  }
}

const cleanNick = (value) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
// Se aceptan todas las letras al teclear; las que no usa el alfabeto (I, O) se tratan al unirse
const cleanCode = (value) => value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, ROOM_CODE_LENGTH);
const isPossibleCode = (code) => [...code].every((ch) => ROOM_CODE_ALPHABET.includes(ch));

export class Lobby {
  constructor({ menu, sound, game, onExit }) {
    this.menu = menu;
    this.sound = sound;
    this.game = game;
    this.onExit = onExit;
    this.net = new NetClient();
    this.view = null; // null = lobby cerrado
    this.you = null;
    this.code = null;
    this.players = [];
    this.seed = null;
    this.peerDeadline = null;
    this.countdownTimer = null;
    this.roomClosed = false; // el rival se fue: ya no hay revancha posible

    this.el = Object.fromEntries(VIEWS.map((v) => [v, $(`#${v}`)]));
    this.nickInput = $('#nick');
    this.codeInput = $('#join-code');
    this.nickInput.value = loadNick();

    this.bindDom();
    this.bindNet();

    // Recarga con sesión activa: volver directamente a la sala.
    // Si había una partida en curso se perdió con la recarga y cuenta como abandono.
    this.reloaded = this.net.hasSession;
    if (this.net.hasSession) this.open();
  }

  get active() {
    return this.view !== null;
  }

  get inMatch() {
    return this.game.mode === 'versus' && this.game.versus !== null;
  }

  // ---------- Vistas ----------

  show(view) {
    this.view = view;
    this.menu.hidden = view !== null;
    for (const [name, el] of Object.entries(this.el)) el.hidden = name !== view;
    if (view) this.message('');
  }

  message(text) {
    if (this.el[this.view]) $('.net-msg', this.el[this.view]).textContent = text;
  }

  renderPlayers() {
    for (const view of ['room', 'versus-end']) {
      const list = $('.players', this.el[view]);
      list.replaceChildren(
        ...this.players.map((p, i) => {
          const li = document.createElement('li');
          li.textContent = p.nick;
          li.classList.toggle('me', i === this.you);
          li.classList.toggle('lost', !p.connected);
          return li;
        }),
      );
    }
  }

  // ---------- Acciones ----------

  async open() {
    this.show('online');
    if (!this.net.hasSession) this.nickInput.focus();
    if (this.net.status === 'online') return;
    try {
      await this.net.connect();
    } catch {
      this.message(OFFLINE_TEXT);
    }
  }

  exit() {
    if (!this.active) return;
    this.net.close();
    this.leaveMatch();
    this.resetRoom();
    this.show(null);
    this.sound.select();
    this.onExit?.();
  }

  // Desde una sala se vuelve a la pantalla de crear/unirse; desde ahí, al menú
  back() {
    if (this.view === 'online') return this.exit();
    this.net.leave();
    this.leaveMatch();
    this.resetRoom();
    this.show('online');
    this.sound.select();
  }

  resetRoom() {
    this.stopCountdown();
    this.you = null;
    this.code = null;
    this.players = [];
    this.seed = null;
    this.roomClosed = false;
  }

  // Vuelve a crear/unirse mostrando por qué
  dropToOnline(text) {
    this.leaveMatch();
    this.resetRoom();
    this.show('online');
    this.message(text);
  }

  // ---------- Partida versus (SPEC 02) ----------

  startMatch(seed) {
    const game = this.game;
    game.startVersus({
      seed,
      you: this.you,
      nicks: this.players.map((p) => p.nick),
      send: (data) => this.net.send('relay', { data }),
    });
    this.roomClosed = false;
    this.show(MATCH);
    // Recargar la pestaña en plena partida pierde el estado: cuenta como abandono
    if (this.reloaded) game.quitVersus();
    this.reloaded = false;
  }

  // El Game deja el modo versus y vuelve al menú (antes de mostrar una vista del lobby)
  leaveMatch() {
    if (!this.inMatch) return;
    this.game.versus = null;
    this.game.mode = null;
    this.game.setState('menu');
  }

  // Llamado por main.js en cada cambio de estado del Game
  onGameState(state, info) {
    if (!this.inMatch) return;
    if (state === 'versus-end') this.showResult(info.result, info.reason);
  }

  showResult(result, reason) {
    const view = this.el['versus-end'];
    const title = $('.vs-title', view);
    title.textContent = RESULT_TITLE[result];
    title.className = `vs-title ${RESULT_CLASS[result]}`;
    $('.vs-reason', view).textContent = RESULT_REASON[`${result}:${reason}`] ?? '';
    const rematch = $('#rematch');
    rematch.disabled = this.roomClosed;
    rematch.hidden = this.roomClosed;
    if (this.view !== 'versus-end') this.show('versus-end');
    this.renderPlayers();
    if (this.roomClosed) this.message('Tu rival ha salido de la sala');
    else rematch.focus();
  }

  rematch() {
    if (this.roomClosed || $('#rematch').disabled) return;
    this.sound.select();
    this.net.send('rematch');
    $('#rematch').disabled = true;
    this.message('Esperando al rival…');
  }

  // ---------- Rival desconectado ----------

  startCountdown(graceMs) {
    this.stopCountdown();
    this.peerDeadline = performance.now() + graceMs;
    const update = () => {
      const secs = Math.max(0, Math.ceil((this.peerDeadline - performance.now()) / 1000));
      this.message(`Rival desconectado… esperando ${secs} s`);
    };
    update();
    this.countdownTimer = setInterval(update, 250);
  }

  stopCountdown() {
    clearInterval(this.countdownTimer);
    this.countdownTimer = null;
    this.peerDeadline = null;
  }

  readNick() {
    const nick = cleanNick(this.nickInput.value);
    this.nickInput.value = nick;
    if (!NICK_RE.test(nick)) {
      this.message('Escribe un apodo de 1 a 3 letras o números');
      this.nickInput.focus();
      return null;
    }
    saveNick(nick);
    return nick;
  }

  async ensureOnline() {
    if (this.net.status === 'online') return true;
    try {
      await this.net.connect();
      return true;
    } catch {
      this.message(OFFLINE_TEXT);
      return false;
    }
  }

  async create() {
    const nick = this.readNick();
    if (!nick || !(await this.ensureOnline())) return;
    this.sound.select();
    this.net.create(nick);
  }

  async join() {
    const nick = this.readNick();
    if (!nick) return;
    const code = cleanCode(this.codeInput.value);
    if (code.length !== ROOM_CODE_LENGTH) {
      this.message(`El código tiene ${ROOM_CODE_LENGTH} letras`);
      this.codeInput.focus();
      return;
    }
    // Un código con I u O no puede existir: no hace falta preguntar al servidor
    if (!isPossibleCode(code)) {
      this.message(ERROR_TEXT.room_not_found);
      return;
    }
    if (!(await this.ensureOnline())) return;
    this.sound.select();
    this.net.join(code, nick);
  }

  // ---------- Eventos ----------

  bindDom() {
    $('#create-room').addEventListener('click', () => this.create());
    $('#rematch').addEventListener('click', () => this.rematch());
    $('#join-room').addEventListener('click', () => this.join());
    for (const btn of document.querySelectorAll('.lobby-exit')) btn.addEventListener('click', () => this.back());

    this.nickInput.addEventListener('input', () => (this.nickInput.value = cleanNick(this.nickInput.value)));
    this.codeInput.addEventListener('input', () => (this.codeInput.value = cleanCode(this.codeInput.value)));
    this.nickInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.create();
    });
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.join();
    });
    window.addEventListener('keydown', (e) => {
      // En partida el teclado es del Game (P/Esc abre "¿Abandonar?")
      if (!this.active || this.view === MATCH) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.back();
      }
      // Input cancela Enter por defecto: los botones del lobby enfocados con Tab lo necesitan
      if (e.key === 'Enter' && e.target instanceof HTMLButtonElement && e.target.closest('.lobby')) e.target.click();
    });
  }

  bindNet() {
    const net = this.net;
    net.on('welcome', (m) => {
      this.you = m.you;
      this.code = m.code;
      $('.room-code', this.el.room).textContent = m.code;
      if (!this.active) this.show('online');
    });
    net.on('room', (m) => {
      // Sala sin rival tras recargar: no había partida que abandonar
      if (m.players.length < 2) this.reloaded = false;
      this.players = m.players;
      this.renderPlayers();
      if (this.seed === null && this.view !== 'room') this.show('room');
    });
    net.on('start', (m) => {
      // Tras un microcorte el servidor repite `start` con la misma semilla: la partida sigue
      if (this.inMatch && this.game.versus.seed === m.seed) return;
      this.seed = m.seed;
      this.startMatch(m.seed);
    });
    net.on('relay', (m) => {
      if (this.inMatch) this.game.onRelay(m.data);
    });
    net.on('peer-lost', (m) => {
      if (this.inMatch) return this.game.freeze('peer', m.graceMs);
      this.startCountdown(m.graceMs);
    });
    net.on('peer-back', () => {
      if (this.inMatch) return this.game.unfreeze('peer');
      this.stopCountdown();
      this.message('Rival reconectado');
    });
    net.on('peer-left', (m) => {
      if (this.inMatch) {
        // La sala ya no existe: se gana si la partida seguía, y no hay revancha
        this.roomClosed = true;
        if (this.game.versus.result) this.showResult(this.game.versus.result, this.game.versus.resultReason);
        else this.game.peerGone(m.reason);
        return;
      }
      this.dropToOnline(m.reason === 'timeout' ? 'Tu rival no volvió a conectarse' : 'Tu rival ha salido de la sala');
    });
    net.on('error', (m) => {
      const text = ERROR_TEXT[m.code] ?? `Error del servidor (${m.code})`;
      if (m.code === 'bad_token') this.dropToOnline(text);
      else this.message(text);
    });
    net.on('status', (status) => {
      if (!this.active) return;
      switch (status) {
        case 'reconnecting':
          if (this.inMatch) this.game.freeze('self');
          this.message('Conexión perdida, reconectando…');
          break;
        case 'online':
          if (this.inMatch) this.game.unfreeze('self');
          if (!this.peerDeadline) this.message('');
          break;
        case 'offline':
          if (this.view === 'online') this.message(OFFLINE_TEXT);
          else this.dropToOnline('Se perdió la conexión con el servidor');
          break;
        case 'replaced':
          this.dropToOnline('La sala se abrió en otra pestaña');
          break;
      }
    });
  }
}
