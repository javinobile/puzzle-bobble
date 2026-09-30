import { COLS, COLOR_CODES, FIELD_X, RADIUS, BUBBLE, ROW_H } from './config.js';

// Rejilla hexagonal. Las filas "cortas" (7 huecos) están desplazadas medio diámetro a la derecha.
export class Grid {
  constructor() {
    this.rows = [];
    this.shift = 0; // cambia al insertar filas por arriba para conservar la paridad
  }

  static fromStrings(lines) {
    const grid = new Grid();
    lines.forEach((line, r) => {
      for (let c = 0; c < grid.cols(r); c++) {
        const color = COLOR_CODES[line[c]];
        if (color) grid.set(r, c, color);
      }
    });
    return grid;
  }

  isShort(r) {
    return (r + this.shift) % 2 === 1;
  }

  cols(r) {
    return this.isShort(r) ? COLS - 1 : COLS;
  }

  inBounds(r, c) {
    return r >= 0 && c >= 0 && c < this.cols(r);
  }

  get(r, c) {
    return this.rows[r]?.[c] ?? null;
  }

  set(r, c, color) {
    while (this.rows.length <= r) this.rows.push(new Array(this.cols(this.rows.length)).fill(null));
    this.rows[r][c] = color;
  }

  remove(r, c) {
    if (this.rows[r]) this.rows[r][c] = null;
  }

  // Inserta una fila completa por arriba (modo Infinito)
  insertTop(colors) {
    this.shift ^= 1;
    const row = new Array(this.cols(0)).fill(null).map((_, c) => colors[c % colors.length]);
    this.rows.unshift(row);
  }

  *cells() {
    for (let r = 0; r < this.rows.length; r++) {
      for (let c = 0; c < this.rows[r].length; c++) {
        const color = this.rows[r][c];
        if (color) yield { r, c, color };
      }
    }
  }

  count() {
    let n = 0;
    for (const _ of this.cells()) n++;
    return n;
  }

  colorsPresent() {
    const set = new Set();
    for (const { color } of this.cells()) set.add(color);
    return [...set];
  }

  lowestRow() {
    let low = -1;
    for (const { r } of this.cells()) low = Math.max(low, r);
    return low;
  }

  center(r, c, top) {
    return {
      x: FIELD_X + RADIUS + c * BUBBLE + (this.isShort(r) ? RADIUS : 0),
      y: top + RADIUS + r * ROW_H,
    };
  }

  neighbors(r, c) {
    const off = this.isShort(r) ? [0, 1] : [-1, 0];
    const list = [
      [r, c - 1],
      [r, c + 1],
      [r - 1, c + off[0]],
      [r - 1, c + off[1]],
      [r + 1, c + off[0]],
      [r + 1, c + off[1]],
    ];
    return list.filter(([nr, nc]) => this.inBounds(nr, nc));
  }

  // Grupo conectado del mismo color
  floodFill(r, c) {
    const color = this.get(r, c);
    if (!color) return [];
    const key = (a, b) => `${a},${b}`;
    const seen = new Set([key(r, c)]);
    const stack = [[r, c]];
    const group = [];
    while (stack.length) {
      const [cr, cc] = stack.pop();
      group.push([cr, cc]);
      for (const [nr, nc] of this.neighbors(cr, cc)) {
        const k = key(nr, nc);
        if (!seen.has(k) && this.get(nr, nc) === color) {
          seen.add(k);
          stack.push([nr, nc]);
        }
      }
    }
    return group;
  }

  // Burbujas sin conexión con el techo (fila 0)
  findFloating() {
    const key = (a, b) => `${a},${b}`;
    const attached = new Set();
    const stack = [];
    (this.rows[0] ?? []).forEach((color, c) => {
      if (color) {
        attached.add(key(0, c));
        stack.push([0, c]);
      }
    });
    while (stack.length) {
      const [r, c] = stack.pop();
      for (const [nr, nc] of this.neighbors(r, c)) {
        const k = key(nr, nc);
        if (!attached.has(k) && this.get(nr, nc)) {
          attached.add(k);
          stack.push([nr, nc]);
        }
      }
    }
    const floating = [];
    for (const { r, c } of this.cells()) if (!attached.has(key(r, c))) floating.push([r, c]);
    return floating;
  }

  // Hueco libre más cercano a (x, y) donde encajar una burbuja disparada
  nearestFreeCell(x, y, top, requireSupport = true) {
    const approx = Math.round((y - top - RADIUS) / ROW_H);
    let best = null;
    for (let r = Math.max(0, approx - 1); r <= approx + 1; r++) {
      for (let c = 0; c < this.cols(r); c++) {
        if (this.get(r, c)) continue;
        // Debe tocar el techo o a otra burbuja
        const supported = r === 0 || this.neighbors(r, c).some(([nr, nc]) => this.get(nr, nc));
        if (requireSupport && !supported) continue;
        const p = this.center(r, c, top);
        const d = (p.x - x) ** 2 + (p.y - y) ** 2;
        if (!best || d < best.d) best = { r, c, d };
      }
    }
    return best ?? (requireSupport ? this.nearestFreeCell(x, y, top, false) : null);
  }
}
