// qr.js — encodeur QR autonome : mode octet, correction de niveau M, versions 1 à 10.
// Écrit à la main pour garder le projet sans dépendance et fonctionnel hors ligne.

/* ─────────────── arithmétique dans GF(256), polynôme 0x11d ─────────────── */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Polynôme générateur de degré n, coefficient de tête en premier. */
function generator(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

/** Codets de correction d'erreur d'un bloc de données. */
function ecBytes(data, n) {
  const gen = generator(n);
  const buf = new Uint8Array(data.length + n);
  buf.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const f = buf[i];
    if (!f) continue;
    for (let j = 1; j <= n; j++) buf[i + j] ^= mul(gen[j], f);
  }
  return buf.slice(data.length);
}

/* ─────────────── tables du standard (niveau M, versions 1 à 10) ───────────────
   [codets EC par bloc, blocs du groupe 1, données par bloc, blocs du groupe 2, données par bloc] */
const EC_M = {
  1:  [10, 1, 16, 0, 0],
  2:  [16, 1, 28, 0, 0],
  3:  [26, 1, 44, 0, 0],
  4:  [18, 2, 32, 0, 0],
  5:  [24, 2, 43, 0, 0],
  6:  [16, 4, 27, 0, 0],
  7:  [18, 4, 31, 0, 0],
  8:  [22, 2, 38, 2, 39],
  9:  [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const dataCapacity = (v) => {
  const [, b1, d1, b2, d2] = EC_M[v];
  return b1 * d1 + b2 * d2;
};

/* ─────────────── encodage des données ─────────────── */
function encodeData(bytes, version) {
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);                                  // mode octet
  push(bytes.length, version <= 9 ? 8 : 16);        // longueur
  for (const b of bytes) push(b, 8);

  const capacity = dataCapacity(version) * 8;
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);   // terminateur
  while (bits.length % 8) bits.push(0);

  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  const pads = [0xEC, 0x11];
  for (let i = 0; out.length < dataCapacity(version); i++) out.push(pads[i % 2]);
  return out;
}

/** Découpe en blocs, calcule la correction, puis entrelace le tout. */
function interleave(data, version) {
  const [ecLen, b1, d1, b2, d2] = EC_M[version];
  const blocks = [];
  let at = 0;
  for (let i = 0; i < b1; i++) { blocks.push(data.slice(at, at + d1)); at += d1; }
  for (let i = 0; i < b2; i++) { blocks.push(data.slice(at, at + d2)); at += d2; }
  const ecs = blocks.map((b) => ecBytes(Uint8Array.from(b), ecLen));

  const out = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < ecLen; i++) {
    for (const e of ecs) out.push(e[i]);
  }
  return out;
}

/* ─────────────── construction de la matrice ─────────────── */
function blank(size) {
  return {
    m: Array.from({ length: size }, () => new Int8Array(size).fill(-1)),  // -1 = libre
    fixed: Array.from({ length: size }, () => new Uint8Array(size)),
    size,
  };
}

function put(g, r, c, v, isFixed = true) {
  if (r < 0 || c < 0 || r >= g.size || c >= g.size) return;
  g.m[r][c] = v;
  if (isFixed) g.fixed[r][c] = 1;
}

function finder(g, r0, c0) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark = inner && ((r === 0 || r === 6 || c === 0 || c === 6) ||
        (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      put(g, r0 + r, c0 + c, dark ? 1 : 0);
    }
  }
}

function alignment(g, cr, cc) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      put(g, cr + r, cc + c, dark ? 1 : 0);
    }
  }
}

function bch(value, poly, len) {
  let rem = value;
  for (let i = len - 1; i >= 0; i--) {
    if (rem & (1 << (i + len))) rem ^= poly << i;
  }
  return rem;
}

function formatBits(mask) {
  const data = (0b00 << 3) | mask;                 // niveau M = 00
  const rem = bch(data << 10, 0b10100110111, 10);
  return ((data << 10) | rem) ^ 0b101010000010010;
}

function versionBits(v) {
  const rem = bch(v << 12, 0b1111100100101, 12);
  return (v << 12) | rem;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0,
  (r, c) => ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0,
];

function skeleton(version) {
  const size = 17 + 4 * version;
  const g = blank(size);
  finder(g, 0, 0);
  finder(g, 0, size - 7);
  finder(g, size - 7, 0);

  for (const r of ALIGN[version]) {
    for (const c of ALIGN[version]) {
      const nearFinder = (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (!nearFinder) alignment(g, r, c);
    }
  }
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0 ? 1 : 0;
    put(g, 6, i, dark);
    put(g, i, 6, dark);
  }
  put(g, size - 8, 8, 1);                          // module toujours noir

  // zones réservées au format
  for (let i = 0; i <= 8; i++) { if (g.m[8][i] === -1) put(g, 8, i, 0); if (g.m[i][8] === -1) put(g, i, 8, 0); }
  for (let i = 0; i < 8; i++) { put(g, 8, size - 1 - i, 0); put(g, size - 1 - i, 8, 0); }

  if (version >= 7) {
    const vb = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (vb >> i) & 1;
      put(g, Math.floor(i / 3), size - 11 + (i % 3), bit);
      put(g, size - 11 + (i % 3), Math.floor(i / 3), bit);
    }
  }
  return g;
}

function placeData(g, codewords) {
  const size = g.size;
  let bit = 0;
  const nextBit = () => {
    const byte = codewords[bit >> 3];
    const b = byte === undefined ? 0 : (byte >> (7 - (bit & 7))) & 1;
    bit++;
    return b;
  };
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;                          // on saute la colonne de synchro
    for (let i = 0; i < size; i++) {
      const row = up ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (g.fixed[row][c]) continue;
        g.m[row][c] = nextBit();
      }
    }
    up = !up;
  }
}

function penalty(m, size) {
  let score = 0;
  const run = (get) => {
    for (let a = 0; a < size; a++) {
      let last = -1, len = 0;
      for (let b = 0; b < size; b++) {
        const v = get(a, b);
        if (v === last) { len++; } else { if (len >= 5) score += 3 + (len - 5); last = v; len = 1; }
      }
      if (len >= 5) score += 3 + (len - 5);
    }
  };
  run((a, b) => m[a][b]);
  run((a, b) => m[b][a]);

  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  const scan = (get) => {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b <= size - 11; b++) {
        let ok1 = true, ok2 = true;
        for (let k = 0; k < 11; k++) {
          const v = get(a, b + k);
          if (v !== P1[k]) ok1 = false;
          if (v !== P2[k]) ok2 = false;
        }
        if (ok1) score += 40;
        if (ok2) score += 40;
      }
    }
  };
  scan((a, b) => m[a][b]);
  scan((a, b) => m[b][a]);

  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

function applyFormat(m, size, mask) {
  const f = formatBits(mask);
  // Disposition du standard, bit 0 en premier : une copie autour du repère
  // haut-gauche, l'autre répartie entre le bas-gauche et le haut-droit.
  for (let i = 0; i < 15; i++) {
    const b = (f >> i) & 1;
    if (i < 6) m[i][8] = b;
    else if (i < 8) m[i + 1][8] = b;
    else m[size - 15 + i][8] = b;

    if (i < 8) m[8][size - 1 - i] = b;
    else if (i === 8) m[8][7] = b;
    else m[8][14 - i] = b;
  }
  m[size - 8][8] = 1;
}

/* ─────────────── API ─────────────── */
/** Matrice booléenne du QR encodant `text`. */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const headerBits = 4 + (v <= 9 ? 8 : 16);
    if (headerBits + bytes.length * 8 <= dataCapacity(v) * 8) { version = v; break; }
  }
  if (!version) throw new Error('Texte trop long pour un QR de version 10');

  const codewords = interleave(encodeData(bytes, version), version);
  const g = skeleton(version);
  placeData(g, codewords);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const m = g.m.map((row, r) => row.map((v, c) => (g.fixed[r][c] ? v : v ^ (MASKS[mask](r, c) ? 1 : 0))));
    applyFormat(m, g.size, mask);
    const s = penalty(m, g.size);
    if (!best || s < best.score) best = { score: s, m, mask };
  }
  return { size: g.size, modules: best.m, version, mask: best.mask };
}

/** QR prêt à insérer, en SVG (net à toute taille, sans image externe). */
export function qrSvg(text, { margin = 3, dark = '#0B0C12', light = '#FFFFFF' } = {}) {
  const { size, modules } = qrMatrix(text);
  const total = size + margin * 2;
  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) path += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="QR code">`
    + `<rect width="${total}" height="${total}" fill="${light}"/>`
    + `<path d="${path}" fill="${dark}"/></svg>`;
}
