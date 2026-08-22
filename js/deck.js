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
  draw10: '+10',
  discardAll: 'Défausse totale',
  reverseDraw4: 'Sens +4',
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
export const DRAW_AMOUNT = { draw2: 2, wild4: 4, draw5: 5, draw10: 10 };

/** Cartes qui infligent une pioche : dans No Mercy elles s'empilent toutes. */
export const isDrawCard = (f) => DRAW_AMOUNT[f.value] !== undefined || f.value === 'wildDraw';

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

/* ─────────────── UNO Show 'Em No Mercy ───────────────
   Paquet sans pitié : des pioches qui s'empilent sans limite, un +10, une
   défausse totale, et l'élimination pure et simple au-delà de 25 cartes. */
export function buildNoMercyDeck(copies = 1) {
  const deck = [];
  for (let c = 0; c < copies; c++) {
    for (const color of COLORS) {
      deck.push(makeCard(color, '0'));
      for (let n = 1; n <= 9; n++) { deck.push(makeCard(color, String(n))); deck.push(makeCard(color, String(n))); }
      for (const v of ['skip', 'reverse', 'draw2']) { deck.push(makeCard(color, v)); deck.push(makeCard(color, v)); }
      for (const v of ['draw10', 'skipAll', 'discardAll', 'reverseDraw4']) deck.push(makeCard(color, v));
    }
    for (let i = 0; i < 4; i++) {
      deck.push(makeCard('wild', 'wild'));
      deck.push(makeCard('wild', 'wild4'));
      deck.push(makeCard('wild', 'wildDraw'));
    }
  }
  return deck;
}

/** Les paquets proposés, avec l'aperçu de quatre cartes typiques. */
export const PACKS = [
  {
    id: 'classic', name: 'Classique',
    tagline: 'Le UNO de toujours, 108 cartes.',
    preview: [
      { color: 'red', value: '7' }, { color: 'yellow', value: 'skip' },
      { color: 'green', value: 'draw2' }, { color: 'wild', value: 'wild' },
    ],
  },
  {
    id: 'flip', name: 'Flip',
    tagline: 'Deux faces par carton, un côté clair et un côté sombre.',
    preview: [
      { color: 'blue', value: 'flip' }, { color: 'red', value: '5' },
      { color: 'purple', value: 'draw5' }, { color: 'teal', value: 'skipAll' },
    ],
  },
  {
    id: 'nomercy', name: 'No Mercy',
    tagline: 'Pioches cumulables sans limite, et élimination à 25 cartes.',
    preview: [
      { color: 'red', value: 'draw10' }, { color: 'blue', value: 'discardAll' },
      { color: 'green', value: 'reverseDraw4' }, { color: 'wild', value: 'wildDraw' },
    ],
  },
  {
    id: 'extreme', name: 'Extreme',
    tagline: 'Plus de pioche : un lanceur crache les cartes au hasard.',
    preview: [
      { color: 'yellow', value: '3' }, { color: 'red', value: 'draw2' },
      { color: 'wild', value: 'wild4' }, { color: 'blue', value: 'reverse' },
    ],
  },
];

export const packById = (id) => PACKS.find((p) => p.id === id) || PACKS[0];

/** Les conditions de victoire proposées. */
export const WIN_OPTIONS = [
  { id: 'p200', winCondition: 'points', targetScore: 200, name: '200 points',
    tagline: 'Partie courte : deux ou trois manches suffisent.', gauge: 0.4 },
  { id: 'p300', winCondition: 'points', targetScore: 300, name: '300 points',
    tagline: 'Le bon compromis entre rythme et remontées possibles.', gauge: 0.6 },
  { id: 'p500', winCondition: 'points', targetScore: 500, name: '500 points',
    tagline: 'La partie longue, où rien n\'est joué avant la fin.', gauge: 1 },
  { id: 'single', winCondition: 'single', name: 'Une seule manche',
    tagline: 'Le premier à vider sa main remporte tout, sans décompte.', gauge: 0 },
];
export function winId(settings = {}) {
  if (settings.winCondition === 'single') return 'single';
  return 'p' + (settings.targetScore || 500);
}
export const winById = (id) => WIN_OPTIONS.find((w) => w.id === id) || WIN_OPTIONS[2];

/** Les niveaux de jeu des bots. */
export const BOT_LEVELS = [
  { id: 'easy', name: 'Facile', force: 1,
    tagline: 'Ils jouent au hasard plus souvent qu\'à leur tour et oublient d\'annoncer UNO.' },
  { id: 'normal', name: 'Normal', force: 2,
    tagline: 'Ils gardent leurs jokers, visent le joueur en tête et dénoncent parfois.' },
  { id: 'hard', name: 'Difficile', force: 3,
    tagline: 'Ils comptent les couleurs, épargnent leur camp et ne pardonnent aucun oubli.' },
];
export const botById = (id) => BOT_LEVELS.find((b) => b.id === id) || BOT_LEVELS[1];

/** Les modes de jeu, rangés par famille. */
export const MODES = [
  {
    id: 'solo', groupe: 'solo', name: 'Chacun pour soi',
    tagline: 'Jusqu\'à quatre joueurs, et le premier à vider sa main l\'emporte.',
    seats: 4, teams: false,
  },
  {
    id: 'team2', groupe: 'groupe', mode: 'team', teamSize: 2, name: 'Équipes 2 v 2',
    tagline: 'Quatre joueurs, deux camps. Vous voyez le jeu de votre coéquipier.',
    seats: 4, teams: true,
  },
  {
    id: 'team3', groupe: 'groupe', mode: 'team', teamSize: 3, name: 'Équipes 3 v 3',
    tagline: 'Six joueurs qui alternent autour de la table : A, B, A, B…',
    seats: 6, teams: true,
  },
  {
    id: 'team4', groupe: 'groupe', mode: 'team', teamSize: 4, name: 'Équipes 4 v 4',
    tagline: 'Huit joueurs, la table au complet. Chaque camp joue à cartes ouvertes.',
    seats: 8, teams: true,
  },
  {
    id: 'party', groupe: 'extra', mode: 'party', name: 'Party',
    tagline: 'De 8 à 32 joueurs. L\'écran de l\'hôte devient la table, chaque téléphone '
      + 'devient une main. Avec des cartes party pour semer le chaos.',
    seats: 12, teams: false, party: true,
  },
];

/** Les dossiers de modes, dans l'ordre d'affichage. */
export const MODE_GROUPS = [
  { id: 'solo', name: 'Chacun pour soi', tagline: 'La partie classique, chacun pour sa main.' },
  { id: 'groupe', name: 'Groupe', tagline: 'Deux camps qui alternent autour de la table.' },
  { id: 'extra', name: 'Extra', tagline: 'Les formules à part, pour les grandes soirées.' },
];
export const modesOf = (dossier) => MODES.filter((m) => m.groupe === dossier);
export const folderOf = (id) => MODE_GROUPS.find((g) => g.id === id) || MODE_GROUPS[0];

export function modeId(settings = {}) {
  if (settings.mode === 'party') return 'party';
  return settings.mode === 'team' ? 'team' + (settings.teamSize || 2) : 'solo';
}
export const modeById = (id) => MODES.find((m) => m.id === id) || MODES[0];

/* ─────────────── catalogue des cartes, pour le salon ───────────────
   Les descriptions suivent les règles réellement activées : inutile
   d'annoncer une accumulation ou un échange de mains si l'hôte les a
   désactivés.                                                         */
export function cardCatalog(settings = {}) {
  const s = {
    pack: 'classic', stacking: true, sevenZero: true, bluff: false, ...settings,
  };
  const list = [];
  const add = (side, color, value, name, desc) => list.push({ side, color, value, name, desc });

  /* ── côté clair ── */
  add('light', 'red', '5', 'Chiffres 0 à 9',
    'La base du jeu : une carte se pose sur la même couleur ou sur le même chiffre.');

  if (s.sevenZero) {
    add('light', 'green', '7', 'Le 7',
      'En le posant, échangez toute votre main avec celle du joueur de votre choix.');
    add('light', 'yellow', '0', 'Le 0',
      'Toutes les mains changent de propriétaire et passent au voisin, dans le sens du jeu.');
  }

  add('light', 'blue', 'skip', 'Passe',
    'Le joueur suivant saute son tour.');
  add('light', 'green', 'reverse', 'Sens',
    'Le sens de rotation s\'inverse. À deux joueurs, elle revient à faire passer le tour.');
  if (s.pack !== 'extreme') add('light', 'red', 'draw2', '+2',
    s.stacking
      ? 'Le suivant pioche 2 cartes et passe son tour — sauf s\'il réplique avec un +2 ou un +4, qui fait grimper la pile.'
      : 'Le joueur suivant pioche 2 cartes et passe son tour.');
  add('light', 'wild', 'wild', 'Joker',
    'Posable à tout moment. Vous annoncez la couleur qui continue la partie.');
  if (s.pack !== 'extreme') add('light', 'wild', 'wild4', '+4',
    (s.stacking
      ? 'Vous choisissez la couleur et le suivant pioche 4 cartes, sauf s\'il répond par un autre +4. '
      : 'Vous choisissez la couleur et le joueur suivant pioche 4 cartes. ')
    + (s.bluff
      ? 'Il peut vous accuser de bluff si vous pouviez jouer la couleur en cours.'
      : 'La contestation est désactivée : personne ne peut vous accuser de bluff.'));

  if (s.pack === 'nomercy') {
    add('light', 'blue', 'draw10', '+10',
      'Le joueur suivant encaisse 10 cartes. Toutes les cartes de pioche s\'empilent entre elles, '
      + 'sans aucune limite : la note peut devenir monstrueuse.');
    add('light', 'green', 'skipAll', 'Tout le monde passe',
      'Tous les autres joueurs sautent leur tour : vous rejouez immédiatement.');
    add('light', 'yellow', 'discardAll', 'Défausse totale',
      'Posez-la et jetez d\'un coup toutes vos cartes de cette couleur.');
    add('light', 'red', 'reverseDraw4', 'Sens +4',
      'Le sens s\'inverse et le joueur qui devient le suivant ramasse 4 cartes.');
    add('light', 'wild', 'wildDraw', 'Joker pioche-couleur',
      'Vous annoncez une couleur : le suivant pioche jusqu\'à ce qu\'il tombe dessus.');
    add('light', 'wild', 'wild4', 'Élimination',
      `Ce paquet ne pardonne pas : dès qu'un joueur atteint 25 cartes, il est éliminé de la manche. `
      + 'Le dernier debout la remporte.');
    return list;
  }

  if (s.pack === 'extreme') {
    add('light', 'wild', 'wild', 'Le lanceur',
      'Il n\'y a plus de pioche : on appuie sur le lanceur, qui crache un nombre imprévisible de '
      + 'cartes — souvent aucune, parfois une poignée — puis le tour passe aussitôt.');
    add('light', 'red', 'draw2', 'Attaque ×2',
      'Le joueur suivant déclenche deux fois le lanceur. Autant dire qu\'il ne sait pas ce qui l\'attend.');
    add('light', 'wild', 'wild4', 'Attaque ×4',
      'Vous choisissez la couleur, et le suivant subit quatre coups de lanceur.');
    return list;
  }

  if (s.pack !== 'flip') return list;

  /* ── pack Flip ── */
  add('light', 'red', 'flip', 'Retournement',
    'Toute la partie bascule de l\'autre côté : les mains, la défausse et la couleur en cours '
    + 'montrent leur autre face. Elle se pose des deux côtés.');

  add('dark', 'pink', '5', 'Chiffres — côté sombre',
    'Mêmes règles, mais dans les couleurs sombres : rose, turquoise, orange et violet.');
  add('dark', 'purple', 'reverse', 'Sens — côté sombre',
    'Le sens de rotation s\'inverse, comme du côté clair.');
  add('dark', 'teal', 'skipAll', 'Tout le monde passe',
    'Tous les autres joueurs sautent leur tour : vous rejouez immédiatement.');
  add('dark', 'orange', 'draw5', '+5',
    s.stacking
      ? 'Le suivant pioche 5 cartes, sauf s\'il réplique par un autre +5 pour faire grimper la pile.'
      : 'Le joueur suivant pioche 5 cartes et passe son tour.');
  add('dark', 'wild', 'wild', 'Joker — côté sombre',
    'Posable à tout moment. Vous annoncez la couleur sombre qui continue.');
  add('dark', 'wild', 'wildDraw', 'Joker pioche-couleur',
    'Vous choisissez une couleur : le joueur suivant pioche jusqu\'à ce qu\'il tombe dessus.');
  return list;
}
