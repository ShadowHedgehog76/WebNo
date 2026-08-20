// deck.js — modèle de cartes, construction et mélange du paquet UNO
export const COLORS = ['red', 'yellow', 'green', 'blue'];

export const COLOR_LABEL = {
  red: 'Rouge',
  yellow: 'Jaune',
  green: 'Vert',
  blue: 'Bleu',
};

// Valeurs possibles : '0'..'9', 'skip', 'reverse', 'draw2', 'wild', 'wild4'
export const VALUE_LABEL = {
  skip: 'Passe',
  reverse: 'Sens',
  draw2: '+2',
  wild: 'Joker',
  wild4: '+4',
};

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
  return card.value === 'wild' || card.value === 'wild4';
}

export function isNumber(card) {
  return /^[0-9]$/.test(card.value);
}

/** Points de la carte pour le décompte de fin de manche. */
export function cardPoints(card) {
  if (isNumber(card)) return Number(card.value);
  if (card.value === 'wild' || card.value === 'wild4') return 50;
  return 20; // skip, reverse, draw2
}

export function cardLabel(card) {
  const v = VALUE_LABEL[card.value] || card.value;
  if (isWild(card)) return v;
  return `${v} ${COLOR_LABEL[card.color]}`;
}
