// deck.js — modèle de cartes, construction et mélange du paquet UNO
export const COLORS = ['red', 'yellow', 'green', 'blue'];
/** Couleurs du côté sombre du pack Flip : ce sont d'autres couleurs. */
export const DARK_COLORS = ['pink', 'teal', 'orange', 'purple'];
export const colorsOf = (side) => (side === 'dark' ? DARK_COLORS : COLORS);

export const COLOR_LABEL = {
  red: 'Rouge', yellow: 'Jaune', green: 'Vert', blue: 'Bleu',
  pink: 'Rose', teal: 'Turquoise', orange: 'Orange', purple: 'Violet',
};

// Valeurs possibles : '0'..'9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'
export const VALUE_LABEL = {
  skip: 'Passe',
  reverse: 'Sens',
  draw2: '+2',
  wild: 'Joker',
  wild4: '+4',
  flip: 'Retournement',
  skipAll: 'Tout le monde passe',
  draw5: '+5',
  wildDraw: 'Joker pioche-couleur',
};

/** Faces d'un même carton : côté clair et côté sombre n'ont rien à voir. */
export function face(card, side = 'light') {
  if (!card) return card;
  return card.light ? card[side] || card.light : card;
}
export const isFlipCard = (card) => !!(card && card.light);

let uid = 0;
function makeCard(color, value) {
  return { id: 'c' + (++uid), color, value };
}

/** Paquet standard de 108 cartes, ou plusieurs paquets mélangés ensemble. */
export function buildDeck(copies = 1) {
  const deck = [];
  for (let c = 0; c < copies; c++) buildOne(deck);
  return deck;
}

/** Nombre de paquets nécessaires pour distribuer n mains et garder une pioche. */
export function decksNeeded(n, startCards = 7) {
  return Math.max(1, Math.ceil((n * startCards + 40) / 108));
}

function buildOne(deck) {
  for (const color of COLORS) {
    deck.push(makeCard(color, '0'));
    for (let n = 1; n <= 9; n++) {
      deck.push(makeCard(color, String(n)));
      deck.push(makeCard(color, String(n)));
    }
    for (const v of ['skip', 'reverse', 'draw2']) {
      deck.push(makeCard(color, v));
      deck.push(makeCard(color, v));
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push(makeCard('wild', 'wild'));
    deck.push(makeCard('wild', 'wild4'));
  }
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function isWild(card) {
  return card.value === 'wild' || card.value === 'wild4' || card.value === 'wildDraw';
}

export function isNumber(card) {
  return /^[0-9]$/.test(card.value);
}

/** Valeurs qui font piocher, et le nombre de cartes correspondant. */
export const DRAW_AMOUNT = { draw2: 2, wild4: 4, draw5: 5 };

/** Points de la carte pour le décompte de fin de manche. */
export function cardPoints(card) {
  if (isNumber(card)) return Number(card.value);
  if (isWild(card)) return 50;
  if (card.value === 'draw5' || card.value === 'skipAll') return 30;
  return 20; // skip, reverse, draw2, flip
}

export function cardLabel(card) {
  const v = VALUE_LABEL[card.value] || card.value;
  if (isWild(card)) return v;
  return `${v} ${COLOR_LABEL[card.color] || card.color}`;
}

/* ─────────────── pack Flip : un paquet à deux faces ─────────────── */

function facesFor(side) {
  const out = [];
  for (const color of colorsOf(side)) {
    out.push({ color, value: '0' });
    for (let n = 1; n <= 9; n++) { out.push({ color, value: String(n) }); out.push({ color, value: String(n) }); }
    const actions = side === 'dark' ? ['reverse', 'skipAll', 'draw5'] : ['skip', 'reverse', 'draw2'];
    for (const v of actions) { out.push({ color, value: v }); out.push({ color, value: v }); }
    out.push({ color, value: 'flip' });
    out.push({ color, value: 'flip' });
  }
  const joker = side === 'dark' ? 'wildDraw' : 'wild4';
  for (let i = 0; i < 4; i++) {
    out.push({ color: 'wild', value: 'wild' });
    out.push({ color: 'wild', value: joker });
  }
  return out;
}

const familyOf = (f) => (f.value === 'flip' ? 'flip' : (f.color === 'wild' ? 'wild' : 'normal'));

/**
 * Paquet Flip : chaque carton porte une face claire et une face sombre
 * tirées au hasard l'une de l'autre — sauf les retournements et les jokers,
 * appariés entre eux pour rester jouables des deux côtés.
 */
export function buildFlipDeck(copies = 1, rng = Math.random) {
  const light = [], dark = [];
  for (let c = 0; c < copies; c++) { light.push(...facesFor('light')); dark.push(...facesFor('dark')); }
  const parFamille = (list) => {
    const g = { flip: [], wild: [], normal: [] };
    for (const f of list) g[familyOf(f)].push(f);
    for (const k of Object.keys(g)) shuffle(g[k], rng);
    return g;
  };
  const L = parFamille(light), D = parFamille(dark);
  const deck = [];
  for (const k of ['flip', 'wild', 'normal']) {
    for (let i = 0; i < L[k].length; i++) {
      deck.push({ id: 'c' + (++uid), light: L[k][i], dark: D[k][i] });
    }
  }
  return deck;
}
