// ui.js — rendu du DOM : table 3D, mains, salon, overlays
import {
  COLOR_LABEL, isWild, colorsOf, cardCatalog,
  PACKS, packById, MODES, MODE_GROUPS, modesOf, folderOf, modeById, modeId,
  WIN_OPTIONS, winById, winId, BOT_LEVELS, botById,
} from './deck.js?v=202608251401';
import { PARTY_CARDS, partyById } from './party.js?v=202608251401';
import { qrSvg } from './qr.js?v=202608251401';

/** Lien d'invitation d'une room. */
export function joinUrl(code) {
  return location.origin + location.pathname + '#' + code;
}

const $ = (id) => document.getElementById(id);

/** Défilement doux, sans planter là où l'API n'existe pas. */
function scrollIntoView(el, opts) {
  if (el && typeof el.scrollIntoView === 'function') {
    try { el.scrollIntoView(opts); } catch (_) { /* option non supportée */ }
  }
}
const GLYPH = { draw2: '+2', wild4: '+4', draw5: '+5', draw10: '+10', wild: '', wildDraw: '' };
const COLOR_HEX = {
  red: '#ED1C24', yellow: '#FFDE17', green: '#00A651', blue: '#0072BC',
  pink: '#E5127D', teal: '#00A9A5', orange: '#F58220', purple: '#7B4FA8',
};

// Symboles dessinés plutôt que typographiés : ils restent nets à toute taille
const SYMBOL = {
  skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.4"/><line x1="6.1" y1="17.9" x2="17.9" y2="6.1"/></svg>',
  reverse: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 22.2 2.2 14.6h2.9V3.4h3.8v11.2h2.9z"/><path d="M17 1.8l4.8 7.6h-2.9v11.2h-3.8V9.4h-2.9z"/></svg>',
  // côté sombre : tout le monde passe
  skipAll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">'
    + '<circle cx="12" cy="13.5" r="7.4"/><line x1="6.8" y1="18.7" x2="17.2" y2="8.3"/>'
    + '<circle cx="4" cy="4" r="1.6" fill="currentColor" stroke="none"/>'
    + '<circle cx="12" cy="2.6" r="1.6" fill="currentColor" stroke="none"/>'
    + '<circle cx="20" cy="4" r="1.6" fill="currentColor" stroke="none"/></svg>',
  // No Mercy : se défausser de toute une couleur
  discardAll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="2.5" y="8" width="8" height="11.5" rx="1.6"/>'
    + '<rect x="7.5" y="4.5" width="8" height="11.5" rx="1.6"/>'
    + '<path d="M18 6.5l3.5 3.5L18 13.5"/><path d="M21.5 10h-5"/></svg>',
  // le retournement : la carte se retourne
  flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M20.5 9.5A9 9 0 0 0 4.6 7"/><path d="M3.5 14.5A9 9 0 0 0 19.4 17"/>'
    + '<path d="M4.6 2.5v4.6h4.6"/><path d="M19.4 21.5v-4.6h-4.6"/></svg>',
};
const WHEEL = '<span class="cw"></span>';

/* ───────────────────────────── écrans ───────────────────────────── */
export function showScreen(name) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === 'screen-' + name);
}

export function toast(msg, kind = '') {
  const box = $('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

export function setWaiting(text) {
  const ov = $('overlay-wait');
  if (text) { $('wait-text').textContent = text; ov.hidden = false; }
  else ov.hidden = true;
}

export function setRole(isHost) {
  document.body.classList.toggle('is-host', isHost);
  document.body.classList.toggle('is-guest', !isHost);
}

/* ───────────────────────────── cartes ───────────────────────────── */
/**
 * Ce qui est réellement dessiné sur une carte. L'identifiant ne suffit pas :
 * en pack Flip, un même carton change de face au retournement, et l'élément
 * doit alors être redessiné.
 */
export function faceKey(card) {
  if (!card) return 'dos';
  return [card.color, card.value, card.chosen || '',
    card.back ? card.back.color + card.back.value : ''].join(':');
}

export function cardEl(card, opts = {}) {
  const d = document.createElement('div');
  if (opts.faceDown || !card) { d.className = 'card back'; return d; }
  d.className = 'card ' + (isWild(card) ? 'wild' : card.color);
  d.dataset.cardId = card.id;

  const inner = document.createElement('div');
  inner.className = 'inner';
  const oval = document.createElement('div');
  oval.className = 'oval';
  const glyph = document.createElement('div');
  glyph.className = 'glyph';

  if (card.value === 'wild' || card.value === 'wildDraw') {
    glyph.classList.add('wheel');
    if (card.value === 'wildDraw') {
      const plus = document.createElement('i');
      plus.className = 'wheel-plus';
      plus.textContent = '+';
      glyph.appendChild(plus);
    }
  } else if (card.value === 'reverseDraw4') {
    glyph.innerHTML = SYMBOL.reverse;
    glyph.classList.add('sm');
    const badge = document.createElement('i');
    badge.className = 'glyph-badge';
    badge.textContent = '+4';
    glyph.appendChild(badge);
  } else if (SYMBOL[card.value]) {
    glyph.innerHTML = SYMBOL[card.value];
    glyph.classList.add('sm');
  } else {
    const g = GLYPH[card.value] ?? card.value;
    glyph.textContent = g;
    if (g.length > 1) glyph.classList.add('sm');
  }
  oval.appendChild(glyph);
  inner.appendChild(oval);
  d.appendChild(inner);

  for (const pos of ['tl', 'br']) {
    const c = document.createElement('span');
    c.className = 'corner ' + pos;
    if (card.value === 'wild' || card.value === 'wildDraw') c.innerHTML = WHEEL;
    else if (card.value === 'reverseDraw4') c.innerHTML = SYMBOL.reverse;
    else if (SYMBOL[card.value]) c.innerHTML = SYMBOL[card.value];
    else c.textContent = GLYPH[card.value] ?? card.value;
    d.appendChild(c);
  }

  if (card.chosen) {
    const dot = document.createElement('span');
    dot.className = 'chosen-dot dot-' + card.chosen;
    d.appendChild(dot);
  }
  // pack Flip : un coin corné laisse deviner la couleur du verso
  if (card.back) {
    const fold = document.createElement('span');
    fold.className = 'fold';
    fold.style.setProperty('--fold', COLOR_HEX[card.back.color] || '#888');
    d.appendChild(fold);
  }
  return d;
}

/* ───────────────────────────── salon ───────────────────────────── */
const AV_COLORS = ['#ED1C24', '#0072BC', '#00A651', '#FFDE17'];

export function renderLobby({ code, players, settings, isHost, maxPlayers = 4 }, handlers = {}) {
  const team = settings.mode === 'team';
  const party = settings.mode === 'party';
  // le code s'affiche à deux endroits : dans l'en-tête, et en grand en party
  for (const [cible, boite] of [['code-value', 'qr-box'], ['code-value-party', 'qr-box-party']]) {
    const val = $(cible), qr = $(boite);
    if (!val || !qr) continue;
    val.textContent = code || '-----';
    if (code && qr.dataset.code !== code) {
      qr.dataset.code = code;
      try { qr.innerHTML = qrSvg(joinUrl(code)); } catch (_) { qr.innerHTML = ''; }
    }
  }
  $('lobby-role').textContent = isHost
    ? (party
      ? 'Mode party : votre écran est la table. Les joueurs rejoignent depuis leur téléphone.'
      : 'Vous êtes l\'hôte — réglez la partie et partagez le code.')
    : 'Vous avez rejoint la partie. En attente de l\'hôte…';
  $('player-count').textContent = `${players.length}/${maxPlayers}`;
  $('lobby-players').classList.toggle('compact', maxPlayers > 6);

  const ul = $('lobby-players');
  ul.innerHTML = '';
  // en party l'hôte occupe la première ligne mais ne joue pas : les sièges
  // des joueurs commencent après lui
  players.forEach((p, i) => {
    const grp = i % 2;
    const li = document.createElement('li');
    const av = document.createElement('span');
    av.className = 'avatar';
    av.style.background = AV_COLORS[i % 4];
    av.style.color = i % 4 === 3 ? '#2E2400' : '#fff';
    av.textContent = (p.name || '?').slice(0, 1).toUpperCase();
    li.appendChild(av);

    const nm = document.createElement('span');
    nm.className = 'pname';
    nm.textContent = p.name;
    li.appendChild(nm);

    if (team) {
      const t = document.createElement('span');
      t.className = 'tag ' + (grp === 0 ? 'teamA' : 'teamB');
      t.textContent = grp === 0 ? 'Équipe A' : 'Équipe B';
      li.appendChild(t);
    }
    if (p.isHost) { const t = document.createElement('span'); t.className = 'tag host'; t.textContent = 'Hôte'; li.appendChild(t); }
    if (p.isBot) { const t = document.createElement('span'); t.className = 'tag bot'; t.textContent = 'Bot'; li.appendChild(t); }
    if (isHost && team && players.length > 1) {
      const m = document.createElement('button');
      m.className = 'kick move'; m.textContent = '⇅'; m.title = 'Permuter de place (change les équipes)';
      m.onclick = () => handlers.onMove && handlers.onMove(p.id);
      li.appendChild(m);
    }
    if (isHost && !p.isHost) {
      const k = document.createElement('button');
      k.className = 'kick'; k.textContent = '✕'; k.title = 'Retirer';
      k.onclick = () => handlers.onKick && handlers.onKick(p.id);
      li.appendChild(k);
    }
    ul.appendChild(li);
  });
  // au-delà de six places, on résume les places libres au lieu de les lister
  const free = maxPlayers - players.length;
  if (free > 0 && maxPlayers <= 6) {
    for (let i = 0; i < free; i++) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.innerHTML = '<span class="avatar" style="background:#2a3143">·</span><span class="pname">Place libre</span>';
      ul.appendChild(li);
    }
  } else if (free > 0) {
    const li = document.createElement('li');
    li.className = 'empty summary';
    li.innerHTML = `<span class="avatar" style="background:#2a3143">${free}</span><span class="pname">place${free > 1 ? 's' : ''} libre${free > 1 ? 's' : ''}</span>`;
    ul.appendChild(li);
  }

  // reflet des réglages
  for (const seg of document.querySelectorAll('.seg[data-setting]')) {
    const key = seg.dataset.setting;
    for (const b of seg.children) b.classList.toggle('on', String(settings[key]) === b.dataset.value);
  }
  for (const sw of document.querySelectorAll('.switch[data-setting]')) {
    sw.querySelector('input').checked = !!settings[sw.dataset.setting];
  }
  document.body.classList.toggle('lobby-party', party);
  // en party, les réglages passent dans une fenêtre : la place sert au QR
  const panneau = $('settings-panel'), fente = $('settings-slot');
  if (panneau && fente) {
    const bloc = $('settings');
    if (party && bloc.parentElement !== fente) fente.appendChild(bloc);
    else if (!party && bloc.parentElement === fente) panneau.appendChild(bloc);
    panneau.hidden = party;
  }
  habillerPack(settings.pack);
  renderChoiceButtons(settings);
  renderCatalog(settings);
  $('settings').classList.toggle('locked', !isHost);

  const start = $('btn-start');
  if (start) {
    let ok, why = '';
    if (party) {
      // l'hôte n'est que l'écran : il faut deux joueurs devant lui
      const assis = players.filter((p) => !p.isHost).length;
      ok = assis >= 2;
      if (!ok) {
        why = assis === 0
          ? 'Le mode party attend au moins deux joueurs — votre écran est la table.'
          : 'Encore un joueur : le mode party en demande deux au minimum.';
      }
    } else if (team) {
      ok = players.length === maxPlayers;
      if (!ok) why = `Le mode ${settings.teamSize} contre ${settings.teamSize} exige ${maxPlayers} joueurs (ajoutez des bots).`;
    } else {
      ok = players.length >= 2;
      if (!ok) why = 'Il faut au moins 2 joueurs.';
    }
    start.disabled = !ok;
    $('lobby-status').textContent = why;
  }
}

/* ─────────────────── les choix du salon ───────────────────
   Mode, paquet, victoire et niveau des bots suivent tous le même schéma :
   un bouton illustré qui ouvre une galerie de vignettes.               */

/**
 * Aperçu d'un mode : la table vue de trois quarts, avec ses piles au centre
 * et les joueurs assis tout autour, chacun tenant ses cartes. Les camps
 * alternent, ce qui rend l'ordre A, B, A, B… lisible sans le lire.
 */
function modeVis(mode) {
  const vis = document.createElement('span');
  vis.className = 'md-vis';
  vis.dataset.seats = String(mode.seats);

  const plateau = document.createElement('span');
  plateau.className = 'md-felt';
  plateau.innerHTML = '<i class="md-deck"></i><i class="md-discard"></i>';
  vis.appendChild(plateau);

  // Les mains se posent autour du feutre : le rayon suit l'ellipse du plateau
  // élargie de la demi-largeur d'une main, pour qu'aucune ne mord dessus.
  const large = mode.seats > 6 ? 12 : (mode.seats > 4 ? 14 : 17);
  const demiFeutre = mode.seats > 6 ? 25 : (mode.seats > 4 ? 27 : 31);
  const demiHaut = mode.seats > 6 ? 23 : (mode.seats > 4 ? 25 : 28);
  const rx = demiFeutre + large / 2 + 2;
  const ry = demiHaut + 9;
  for (let i = 0; i < mode.seats; i++) {
    const a = 90 + (i * 360) / mode.seats;
    const rad = (a * Math.PI) / 180;
    const place = document.createElement('i');
    place.className = 'md-seat' + (mode.teams ? (i % 2 === 0 ? ' a' : ' b') : ' s' + (i % 4));
    place.style.width = large + '%';
    place.style.left = (50 + rx * Math.cos(rad)).toFixed(1) + '%';
    place.style.top = (50 + ry * Math.sin(rad)).toFixed(1) + '%';
    // la main s'incline comme si le joueur la tenait face à la table
    place.style.setProperty('--tilt', ((a + 90) % 360 > 180 ? 10 : -10) + 'deg');
    place.innerHTML = '<b></b><b></b><b></b>';
    vis.appendChild(place);
  }

  const compte = document.createElement('span');
  compte.className = 'md-count';
  compte.textContent = mode.seats + ' joueurs';
  vis.appendChild(compte);
  return vis;
}

/** Aperçu d'un paquet : quatre cartes en bouquet. */
function packVis(pack) {
  const fan = document.createElement('span');
  fan.className = 'pk-fan pack-' + pack.id;
  pack.preview.forEach((c, i) => {
    const el = cardEl({ id: `pv-${pack.id}-${i}`, color: c.color, value: c.value });
    el.style.setProperty('--i', String(i - (pack.preview.length - 1) / 2));
    fan.appendChild(el);
  });
  return fan;
}

/** Aperçu d'une condition de victoire : un objectif et sa jauge. */
function winVis(win) {
  const vis = document.createElement('span');
  vis.className = 'wn-vis';
  const val = document.createElement('b');
  val.textContent = win.winCondition === 'single' ? '1' : String(win.targetScore);
  const unite = document.createElement('i');
  unite.textContent = win.winCondition === 'single' ? 'manche' : 'points';
  const jauge = document.createElement('span');
  jauge.className = 'wn-gauge';
  const rempli = document.createElement('span');
  rempli.style.width = Math.round((win.gauge || 0) * 100) + '%';
  jauge.appendChild(rempli);
  vis.append(val, unite, jauge);
  return vis;
}

/** Aperçu d'un niveau de bot : trois barres, dont autant d'allumées. */
function botVis(bot) {
  const vis = document.createElement('span');
  vis.className = 'bt-vis n' + bot.force;
  const face = document.createElement('span');
  face.className = 'bt-face';
  face.innerHTML = '<i></i><i></i>';
  const barres = document.createElement('span');
  barres.className = 'bt-bars';
  for (let i = 1; i <= 3; i++) {
    const b = document.createElement('i');
    if (i <= bot.force) b.className = 'on';
    barres.appendChild(b);
  }
  vis.append(face, barres);
  return vis;
}

/**
 * Le bouton d'un réglage : aperçu, nom et description.
 * @param opts {btn, name, note, mini, item, vis}
 */
function choiceButton({ btn, name, note, mini, item, vis }) {
  const b = $(btn);
  if (!b || b.dataset.choice === item.id) return;
  b.dataset.choice = item.id;
  $(name).textContent = item.name;
  $(note).textContent = item.tagline;
  const m = $(mini);
  m.innerHTML = '';
  m.appendChild(vis(item));
}

/** La galerie d'un réglage : une vignette par choix possible. */
function choiceGallery({ overlay, grid, items, current, vis, cls, onPick, keepOpen }) {
  const g = $(grid);
  g.innerHTML = '';
  for (const item of items) {
    const tuile = document.createElement('button');
    tuile.className = 'pack-tile ' + cls;
    tuile.classList.toggle('on', item.id === current);
    tuile.dataset.choice = item.id;
    const box = document.createElement('span');
    box.className = 'pt-vis';
    box.appendChild(vis(item));
    const txt = document.createElement('span');
    txt.className = 'pt-txt';
    txt.innerHTML = '<b></b><em></em>';
    txt.querySelector('b').textContent = item.name;
    txt.querySelector('em').textContent = item.tagline;
    tuile.append(box, txt);
    tuile.onclick = () => {
      onPick(item);
      // ouvrir un dossier ne referme pas la fenêtre : on y descend d'un cran
      if (!keepOpen) $(overlay).hidden = true;
    };
    g.appendChild(tuile);
  }
  $(overlay).hidden = false;
}

/* ── les quatre réglages ── */
/** Aperçu d'un dossier : les tables qu'il contient, empilées en éventail. */
function folderVis(dossier) {
  const vis = document.createElement('span');
  vis.className = 'fd-vis';
  const modes = modesOf(dossier.id);
  modes.slice(0, 3).forEach((m, i) => {
    const carte = document.createElement('span');
    carte.className = 'fd-card';
    carte.style.setProperty('--i', String(i - (Math.min(modes.length, 3) - 1) / 2));
    carte.appendChild(modeVis(m));
    vis.appendChild(carte);
  });
  const n = document.createElement('u');
  n.textContent = modes.length + (modes.length > 1 ? ' modes' : ' mode');
  vis.appendChild(n);
  return vis;
}

/** Premier niveau : les dossiers. */
export function showModes(settings, onPick) {
  $('mode-title').textContent = 'Choisissez un mode de jeu';
  $('mode-back').hidden = true;
  const courant = modeById(modeId(settings));
  choiceGallery({
    overlay: 'overlay-modes', grid: 'mode-grid', items: MODE_GROUPS,
    current: courant.groupe, vis: folderVis, cls: 'folder-tile', keepOpen: true,
    onPick: (dossier) => { showModeFolder(dossier.id, settings, onPick); },
  });
}

/** Second niveau : les modes d'un dossier. */
export function showModeFolder(id, settings, onPick) {
  const dossier = folderOf(id);
  $('mode-title').textContent = dossier.name;
  const retour = $('mode-back');
  retour.hidden = false;
  retour.onclick = () => showModes(settings, onPick);
  choiceGallery({
    overlay: 'overlay-modes', grid: 'mode-grid', items: modesOf(id),
    current: modeId(settings), vis: modeVis, cls: 'mode-tile', onPick,
  });
}
export function hideModes() { $('overlay-modes').hidden = true; }

export function showPacks(settings, onPick) {
  choiceGallery({
    overlay: 'overlay-packs', grid: 'pack-grid', items: PACKS,
    current: settings.pack || 'classic', vis: packVis, cls: 'pack-choice',
    onPick: (p) => onPick(p.id),
  });
}
export function hidePacks() { $('overlay-packs').hidden = true; }

export function showWins(settings, onPick) {
  choiceGallery({
    overlay: 'overlay-win', grid: 'win-grid', items: WIN_OPTIONS,
    current: winId(settings), vis: winVis, cls: 'win-tile', onPick,
  });
}
export function hideWins() { $('overlay-win').hidden = true; }

export function showBots(settings, onPick) {
  choiceGallery({
    overlay: 'overlay-bots', grid: 'bots-grid', items: BOT_LEVELS,
    current: settings.botLevel || 'normal', vis: botVis, cls: 'bot-tile',
    onPick: (b) => onPick(b.id),
  });
}
export function hideBots() { $('overlay-bots').hidden = true; }

/** Met à jour les quatre boutons du salon. */
function renderChoiceButtons(settings) {
  choiceButton({ btn: 'btn-mode', name: 'mode-name', note: 'mode-note', mini: 'mode-mini',
    item: modeById(modeId(settings)), vis: modeVis });
  choiceButton({ btn: 'btn-pack', name: 'pack-name', note: 'pack-note', mini: 'pack-mini',
    item: packById(settings.pack || 'classic'), vis: packVis });
  choiceButton({ btn: 'btn-win', name: 'win-name', note: 'win-note', mini: 'win-mini',
    item: winById(winId(settings)), vis: winVis });
  choiceButton({ btn: 'btn-bots', name: 'bots-name', note: 'bots-note', mini: 'bots-mini',
    item: botById(settings.botLevel || 'normal'), vis: botVis });
}

/**
 * Applique l'habillage d'un paquet aux zones qui montrent ses cartes.
 * Porté par le corps de page, il repeignait aussi les aperçus des autres
 * paquets dans la galerie.
 */
function habillerPack(pack) {
  const id = pack || 'classic';
  for (const cible of ['screen-game', 'card-list']) {
    const el = $(cible);
    if (!el) continue;
    for (const p of PACKS) el.classList.toggle('pack-' + p.id, p.id === id);
  }
}

/* ─────────────── le pont vers le plateau en volume ───────────────
   Le rendu ne dessine plus la table : il la décrit à la scène, qui anime la
   différence entre ce qu'elle montre et ce qui est annoncé. */
let scene = null;
let sceneHandlers = null;

/** Installe la scène ; renvoie faux si la machine ne fait pas de 3D. */
/** Un appareil tactile étroit : la 3D y coûte cher et les doigts préfèrent le document. */
function petitEcran() {
  try {
    return window.matchMedia('(pointer: coarse)').matches
      && Math.min(window.innerWidth, window.innerHeight) <= 820;
  } catch (_) { return false; }
}

export async function monterPlateau(handlers) {
  sceneHandlers = handlers;
  const cv = $('scene3d');
  if (!cv) return false;

  // Les téléphones passent d'office au plateau en deux dimensions : leurs
  // cartes se touchent mieux, et rien ne leur demande de faire tourner une
  // scène en volume.
  if (!petitEcran()) {
    try {
      const { Plateau } = await import('./scene3d.js');
      scene = new Plateau(cv);
      if (!scene.demarrer()) { scene = null; throw new Error('WebGL indisponible'); }
      scene.brancherEntrees();
      window.__scene = scene;                   // pour les contrôles automatisés
      if (dernierEtat) scene.appliquer(dernierEtat);
      scene.surCarte = (card) => handlers.onCardClick && handlers.onCardClick(card);
      scene.surPioche = () => handlers.onDraw && handlers.onDraw();
      window.addEventListener('resize', () => scene && scene.redimensionner());
      $('no3d').hidden = true;
      document.body.classList.remove('en-2d');
      return true;
    } catch (_) { scene = null; }
  }
  return monterPlateau2d(handlers);
}

/** Le repli : même plateau, sans volume. */
async function monterPlateau2d(handlers) {
  const hote = $('plateau2d');
  if (!hote) return false;
  const { Plateau2d } = await import('./plateau2d.js');
  scene = new Plateau2d(hote);
  scene.demarrer();
  scene.surCarte = (card) => handlers.onCardClick && handlers.onCardClick(card);
  scene.surPioche = () => handlers.onDraw && handlers.onDraw();
  window.__scene = scene;
  hote.hidden = false;
  $('scene-wrap').hidden = true;
  $('no3d').hidden = true;
  document.body.classList.add('en-2d');
  if (dernierEtat) scene.appliquer(dernierEtat);
  return true;
}

let dernierEtat = null;
/** Mesure la place que prennent la barre du haut et les commandes du bas. */
function reserveInterface() {
  if (!scene || !scene.reserve) return;
  const cv = $('scene3d');
  if (!cv) return;
  const cadre = cv.getBoundingClientRect();
  const haut = $('hud'), bas = $('myzone') || document.querySelector('.myzone');
  const hh = haut && !haut.hidden ? haut.getBoundingClientRect().height : 0;
  const hb = bas && bas.offsetParent ? bas.getBoundingClientRect().height : 0;
  scene.reserve(Math.round(hh + 6), Math.round(Math.min(hb, cadre.height * 0.42) + 6));
}

/**
 * En manette, le plateau se glisse dans le corps de la manette, entre son
 * en-tête et ses boutons : posé par-dessus, il les recouvrait.
 */
function rangePlateau2d(state) {
  const hote = $('plateau2d');
  const pad = $('pad');
  if (!hote || !pad || hote.hidden) return;
  const manette = !!(state.party && !state.spectator);
  const dedans = hote.parentElement === pad;
  if (manette && !dedans) pad.insertBefore(hote, $('pad-actions') || null);
  else if (!manette && dedans) document.body.appendChild(hote);
}

function plateau3d(state, handlers) {
  sceneHandlers = handlers;
  dernierEtat = state;
  // la scène se charge en différé : les premiers états arrivent avant elle
  if (!scene) return;
  rangePlateau2d(state);
  scene.appliquer(state);
  reserveInterface();
}

/** Effets ponctuels demandés par le journal de la partie. */
export function effetPlateau(nom) {
  if (!scene) return;
  if (nom === 'flip') scene.animeRetournement();
  else if (nom === 'penalty') scene.animePenalite();
  else if (nom === 'win') scene.animeVictoire();
}

export function marquerCarte(cardId) { if (scene) scene.selectionne(cardId); }
export function plateauPret() { return !!scene; }

/** Liste des cartes du paquet choisi, avec ce que chacune fait vraiment. */
/** Liste des cartes du paquet choisi, avec ce que chacune fait vraiment. */
function renderCatalog(settings) {
  const list = $('card-list');
  if (!list) return;
  const entries = cardCatalog(settings);
  const key = (settings.mode || '') + ':' + (settings.pack || 'classic') + ':' + entries.map((e) => e.name).join('|')
    + ':' + entries.map((e) => e.desc.length).join('.');
  const total = entries.length + (settings.mode === 'party' ? PARTY_CARDS.length : 0);
  $('cards-count').textContent = `${total} types`;
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.innerHTML = '';
  // en mode party, les cartes party ouvrent la liste : ce sont les inédites
  if (settings.mode === 'party') {
    const sep = document.createElement('div');
    sep.className = 'rl-side party';
    sep.textContent = 'Cartes party — une seconde main, jamais échangée';
    list.appendChild(sep);
    for (const modele of PARTY_CARDS) {
      const item = document.createElement('article');
      item.className = 'rl-item';
      const vis = document.createElement('div');
      vis.className = 'rl-card';
      vis.appendChild(partyCardEl(modele, 1));
      const txt = document.createElement('div');
      txt.className = 'rl-text';
      txt.innerHTML = '<b></b><em></em>';
      txt.querySelector('b').textContent = modele.name;
      txt.querySelector('em').textContent = modele.tagline;
      item.append(vis, txt);
      list.appendChild(item);
    }
    const sep2 = document.createElement('div');
    sep2.className = 'rl-side';
    sep2.textContent = 'Cartes classiques';
    list.appendChild(sep2);
  }
  let cote = null;
  for (const e of entries) {
    if (settings.pack === 'flip' && e.side !== cote) {
      cote = e.side;
      const sep = document.createElement('div');
      sep.className = 'rl-side ' + cote;
      sep.textContent = cote === 'dark' ? 'Côté sombre' : 'Côté clair';
      list.appendChild(sep);
    }
    const item = document.createElement('article');
    item.className = 'rl-item';
    const vign = document.createElement('div');
    vign.className = 'rl-card';
    vign.appendChild(cardEl({ id: 'cat-' + e.name, color: e.color, value: e.value }));
    const txt = document.createElement('div');
    txt.className = 'rl-text';
    txt.innerHTML = '<b></b><em></em>';
    txt.querySelector('b').textContent = e.name;
    txt.querySelector('em').textContent = e.desc;
    item.append(vign, txt);
    list.appendChild(item);
  }
}

/* ───────────────────────────── table de jeu ───────────────────────────── */
let selectedId = null;

/** Met en avant la carte visée par le clavier — dans la scène, désormais. */
export function setSelection(id) {
  selectedId = id;
  marquerCarte(id);
}
export function getSelection() { return selectedId; }

export function resetGameView() {
  selectedId = null;
  if (scene) scene.reinitialise();
}

/**
 * Place un adversaire sur l'ellipse. Le joueur occupe le bas de la table ;
 * les autres se répartissent dans l'ordre du jeu sur l'arc qui va de sa
 * gauche à sa droite, en évitant le bas où sa propre main est tenue.
 */
/** Éventail tenu par un joueur : des dos, ou les faces pour un coéquipier. */
export function renderGame(state, handlers = {}) {
  // HUD
  $('hud-round').textContent = 'Manche ' + state.roundNo;
  const n = state.settings.teamSize || 2;
  $('hud-mode').textContent = state.party
    ? `Party · ${state.players.length} joueurs`
    : (state.settings.mode === 'team' ? `Équipes ${n} v ${n}` : 'Chacun pour soi');

  const party = !!state.party;
  document.body.classList.toggle('is-party', party);
  document.body.classList.toggle('is-screen', party && !!state.spectator);
  document.body.classList.toggle('is-pad', party && !state.spectator);
  plateau3d(state, handlers);
  renderKnocked(state);
  renderPartyScreen(state);
  renderPad(state, handlers);
  setTurnDeadline(state.party && state.phase === 'playing' ? state.turnLeft : null);

  document.body.classList.toggle('dark-side', state.side === 'dark');
  habillerPack(state.pack);

  const pb = $('pending-badge');
  if (state.pendingDraw > 0) {
    pb.hidden = false;
    const quoi = state.pack === 'extreme' ? `${state.pendingDraw} coups de lanceur` : `+${state.pendingDraw}`;
    pb.textContent = `${quoi} en attente${state.turnId === state.you ? ' — à vous !' : ''}`;
  } else pb.hidden = true;

  // moi
  const me = state.players.find((p) => p.id === state.you);
  if (me) {
    $('me-name').textContent = me.name;
    $('me-score').textContent = me.score + ' pt';
    const teamEl = $('me-team');
    if (state.settings.mode === 'team') {
      const mate = state.players.find((p) => p.team === me.team && p.id !== me.id);
      teamEl.hidden = false;
      teamEl.textContent = `Équipe ${me.team === 0 ? 'A' : 'B'}${mate ? ' avec ' + mate.name : ''}`;
    } else teamEl.hidden = true;
  }
  $('turn-flag').hidden = state.turnId !== state.you;

  // actions
  const myTurn = state.turnId === state.you && state.phase === 'playing';
  $('btn-draw').disabled = !(state.canDraw || (myTurn && state.pendingDraw > 0));
  const lanceur = state.pack === 'extreme';
  $('btn-draw').classList.toggle('launcher', lanceur);
  $('btn-draw').textContent = lanceur
    ? (myTurn && state.pendingDraw > 0 ? `Lancer ×${state.pendingDraw}` : 'Lancer')
    : (myTurn && state.pendingDraw > 0 ? `Piocher ${state.pendingDraw}` : 'Piocher');
  $('btn-pass').hidden = !state.canPass;
  $('btn-uno').disabled = !(state.canUno || (state.settings.unoRule && state.hand.length === 2 && state.turnId === state.you));
  $('btn-challenge').hidden = !state.canChallenge;

}

/* ─────────────────── No Mercy : l'élimination ───────────────────
   Sorti de la manche, on garde ses cartes sous les yeux mais on n'y touche
   plus : elles grisent, et un bandeau le dit franchement.               */
const KN_COULEURS = ['red', 'yellow', 'green', 'blue'];
const KN_VALEURS = ['0', '3', '5', '7', '9', 'skip', 'reverse', 'draw2', 'draw10'];

function remplirDefile() {
  const flux = $('kn-stream');
  if (!flux || flux.childElementCount) return;
  // deux séries identiques mises bout à bout : le défilement boucle sans saut
  for (let serie = 0; serie < 2; serie++) {
    const bande = document.createElement('span');
    bande.className = 'kn-band';
    for (let i = 0; i < 14; i++) {
      const c = {
        id: `kn${serie}-${i}`,
        color: KN_COULEURS[Math.floor(Math.random() * KN_COULEURS.length)],
        value: KN_VALEURS[Math.floor(Math.random() * KN_VALEURS.length)],
      };
      const el = cardEl(c);
      el.style.setProperty('--r', (Math.random() * 18 - 9).toFixed(1) + 'deg');
      bande.appendChild(el);
    }
    flux.appendChild(bande);
  }
}

function renderKnocked(state) {
  const kn = $('knocked');
  if (!kn) return;
  const sorti = !!state.eliminated;
  kn.hidden = !sorti;
  document.body.classList.toggle('is-out', sorti);
  if (!sorti) return;
  remplirDefile();
  const limite = state.mercyLimit || 25;
  $('kn-sub').textContent = `Vous avez dépassé ${limite} cartes.`;
  const restants = state.players.filter((p) => !p.out).length;
  $('kn-wait').textContent = restants > 1
    ? `La manche continue sans vous — ${restants} joueurs encore en lice.`
    : 'La manche est terminée.';
}

/* ─────────────────── mode party : deux écrans, un seul jeu ───────────────────
   L'hôte est la télévision : le plateau, les joueurs, les cartes en grand,
   et aucune main. Chaque téléphone est une manette : la main de son joueur
   et ses boutons, mais aucun plateau.                                      */

/** Vignette d'une carte party. */
export function partyCardEl(modele, count) {
  const el = document.createElement('span');
  el.className = 'pc t-' + modele.teinte;
  el.innerHTML = '<i></i><b></b>';
  el.querySelector('i').textContent = modele.icon;
  el.querySelector('b').textContent = modele.name;
  if (count > 1) {
    const n = document.createElement('u');
    n.textContent = '×' + count;
    el.appendChild(n);
  }
  return el;
}

/* Le compte à rebours ne s'affiche que dans les dernières secondes : avant,
   il ne ferait que presser inutilement.                                    */
const CD_SEUIL = 5000;
let cdFin = 0, cdBoucle = null;

/** Note l'échéance transmise par l'hôte, mesurée sur l'horloge locale. */
export function setTurnDeadline(reste) {
  cdFin = (reste === null || reste === undefined) ? 0 : Date.now() + reste;
  if (!cdBoucle) cdBoucle = setInterval(peindreCompteur, 100);
  peindreCompteur();
}

function peindreCompteur() {
  const reste = cdFin ? cdFin - Date.now() : 0;
  const montre = reste > 0 && reste <= CD_SEUIL;
  for (const id of ['cd-screen', 'cd-pad']) {
    const el = $(id);
    if (!el) continue;
    el.hidden = !montre;
    if (!montre) continue;
    const secondes = Math.ceil(reste / 1000);
    el.querySelector('b').textContent = String(secondes);
    const arc = el.querySelector('.cd-arc');
    if (arc) arc.style.setProperty('--part', (reste / CD_SEUIL).toFixed(3));
    el.classList.toggle('urgent', reste <= 2000);
  }
}

/** L'écran de l'hôte : qui joue, et où en est la partie. */
function renderPartyScreen(state) {
  const hud = $('party-hud');
  if (!hud) return;
  const actif = state.players.find((p) => p.id === state.turnId);
  hud.hidden = !state.party || !state.spectator;
  if (hud.hidden) return;
  $('ph-name').textContent = actif ? actif.name : '—';
  const restants = state.players.filter((p) => !p.out).length;
  $('ph-sub').textContent = actif
    ? `${actif.handCount} carte${actif.handCount > 1 ? 's' : ''} · ${restants} joueurs en lice`
    : '';
}

/** La manette : la main du joueur et ses commandes, sans plateau. */
function renderPad(state, handlers) {
  const pad = $('pad');
  if (!pad) return;
  const moi = state.players.find((p) => p.id === state.you);
  pad.hidden = !state.party || !moi;
  if (pad.hidden) return;

  const av = $('pad-avatar');
  av.textContent = (moi.name || '?').slice(0, 1).toUpperCase();
  av.style.background = AV_COLORS[moi.seat % 4];
  av.style.color = moi.seat % 4 === 3 ? '#2E2400' : '#fff';
  $('pad-name').textContent = moi.name;
  $('pad-cards').textContent = moi.handCount;
  $('pad-score').textContent = moi.score;

  const monTour = state.turnId === state.you && state.phase === 'playing';
  const flag = $('pad-turn');
  flag.textContent = monTour ? 'À vous de jouer' : 'En attente';
  flag.classList.toggle('on', monTour);
  pad.classList.toggle('my-turn', monTour);

  // la main du joueur vit dans la scène, ici en vue rapprochée

  $('pad-draw').disabled = !(state.canDraw || (monTour && state.pendingDraw > 0));
  $('pad-draw').textContent = monTour && state.pendingDraw > 0 ? `Piocher ${state.pendingDraw}` : 'Piocher';
  $('pad-pass').hidden = !state.canPass;
  $('pad-uno').disabled = !(state.canUno || (state.settings.unoRule && state.hand.length === 2 && monTour));
  const pty = $('pad-party');
  pty.hidden = !state.partyHand || !state.partyHand.length;
  pty.disabled = !state.canParty;
  $('pad-party-n').textContent = state.partyHand ? state.partyHand.length : 0;
}

/** Choix d'une carte party : la galerie de ce qu'on a en réserve. */
export function showPartyHand(state, onPick) {
  const grid = $('party-grid');
  grid.innerHTML = '';
  const parType = new Map();
  for (const c of state.partyHand) {
    if (!parType.has(c.party)) parType.set(c.party, []);
    parType.get(c.party).push(c);
  }
  for (const [type, cartes] of parType) {
    const modele = partyById(type);
    if (!modele) continue;
    const tuile = document.createElement('button');
    tuile.className = 'party-tile t-' + modele.teinte;
    tuile.dataset.party = type;
    tuile.dataset.cardId = cartes[0].id;
    const vis = document.createElement('span');
    vis.className = 'pt-party';
    vis.appendChild(partyCardEl(modele, cartes.length));
    const txt = document.createElement('span');
    txt.className = 'pt-txt';
    txt.innerHTML = '<b></b><em></em>';
    txt.querySelector('b').textContent = modele.name;
    txt.querySelector('em').textContent = modele.tagline;
    tuile.append(vis, txt);
    tuile.disabled = !state.canParty;
    tuile.onclick = () => { onPick(cartes[0], modele); hidePartyHand(); };
    grid.appendChild(tuile);
  }
  $('overlay-party').hidden = false;
}
export function hidePartyHand() { $('overlay-party').hidden = true; }

/* ───────────────────────────── overlays ───────────────────────────── */
function overlayPick(overlayId, wire) {
  return new Promise((resolve) => {
    const ov = $(overlayId);
    ov.hidden = false;
    const done = (val) => {
      ov.hidden = true;
      cleanup();
      resolve(val);
    };
    const cleanup = wire(done);
    const cancel = ov.querySelector('[data-cancel]');
    if (cancel) cancel.onclick = () => done(null);
  });
}

export function pickColor(side = 'light') {
  const box = $('color-picker');
  box.innerHTML = '';
  for (const c of colorsOf(side)) {
    const b = document.createElement('button');
    b.className = 'col ' + c;
    b.dataset.color = c;
    b.setAttribute('aria-label', COLOR_LABEL[c] || c);
    box.appendChild(b);
  }
  return overlayPick('overlay-color', (done) => {
    const btns = box.querySelectorAll('.col');
    btns.forEach((b) => { b.onclick = () => done(b.dataset.color); });
    return () => btns.forEach((b) => { b.onclick = null; });
  });
}

export function pickTarget(state) {
  return overlayPick('overlay-target', (done) => {
    const box = $('target-picker');
    box.innerHTML = '';
    for (const p of state.players) {
      if (p.id === state.you) continue;
      const b = document.createElement('button');
      const ally = state.settings.mode === 'team'
        && p.team === state.players.find((x) => x.id === state.you).team;
      b.innerHTML = `<span class="avatar" style="background:${AV_COLORS[p.seat % 4]}">${p.name.slice(0, 1).toUpperCase()}</span>`
        + `<span>${p.name}${ally ? ' (coéquipier)' : ''}</span>`
        + `<span class="tp-count">${p.handCount} carte${p.handCount > 1 ? 's' : ''}</span>`;
      b.onclick = () => done(p.id);
      box.appendChild(b);
    }
    return () => { box.innerHTML = ''; };
  });
}

/** Petite étiquette d'appartenance, adaptée au mode. */
function groupTag(state, p) {
  if (state.settings.mode === 'team') {
    return ` <span class="tag ${p.team === 0 ? 'teamA' : 'teamB'}">${p.team === 0 ? 'A' : 'B'}</span>`;
  }
  return '';
}

/** Choix d'une carte de sa main, pour l'offrir. */
export function pickGift(state) {
  return overlayPick('overlay-target', (done) => {
    const box = $('target-picker');
    box.innerHTML = '';
    const titre = $('overlay-target').querySelector('h3');
    const ancien = titre.textContent;
    titre.textContent = 'Quelle carte offrez-vous ?';
    for (const c of state.hand) {
      const b = document.createElement('button');
      b.className = 'gift';
      b.appendChild(cardEl(c));
      const nom = document.createElement('span');
      nom.textContent = cardLabelOf(c);
      b.appendChild(nom);
      b.onclick = () => { titre.textContent = ancien; done(c.id); };
      box.appendChild(b);
    }
    return () => { titre.textContent = ancien; box.innerHTML = ''; };
  });
}

function cardLabelOf(c) {
  const v = { skip: 'Passe', reverse: 'Sens', draw2: '+2', draw5: '+5', draw10: '+10',
    wild: 'Joker', wild4: '+4', wildDraw: 'Joker pioche', flip: 'Retournement',
    skipAll: 'Tout le monde passe', discardAll: 'Défausse totale', reverseDraw4: 'Sens +4' }[c.value] || c.value;
  return isWild(c) ? v : `${v} ${(COLOR_LABEL[c.color] || c.color).toLowerCase()}`;
}

export function showRoundEnd(state) {
  const r = state.roundResult;
  if (!r) return;
  $('overlay-round').hidden = false;
  $('round-title').textContent = `Manche ${state.roundNo} — ${r.winnerName} l'emporte`;
  const body = $('round-body');
  body.innerHTML = '';
  for (const d of r.detail) {
    const p = state.players.find((x) => x.id === d.id);
    const tr = document.createElement('tr');
    if (d.id === r.winnerId) tr.className = 'win';
    tr.innerHTML = `<td>${p.name}${groupTag(state, p)}</td>`
      + `<td>${d.cards}</td><td>${d.points}</td><td>${p.score}</td>`;
    body.appendChild(tr);
  }
  const target = state.settings.winCondition === 'points' ? ` — objectif ${state.settings.targetScore} pts` : '';
  $('round-note').textContent = r.label
    ? `${r.label} marque ${r.points} points${target}.`
    : `${r.winnerName} marque ${r.points} points${target}.`;
}

export function hideRoundEnd() { $('overlay-round').hidden = true; }

export function showGameOver(state) {
  const g = state.gameResult;
  if (!g) return;
  $('overlay-round').hidden = true;
  $('overlay-game').hidden = false;
  const label = g.label || (g.type === 'team' ? `Équipe ${g.team === 0 ? 'A' : 'B'}` : null);
  $('game-winner').textContent = g.type === 'team'
    ? (g.names.length <= 4
      ? `${label} — ${g.names.join(' & ')} (${g.score} pts)`
      : `${label} — ${g.names.length} joueurs (${g.score} pts)`)
    : `${g.names[0]} — ${g.score} pts`;
  const body = $('final-body');
  body.innerHTML = '';
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  for (const p of sorted) {
    const tr = document.createElement('tr');
    const isWinner = g.type === 'team' ? p.team === g.team : p.id === g.playerId;
    if (isWinner) tr.className = 'win';
    tr.innerHTML = `<td>${p.name}${groupTag(state, p)}${p.isBot ? ' <span class="tag bot">Bot</span>' : ''}</td><td>${p.score}</td>`;
    body.appendChild(tr);
  }
}

export function hideGameOver() { $('overlay-game').hidden = true; }

/** Pluie de confettis aux couleurs du jeu. */
/** Annonce le passage d'un côté à l'autre : toutes les cartes se retournent. */
export function flipAnnounce(side) {
  const el = $('flip-flash');
  if (!el) return;
  el.querySelector('b').textContent = side === 'dark' ? 'CÔTÉ SOMBRE' : 'CÔTÉ CLAIR';
  el.hidden = false;
  document.body.classList.add('flipping');
  clearTimeout(flipAnnounce.t1);
  clearTimeout(flipAnnounce.t2);
  flipAnnounce.t1 = setTimeout(() => document.body.classList.remove('flipping'), 600);
  flipAnnounce.t2 = setTimeout(() => { el.hidden = true; }, 1600);
}

export function confetti(count = 90) {
  const box = $('confetti');
  if (!box) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#ED1C24', '#FFDE17', '#00A651', '#0072BC', '#FFC93C'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.style.left = (Math.random() * 100).toFixed(1) + '%';
    p.style.background = colors[i % colors.length];
    p.style.width = (6 + Math.random() * 7).toFixed(0) + 'px';
    p.style.height = (10 + Math.random() * 10).toFixed(0) + 'px';
    p.style.animationDuration = (2.1 + Math.random() * 2).toFixed(2) + 's';
    p.style.animationDelay = (Math.random() * 0.8).toFixed(2) + 's';
    box.appendChild(p);
    setTimeout(() => p.remove(), 5400);
  }
}
