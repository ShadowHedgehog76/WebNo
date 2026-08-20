// ui.js — rendu du DOM : table 3D, mains, salon, overlays
import { COLOR_LABEL, isWild } from './deck.js';

const $ = (id) => document.getElementById(id);
const GLYPH = { draw2: '+2', wild4: '+4', wild: '' };
const COLOR_HEX = { red: '#ED1C24', yellow: '#FFDE17', green: '#00A651', blue: '#0072BC' };

// Symboles dessinés plutôt que typographiés : ils restent nets à toute taille
const SYMBOL = {
  skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.4"/><line x1="6.1" y1="17.9" x2="17.9" y2="6.1"/></svg>',
  reverse: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 22.2 2.2 14.6h2.9V3.4h3.8v11.2h2.9z"/><path d="M17 1.8l4.8 7.6h-2.9v11.2h-3.8V9.4h-2.9z"/></svg>',
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

  if (card.value === 'wild') {
    glyph.classList.add('wheel');
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
    if (card.value === 'wild') c.innerHTML = WHEEL;
    else if (SYMBOL[card.value]) c.innerHTML = SYMBOL[card.value];
    else c.textContent = GLYPH[card.value] ?? card.value;
    d.appendChild(c);
  }

  if (card.chosen) {
    const dot = document.createElement('span');
    dot.className = 'chosen-dot dot-' + card.chosen;
    d.appendChild(dot);
  }
  return d;
}

/** Carte miniature face visible, pour la main du coéquipier. */
export function miniCardEl(card) {
  const d = document.createElement('span');
  d.className = 'mini face ' + (isWild(card) ? 'wild' : card.color);
  const v = document.createElement('b');
  if (card.value === 'wild') v.innerHTML = WHEEL;
  else if (SYMBOL[card.value]) v.innerHTML = SYMBOL[card.value];
  else v.textContent = GLYPH[card.value] ?? card.value;
  d.appendChild(v);
  return d;
}

const VALUE_ORDER = { skip: 10, reverse: 11, draw2: 12, wild: 13, wild4: 14 };
const sortKey = (c) => (isWild(c) ? 9 : ['red', 'yellow', 'green', 'blue'].indexOf(c.color)) * 100
  + (VALUE_ORDER[c.value] ?? Number(c.value));

/* ───────────────────────────── salon ───────────────────────────── */
const AV_COLORS = ['#ED1C24', '#0072BC', '#00A651', '#FFDE17'];

export function renderLobby({ code, players, settings, isHost, maxPlayers = 4 }, handlers = {}) {
  $('code-value').textContent = code || '-----';
  $('lobby-role').textContent = isHost
    ? 'Vous êtes l\'hôte — réglez la partie et partagez le code.'
    : 'Vous avez rejoint la partie. En attente de l\'hôte…';
  $('player-count').textContent = `${players.length}/${maxPlayers}`;

  const ul = $('lobby-players');
  ul.innerHTML = '';
  players.forEach((p, i) => {
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

    if (settings.mode === 'team') {
      const t = document.createElement('span');
      t.className = 'tag ' + (i % 2 === 0 ? 'teamA' : 'teamB');
      t.textContent = i % 2 === 0 ? 'Équipe A' : 'Équipe B';
      li.appendChild(t);
    }
    if (p.isHost) { const t = document.createElement('span'); t.className = 'tag host'; t.textContent = 'Hôte'; li.appendChild(t); }
    if (p.isBot) { const t = document.createElement('span'); t.className = 'tag bot'; t.textContent = 'Bot'; li.appendChild(t); }
    if (isHost && settings.mode === 'team' && players.length > 1) {
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
  for (let i = players.length; i < maxPlayers; i++) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.innerHTML = '<span class="avatar" style="background:#2a3143">·</span><span class="pname">Place libre</span>';
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
  $('settings').classList.toggle('locked', !isHost);
  document.querySelector('.seg[data-setting="targetScore"]').style.opacity = settings.winCondition === 'points' ? '1' : '.35';

  const start = $('btn-start');
  if (start) {
    const ok = players.length >= 2 && (settings.mode !== 'team' || players.length === 4);
    start.disabled = !ok;
    $('lobby-status').textContent = !ok
      ? (settings.mode === 'team' ? 'Le mode équipes exige exactement 4 joueurs (ajoutez des bots).' : 'Il faut au moins 2 joueurs.')
      : '';
  }
}

/* ───────────────────────────── table de jeu ───────────────────────────── */
const seatIds = { left: 'seat-left', top: 'seat-top', right: 'seat-right' };
let handEls = new Map();
let lastTopId = null;
let lastHandIds = new Set();
let selectedId = null;

/** Met en avant la carte visée par le clavier. */
export function setSelection(id) {
  selectedId = id;
  for (const [cid, el] of handEls) el.classList.toggle('selected', cid === id);
  const el = id && handEls.get(id);
  if (el && el.parentElement && el.parentElement.classList.contains('scroll')) {
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }
}
export function getSelection() { return selectedId; }

export function resetGameView() {
  handEls = new Map(); lastTopId = null; lastHandIds = new Set(); selectedId = null;
  $('hand').innerHTML = '';
  $('hand').classList.remove('scroll');
  $('discard-pile').innerHTML = '';
  const list = $('loglist');
  if (list) { list.innerHTML = ''; delete list.dataset.stamp; }
  for (const id of Object.values(seatIds)) $(id).innerHTML = '';
}

function seatSlots(state) {
  const n = state.players.length;
  const me = state.players.find((p) => p.id === state.you);
  const mySeat = me ? me.seat : 0;
  const rel = (p) => ((p.seat - mySeat) % n + n) % n;
  const map = {};
  for (const p of state.players) {
    const r = rel(p);
    if (r === 0) continue;
    if (n === 2) map.top = p;
    else if (n === 3) map[r === 1 ? 'left' : 'right'] = p;
    else map[r === 1 ? 'left' : (r === 2 ? 'top' : 'right')] = p;
  }
  return map;
}

function renderOpponent(slot, p, state, handlers) {
  const host = $(seatIds[slot]);
  let box = host.firstElementChild;
  if (!box) {
    box = document.createElement('div');
    box.className = 'player-box';
    box.innerHTML = '<div class="pb-head"><span class="pb-avatar"></span><span class="pb-name"></span></div>'
      + '<div class="mini-hand"></div><div class="pb-meta"></div>';
    box.style.position = 'relative';
    host.appendChild(box);
  }
  const me = state.players.find((x) => x.id === state.you);
  const ally = state.settings.mode === 'team' && me && p.team === me.team;
  box.classList.toggle('active', state.turnId === p.id);
  box.classList.toggle('ally', ally);
  box.querySelector('.pb-name').textContent = p.name;
  box.classList.toggle('offline', !p.connected);
  const av = box.querySelector('.pb-avatar');
  av.textContent = (p.name || '?').slice(0, 1).toUpperCase();
  av.style.background = AV_COLORS[p.seat % 4];
  av.style.color = p.seat % 4 === 3 ? '#2E2400' : '#fff';

  const mini = box.querySelector('.mini-hand');
  const revealed = state.allyHand && p.id === state.allyId;
  mini.classList.toggle('revealed', !!revealed);
  if (revealed) {
    const key = state.allyHand.map((c) => c.id).join(',');
    if (mini.dataset.key !== key) {
      mini.dataset.key = key;
      mini.innerHTML = '';
      for (const c of [...state.allyHand].sort((a, b) => sortKey(a) - sortKey(b))) {
        mini.appendChild(miniCardEl(c));
      }
    }
  } else {
    const shown = Math.min(p.handCount, 8);
    if (mini.dataset.key || mini.childElementCount !== shown) {
      mini.dataset.key = '';
      mini.innerHTML = '';
      for (let i = 0; i < shown; i++) {
        const c = document.createElement('div');
        c.className = 'mini';
        c.style.setProperty('--r', (i - shown / 2) * 3 + 'deg');
        mini.appendChild(c);
      }
    }
  }

  const meta = box.querySelector('.pb-meta');
  meta.innerHTML = '';
  const bit = (cls, text) => {
    const el = document.createElement('span');
    el.className = 'pm ' + cls;
    el.textContent = text;
    meta.appendChild(el);
  };
  bit('pm-cards', `${p.handCount} carte${p.handCount > 1 ? 's' : ''}`);
  bit('pm-score', `${p.score} pt`);
  if (state.settings.mode === 'team') bit('pm-side', ally ? 'Coéquipier' : 'Adverse');
  if (p.isBot) bit('pm-bot', 'Bot');
  if (!p.connected) bit('dc-badge', 'hors ligne');

  const old = box.querySelector('.uno-badge');
  if (old) old.remove();
  if (p.handCount === 1) {
    const b = document.createElement('span');
    b.className = 'uno-badge';
    const callable = state.calloutTargets.includes(p.id);
    if (callable) {
      b.classList.add('callable');
      b.textContent = 'DÉNONCER';
      b.onclick = () => handlers.onCallout && handlers.onCallout(p.id);
    } else {
      b.textContent = 'UNO';
    }
    box.appendChild(b);
  }
}

function renderHand(state, handlers) {
  const host = $('hand');
  const ids = new Set(state.hand.map((c) => c.id));
  for (const [id, el] of handEls) {
    if (!ids.has(id)) { el.remove(); handEls.delete(id); }
  }

  // 1) on crée d'abord les cartes manquantes, sans les placer
  state.hand.forEach((card) => {
    if (handEls.has(card.id)) return;
    const el = cardEl(card);
    if (lastHandIds.size) el.classList.add('dealt');
    el.addEventListener('click', () => handlers.onCardClick && handlers.onCardClick(card, el));
    host.appendChild(el);
    handEls.set(card.id, el);
  });

  // 2) on mesure une carte réelle : aucune supposition sur la taille
  const n = state.hand.length;
  const first = host.firstElementChild;
  const cw = (first && first.offsetWidth) || 92;
  const avail = host.clientWidth || host.getBoundingClientRect().width || window.innerWidth || 800;

  // Les cartes pivotent autour d'un point situé sous la main (transform-origin
  // 50% 168%) : l'inclinaison les déporte latéralement en plus de leur écart.
  // Sans en tenir compte, les cartes des extrémités sortent de l'écran.
  const angStepFor = (k) => Math.min(5.5, 40 / Math.max(k, 1));
  const arcSpread = (k) => {
    if (k < 2) return 0;
    const half = angStepFor(k) * (k - 1) / 2;
    return 1.18 * (cw * 1.5) * Math.sin(half * Math.PI / 180);
  };
  const room = Math.max(120, avail - cw - 24 - 2 * arcSpread(n));
  const raw = n > 1 ? room / (n - 1) : Infinity;

  // 3) éventail tant que les cartes restent lisibles, sinon bande défilante.
  //    Les deux seuils diffèrent pour éviter tout clignotement.
  const wasScroll = host.classList.contains('scroll');
  const scroll = wasScroll ? raw < cw * 0.50 : raw < cw * 0.44;
  host.classList.toggle('scroll', scroll);

  const maxStep = cw * 0.78;
  const step = scroll ? 0 : (n > 1 ? Math.max(16, Math.min(maxStep, raw)) : 0);
  const angStep = scroll ? 0 : angStepFor(n);
  const mid = (n - 1) / 2;
  const myTurn = state.turnId === state.you;

  state.hand.forEach((card, i) => {
    const el = handEls.get(card.id);
    el.style.setProperty('--x', ((i - mid) * step).toFixed(1) + 'px');
    el.style.setProperty('--a', ((i - mid) * angStep).toFixed(2) + 'deg');
    el.style.zIndex = String(i);
    const legal = state.legal.includes(card.id);
    el.classList.toggle('playable', legal);
    el.classList.toggle('jump', legal && !myTurn);
    el.classList.toggle('dim', !legal && myTurn && state.phase === 'playing');
  });

  if (selectedId && !ids.has(selectedId)) selectedId = null;
  for (const [cid, el] of handEls) el.classList.toggle('selected', cid === selectedId);
  lastHandIds = ids;
}

function renderAllyStrip(state) {
  const strip = $('ally-strip');
  if (!strip) return;
  if (!state.allyHand) { strip.hidden = true; strip.dataset.key = ''; return; }
  const ally = state.players.find((p) => p.id === state.allyId);
  const key = (ally ? ally.name : '') + '|' + state.allyHand.map((c) => c.id).join(',');
  strip.hidden = false;
  if (strip.dataset.key === key) return;
  strip.dataset.key = key;
  $('ally-label').textContent = ally ? `Main de ${ally.name}` : 'Coéquipier';
  const box = $('ally-cards');
  box.innerHTML = '';
  for (const c of [...state.allyHand].sort((a, b) => sortKey(a) - sortKey(b))) {
    box.appendChild(miniCardEl(c));
  }
}

function renderDiscard(state) {
  const pile = $('discard-pile');
  pile.className = 'pile discard glow-' + state.currentColor;
  if (!state.top) return;
  if (state.top.id !== lastTopId) {
    const el = cardEl(state.top);
    el.classList.add('newest');
    el.style.setProperty('--rot', (Math.random() * 26 - 13).toFixed(1) + 'deg');
    el.style.transform = `rotate(${el.style.getPropertyValue('--rot')})`;
    pile.appendChild(el);
    while (pile.childElementCount > 5) pile.firstElementChild.remove();
    lastTopId = state.top.id;
  } else {
    const last = pile.lastElementChild;
    if (last && state.top.chosen) {
      let dot = last.querySelector('.chosen-dot');
      if (!dot) { dot = document.createElement('span'); last.appendChild(dot); }
      dot.className = 'chosen-dot dot-' + state.top.chosen;
    }
  }
}

export function renderGame(state, handlers = {}) {
  // HUD
  $('hud-round').textContent = 'Manche ' + state.roundNo;
  $('hud-mode').textContent = state.settings.mode === 'team' ? 'Équipes 2 v 2' : 'Chacun pour soi';

  // adversaires
  const slots = seatSlots(state);
  for (const [slot, id] of Object.entries(seatIds)) {
    if (slots[slot]) renderOpponent(slot, slots[slot], state, handlers);
    else $(id).innerHTML = '';
  }

  // centre
  renderDiscard(state);
  $('deck-count').textContent = state.deckCount;
  $('deck-pile').classList.toggle('can-draw', state.canDraw || (state.pendingDraw > 0 && state.turnId === state.you));
  $('dir-ring').classList.toggle('ccw', state.direction === -1);
  const table = $('table3d');
  if (table) table.style.setProperty('--play-color', COLOR_HEX[state.currentColor] || 'rgba(255,255,255,.2)');

  const pb = $('pending-badge');
  if (state.pendingDraw > 0) {
    pb.hidden = false;
    pb.textContent = `+${state.pendingDraw} en attente${state.turnId === state.you ? ' — à vous !' : ''}`;
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
  renderAllyStrip(state);
  renderHand(state, handlers);

  // actions
  const myTurn = state.turnId === state.you && state.phase === 'playing';
  $('btn-draw').disabled = !(state.canDraw || (myTurn && state.pendingDraw > 0));
  $('btn-draw').textContent = myTurn && state.pendingDraw > 0 ? `Piocher ${state.pendingDraw}` : 'Piocher';
  $('btn-pass').hidden = !state.canPass;
  $('btn-uno').disabled = !(state.canUno || (state.settings.unoRule && state.hand.length === 2 && state.turnId === state.you));
  $('btn-challenge').hidden = !state.canChallenge;

  // journal : reconstruit uniquement quand il a changé
  const list = $('loglist');
  const stamp = state.log.length ? String(state.log[state.log.length - 1].t) + ':' + state.log.length : '0';
  if (list.dataset.stamp === stamp) return;
  list.dataset.stamp = stamp;
  list.innerHTML = '';
  for (const e of state.log.slice(-24).reverse()) {
    const li = document.createElement('li');
    li.textContent = e.text;
    if (['win', 'uno', 'callout', 'penalty', 'swap', 'rotate', 'jump', 'challenge'].includes(e.type)) li.classList.add('hl');
    list.appendChild(li);
  }
}

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

export function pickColor() {
  return overlayPick('overlay-color', (done) => {
    const btns = document.querySelectorAll('#overlay-color .col');
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
    tr.innerHTML = `<td>${p.name}${state.settings.mode === 'team' ? ` <span class="tag ${p.team === 0 ? 'teamA' : 'teamB'}">${p.team === 0 ? 'A' : 'B'}</span>` : ''}</td>`
      + `<td>${d.cards}</td><td>${d.points}</td><td>${p.score}</td>`;
    body.appendChild(tr);
  }
  const target = state.settings.winCondition === 'points' ? ` — objectif ${state.settings.targetScore} pts` : '';
  $('round-note').textContent = state.settings.mode === 'team'
    ? `L'équipe ${r.team === 0 ? 'A' : 'B'} marque ${r.points} points${target}.`
    : `${r.winnerName} marque ${r.points} points${target}.`;
}

export function hideRoundEnd() { $('overlay-round').hidden = true; }

export function showGameOver(state) {
  const g = state.gameResult;
  if (!g) return;
  $('overlay-round').hidden = true;
  $('overlay-game').hidden = false;
  $('game-winner').textContent = g.type === 'team'
    ? `Équipe ${g.team === 0 ? 'A' : 'B'} — ${g.names.join(' & ')} (${g.score} pts)`
    : `${g.names[0]} — ${g.score} pts`;
  const body = $('final-body');
  body.innerHTML = '';
  const sorted = [...state.players].sort((a, b) => b.score - a.score);
  for (const p of sorted) {
    const tr = document.createElement('tr');
    const isWinner = g.type === 'team' ? p.team === g.team : p.id === g.playerId;
    if (isWinner) tr.className = 'win';
    tr.innerHTML = `<td>${p.name}${p.isBot ? ' <span class="tag bot">Bot</span>' : ''}</td><td>${p.score}</td>`;
    body.appendChild(tr);
  }
}

export function hideGameOver() { $('overlay-game').hidden = true; }

/** Pluie de confettis aux couleurs du jeu. */
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
