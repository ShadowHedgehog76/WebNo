// app.js — orchestration : accueil, salon, boucle hôte (moteur + IA), client
import { UnoGame, DEFAULT_SETTINGS } from './engine.js';
import { Tournament, tournamentSize, DEFAULT_TABLES } from './tournament.js';
import { botDecide, botJumpIn, botCallout, botDelay, botProfile } from './bot.js';
import { HostNet, ClientNet, normalizeCode, codeFromScan } from './net.js';
import { isWild } from './deck.js';
import * as ui from './ui.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);
const BOT_NAMES = ['Léa', 'Max', 'Zoé', 'Nino', 'Iris', 'Sacha', 'Milo', 'Nora', 'Tao', 'Lila',
  'Enzo', 'Jade', 'Otis', 'Rêva', 'Kais', 'Anouk', 'Basile', 'Cléo', 'Diego', 'Elsa',
  'Fabio', 'Gaia', 'Hugo', 'Inès'];

/** Places disponibles : en party l'hôte observe, il occupe une place en plus. */
function maxPlayers(settings) {
  return settings.mode === 'party' ? tournamentSize(settings.tables || DEFAULT_TABLES) + 1 : 4;
}
const HOST_ID = 'p0';

const App = {
  role: null,      // 'host' | 'guest'
  name: '',
  myId: null,
  host: null,
  client: null,
  view: null,      // dernier état reçu
  armedUno: false,
  lastLogAt: 0,
  busy: false,
  leaving: false,
};

/* ═══════════════════════════ HÔTE ═══════════════════════════ */
class Host {
  constructor(name) {
    this.net = new HostNet();
    this.settings = { ...DEFAULT_SETTINGS };
    this.seq = 1;
    this.players = [{ id: HOST_ID, name, isHost: true, isBot: false, peerId: null }];
    this.game = null;
    this.tour = null;
    this.tableAt = new Map();     // cadence des bots, une entrée par table
    this.unoSince = new Map();
    this.jumpTried = new Set();
    this.jumpToken = 0;
    this.pump = null;
  }

  async open() {
    this.code = await this.net.open();
    this.net.on('message', (peerId, msg) => this.onMessage(peerId, msg));
    this.net.on('close', (peerId) => this.onClose(peerId));
    return this.code;
  }

  newId() { return 'p' + (this.seq++); }

  byPeer(peerId) { return this.players.find((p) => p.peerId === peerId); }

  onMessage(peerId, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (this.byPeer(peerId)) return;
      if (this.game || this.tour) { this.net.send(peerId, { t: 'error', msg: 'La partie a déjà commencé.', fatal: true }); return; }
      if (this.players.length >= maxPlayers(this.settings)) { this.net.send(peerId, { t: 'error', msg: 'La room est complète.', fatal: true }); return; }
      const name = sanitizeName(msg.name, this.players.map((p) => p.name));
      this.players.push({ id: this.newId(), name, isHost: false, isBot: false, peerId });
      audio.sfx('join');
      ui.toast(`${name} rejoint la partie`);
      this.syncLobby();
      return;
    }
    const player = this.byPeer(peerId);
    if (!player) return;
    if (msg.t === 'action' && (this.game || this.tour)) {
      const res = this.tour
        ? this.tour.handle(player.id, msg.action)
        : this.game.handle(player.id, msg.action);
      if (!res.ok) this.net.send(peerId, { t: 'error', msg: res.error });
      this.afterChange();
    }
    if (msg.t === 'nextRound') { /* réservé à l'hôte */ }
  }

  onClose(peerId) {
    const p = this.byPeer(peerId);
    if (!p) return;
    p.peerId = null;
    if (!this.game && !this.tour) {
      this.players = this.players.filter((x) => x.id !== p.id);
      ui.toast(`${p.name} a quitté le salon`, 'warn');
      this.syncLobby();
    } else {
      const src = this.tour ? this.tour.gameOf(p.id) : this.game;
      const gp = src ? src.byId(p.id) : null;
      if (gp) { gp.connected = false; gp.isBot = true; }
      p.isBot = true;
      ui.toast(`${p.name} s'est déconnecté — un bot prend la main`, 'warn');
      this.afterChange();
    }
  }

  addBot() {
    if (this.players.length >= maxPlayers(this.settings)) return;
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.map((n) => 'Robo-' + n).find((n) => !used.has(n)) || 'Robo ' + this.players.length;
    this.players.push({ id: this.newId(), name, isHost: false, isBot: true, peerId: null });
    this.syncLobby();
  }

  fillBots() {
    const cap = maxPlayers(this.settings);
    while (this.players.length < cap) {
      const before = this.players.length;
      this.addBot();
      if (this.players.length === before) break;
    }
  }

  /** Mélange l'ordre des joueurs : les sièges déterminent les groupes. */
  shuffleGroups() {
    const host = this.players.filter((p) => p.isHost);
    const rest = this.players.filter((p) => !p.isHost);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.players = [...host, ...rest];
    this.syncLobby();
  }

  kick(id) {
    const p = this.players.find((x) => x.id === id);
    if (!p || p.isHost) return;
    if (p.peerId) this.net.kick(p.peerId);
    this.players = this.players.filter((x) => x.id !== id);
    this.syncLobby();
  }

  move(id) {
    const i = this.players.findIndex((x) => x.id === id);
    if (i < 0) return;
    const j = (i + 1) % this.players.length;
    [this.players[i], this.players[j]] = [this.players[j], this.players[i]];
    this.syncLobby();
  }

  setSetting(key, value) {
    this.settings[key] = value;
    if ((key === 'mode' || key === 'tables')) {
      // le nombre de places change : on renvoie les joueurs en trop
      const cap = maxPlayers(this.settings);
      while (this.players.length > cap) {
        const last = this.players[this.players.length - 1];
        if (last.peerId) this.net.kick(last.peerId);
        this.players.pop();
      }
    }
    if (false) {
      // on repasse à quatre places : les surnuméraires quittent la room
      while (this.players.length > 4) {
        const last = this.players[this.players.length - 1];
        if (last.peerId) this.net.kick(last.peerId);
        this.players.pop();
      }
    }
    this.syncLobby();
  }

  lobbyPayload() {
    return {
      code: this.code,
      settings: this.settings,
      maxPlayers: maxPlayers(this.settings),
      players: this.players.map((p) => ({ id: p.id, name: p.name, isHost: p.isHost, isBot: p.isBot })),
    };
  }

  /** Les joueurs assis à la table : en party, l'hôte en est exclu. */
  roster() {
    return this.settings.mode === 'party'
      ? this.players.filter((p) => !p.isHost)
      : this.players;
  }

  syncLobby() {
    const payload = this.lobbyPayload();
    for (const p of this.players) {
      if (p.peerId) this.net.send(p.peerId, { t: 'lobby', ...payload, you: p.id });
    }
    renderLobbyLocal(payload, true);
  }

  start() {
    const seats = this.roster().map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, connected: true }));
    if (this.settings.mode === 'party') {
      this.tour = new Tournament(seats, this.settings);
      this.tour.shuffleSeats();
      this.tour.start();
      this.game = null;
      this.tableAt.clear();
    } else {
      this.tour = null;
      this.game = new UnoGame(seats, this.settings);
      this.game.startRound();
    }
    this.unoSince.clear();
    ui.resetGameView();
    this.broadcastStart();
    this.afterChange();
    if (!this.pump) this.pump = setInterval(() => this.tick(), 320);
  }

  broadcastStart() {
    for (const p of this.players) if (p.peerId) this.net.send(p.peerId, { t: 'started' });
    audio.playMusic('game');
    audio.sfx('shuffle');
    ui.showScreen('game');
    $('hud-code').textContent = 'Room ' + this.code;
  }

  nextRound() {
    if (this.tour) return;         // le tournoi enchaîne tout seul
    if (!this.game) return;
    this.game.startRound();
    this.unoSince.clear();
    this.jumpTried.clear();
    audio.playMusic('game');
    audio.sfx('shuffle');
    ui.resetGameView();
    for (const p of this.players) if (p.peerId) this.net.send(p.peerId, { t: 'newRound' });
    ui.hideRoundEnd();
    this.afterChange();
  }

  rematch() {
    if (this.tour) {
      this.tour.shuffleSeats();
      this.tour.start();
      this.tableAt.clear();
      this.unoSince.clear();
      audio.playMusic('game');
      ui.resetGameView();
      for (const p of this.players) if (p.peerId) this.net.send(p.peerId, { t: 'newRound' });
      ui.hideGameOver();
      ui.hideRoundEnd();
      this.afterChange();
      return;
    }
    if (!this.game) return;
    for (const p of this.game.players) p.score = 0;
    this.game.roundNo = 0;
    this.game.gameResult = null;
    this.game.startRound();
    this.unoSince.clear();
    ui.resetGameView();
    for (const p of this.players) if (p.peerId) this.net.send(p.peerId, { t: 'newRound' });
    ui.hideGameOver();
    ui.hideRoundEnd();
    this.afterChange();
  }

  afterChange() {
    if (this.tour) return this.afterTournamentChange();
    const g = this.game;
    if (!g) return;
    // horodatage des oublis de UNO (délai de grâce avant dénonciation par les bots)
    for (const p of g.players) {
      if (p.mustCallUno && !this.unoSince.has(p.id)) this.unoSince.set(p.id, Date.now());
      if (!p.mustCallUno) this.unoSince.delete(p.id);
    }
    if (g.discard && g.discard.length !== this.jumpToken) {
      this.jumpToken = g.discard.length;
      this.jumpTried.clear();
    }
    for (const p of this.players) {
      if (p.peerId) this.net.send(p.peerId, { t: 'state', state: g.stateFor(p.id) });
    }
    applyState(g.stateFor(HOST_ID));
  }

  afterTournamentChange() {
    const T = this.tour;
    for (const g of T.games()) {
      for (const p of g.players) {
        if (p.mustCallUno && !this.unoSince.has(p.id)) this.unoSince.set(p.id, Date.now());
        if (!p.mustCallUno) this.unoSince.delete(p.id);
      }
    }
    for (const p of this.players) {
      if (p.peerId) this.net.send(p.peerId, { t: 'state', state: T.stateFor(p.id) });
    }
    applyState(T.stateFor(HOST_ID));
  }

  /** Boucle IA du tournoi : chaque table avance à son rythme. */
  tickTournament() {
    const T = this.tour;
    if (!T || T.phase === 'done') return;
    const now = Date.now();
    const level = this.settings.botLevel;
    const grace = { easy: 3200, normal: 2000, hard: 1300 }[level] ?? 2000;
    const pace = 0.5;
    let changed = false;

    for (const g of T.games()) {
      if (g.phase !== 'playing') continue;
      let acted = false;

      for (const b of g.players) {
        if (!b.isBot) continue;
        const cible = g.players.find((p) => p.mustCallUno && p.id !== b.id);
        if (!cible) continue;
        if (now - (this.unoSince.get(cible.id) || now) < grace) continue;
        const act = botCallout(g, b);
        if (act) { T.handle(b.id, act); acted = changed = true; break; }
      }
      if (acted) continue;

      if (g.settings.jumpIn) {
        for (const b of g.players) {
          if (!b.isBot || b.id === g.current.id) continue;
          const key = b.id + ':' + g.discard.length;
          if (this.jumpTried.has(key)) continue;
          this.jumpTried.add(key);
          const act = botJumpIn(g, b);
          if (act) { T.handle(b.id, act); acted = changed = true; break; }
        }
      }
      if (acted) continue;

      const cur = g.current;
      const st = this.tableAt.get(g);
      if (!st || st.id !== cur.id) {
        this.tableAt.set(g, { id: cur.id, at: now + botDelay(level) * pace });
        continue;
      }
      if (!cur.isBot || now < st.at) continue;
      let r = T.handle(cur.id, botDecide(g, cur));
      if (!r.ok) r = T.handle(cur.id, { type: 'draw' });
      if (!r.ok) T.handle(cur.id, { type: 'pass' });
      this.tableAt.set(g, { id: cur.id, at: now + botDelay(level) * pace });
      changed = true;
    }
    if (this.jumpTried.size > 400) this.jumpTried.clear();
    if (changed) this.afterTournamentChange();
  }

  /** Boucle IA. */
  tick() {
    if (this.tour) return this.tickTournament();
    const g = this.game;
    if (!g || g.phase !== 'playing') return;
    const now = Date.now();
    const prof = botProfile(g.settings.botLevel);
    const grace = { easy: 3600, normal: 2400, hard: 1500 }[g.settings.botLevel] ?? 2400;

    // dénonciations d'oubli de UNO
    for (const b of g.players) {
      if (!b.isBot) continue;
      const target = g.players.find((p) => p.mustCallUno && p.id !== b.id && !g.areAllies(b, p));
      if (!target) continue;
      const since = this.unoSince.get(target.id) || now;
      if (now - since < grace) continue;
      const act = botCallout(g, b);
      if (act) { g.handle(b.id, act); this.afterChange(); return; }
    }

    // poses à la volée (une tentative par carte posée et par bot)
    if (g.settings.jumpIn) {
      for (const b of g.players) {
        if (!b.isBot || b.id === g.current.id) continue;
        const key = b.id + ':' + this.jumpToken;
        if (this.jumpTried.has(key)) continue;
        this.jumpTried.add(key);
        const act = botJumpIn(g, b);
        if (act) { g.handle(b.id, act); this.afterChange(); return; }
      }
    }

    // tour du bot courant
    const cur = g.current;
    if (cur.id !== this.lastTurnId) {
      this.lastTurnId = cur.id;
      this.actAt = now + botDelay(g.settings.botLevel) * this.paceFactor();
      return;
    }
    if (!cur.isBot || now < this.actAt) return;

    const action = botDecide(g, cur);
    let res = g.handle(cur.id, action);
    if (!res.ok) res = g.handle(cur.id, { type: 'draw' });   // filet de sécurité
    if (!res.ok) g.handle(cur.id, { type: 'pass' });
    this.actAt = now + botDelay(g.settings.botLevel) * this.paceFactor();
    this.afterChange();
  }

  /** Une grande tablée doit tourner plus vite pour rester regardable. */
  paceFactor() {
    const n = this.game ? this.game.players.length : 4;
    return n >= 20 ? 0.42 : (n >= 10 ? 0.6 : 1);
  }

  localAction(action) {
    if (this.tour) return;                                 // hôte spectateur du tournoi
    if (!this.game || !this.game.byId(HOST_ID)) return;   // hôte spectateur
    const res = this.game.handle(HOST_ID, action);
    if (!res.ok) { ui.toast(res.error, 'bad'); audio.sfx('error'); }
    this.afterChange();
  }

  destroy() {
    if (this.pump) clearInterval(this.pump);
    this.net.close();
  }
}

/* ═══════════════════════════ CLIENT ═══════════════════════════ */
class Guest {
  constructor(name) {
    this.net = new ClientNet();
    this.name = name;
  }

  async join(code) {
    await this.net.connect(code);
    this.code = code;
    this.net.on('message', (msg) => this.onMessage(msg));
    this.net.on('close', () => {
      ui.setWaiting(null);
      ui.toast('Connexion à l\'hôte perdue.', 'bad');
      setTimeout(() => location.reload(), 2200);
    });
    this.net.send({ t: 'hello', name: this.name });
  }

  onMessage(msg) {
    switch (msg.t) {
      case 'lobby':
        App.myId = msg.you;
        renderLobbyLocal(msg, false);
        ui.showScreen('lobby');
        ui.setWaiting(null);
        break;
      case 'started':
        audio.playMusic('game');
        audio.sfx('shuffle');
        ui.resetGameView();
        ui.showScreen('game');
        $('hud-code').textContent = 'Room ' + this.code;
        break;
      case 'newRound':
        audio.playMusic('game');
        audio.sfx('shuffle');
        ui.resetGameView();
        ui.hideRoundEnd();
        ui.hideGameOver();
        break;
      case 'state':
        applyState(msg.state);
        break;
      case 'error':
        ui.toast(msg.msg, 'bad');
        audio.sfx('error');
        ui.setWaiting(null);
        if (msg.fatal) setTimeout(() => location.reload(), 2400);
        break;
      case 'kicked':
        ui.toast('Vous avez été retiré de la partie.', 'bad');
        setTimeout(() => location.reload(), 1800);
        break;
    }
  }

  action(a) { this.net.send({ t: 'action', action: a }); }
  destroy() { this.net.close(); }
}

/* ═══════════════════════════ vue commune ═══════════════════════════ */
function sanitizeName(raw, taken = []) {
  let n = String(raw || '').trim().slice(0, 14).replace(/[<>]/g, '');
  if (!n) n = 'Joueur';
  let base = n, i = 2;
  while (taken.includes(n)) n = `${base} ${i++}`;
  return n;
}

function renderLobbyLocal(payload, isHost) {
  ui.setRole(isHost);
  ui.renderLobby({ ...payload, isHost, maxPlayers: payload.maxPlayers || 4 }, {
    onKick: (id) => App.host && App.host.kick(id),
    onMove: (id) => App.host && App.host.move(id),
  });
}

const TOASTABLE = {
  uno: 'big', callout: 'warn', penalty: 'warn', swap: '', rotate: '',
  jump: '', challenge: 'warn', win: 'big', gameover: 'big', effect: '',
};

// un bruitage par type d'évènement du journal
const EVENT_SFX = {
  play: 'play', draw: 'draw', penalty: 'penalty', callout: 'penalty',
  uno: 'uno', swap: 'swap', rotate: 'rotate', jump: 'jump',
  challenge: 'penalty', round: 'shuffle', win: 'win',
};

function applyState(s) {
  const prev = App.view;
  App.view = s;
  App.myId = s.you;

  // notifications et bruitages sur les nouveaux évènements
  let delay = 0;
  for (const e of s.log) {
    if (e.t <= App.lastLogAt) continue;
    if (e.type in TOASTABLE && ['uno', 'callout', 'penalty', 'swap', 'rotate', 'jump', 'challenge', 'win'].includes(e.type)) {
      ui.toast(e.text, TOASTABLE[e.type]);
    }
    if (EVENT_SFX[e.type]) { audio.sfx(EVENT_SFX[e.type], delay); delay += 0.06; }
  }
  if (prev && prev.turnId !== s.turnId && s.turnId === s.you && s.phase === 'playing') audio.sfx('turn');
  App.lastLogAt = s.log.length ? s.log[s.log.length - 1].t : App.lastLogAt;

  // l'arbre s'ouvre tout seul quand le tournoi change d'étape
  const ph = s.tournament ? s.tournament.phase : null;
  if (ph && ph !== App.tourPhase) {
    const premier = App.tourPhase === undefined;
    App.tourPhase = ph;
    if (!premier || ph === 'qualif') {
      ui.showBracket(s);
      clearTimeout(App.brTimer);
      App.brTimer = setTimeout(() => ui.hideBracket(), ph === 'done' ? 7000 : 4500);
    }
  }
  if (!s.tournament) App.tourPhase = undefined;

  if (!prev || prev.roundNo !== s.roundNo) App.armedUno = false;
  if (s.hand.length !== 2) App.armedUno = false;

  ui.renderGame(s, {
    onCardClick: onCardClick,
    onCallout: (id) => send({ type: 'callout', targetId: id }),
  });
  $('btn-uno').classList.toggle('armed', App.armedUno);

  if (s.phase === 'gameEnd') {
    ui.showGameOver(s);
    if (!prev || prev.phase !== 'gameEnd') {
      const me = s.players.find((p) => p.id === s.you);
      const g = s.gameResult;
      const iWon = g && (g.type === 'team' ? me && me.team === g.team : g.playerId === s.you);
      audio.stopMusic();
      audio.sfx(iWon ? 'win' : 'lose');
      if (iWon) ui.confetti(110);
      setTimeout(() => audio.playMusic('menu'), 3200);
    }
  } else if (s.phase === 'roundEnd') {
    ui.showRoundEnd(s);
  } else {
    ui.hideRoundEnd();
  }
}

function send(action) {
  if (App.role === 'host') App.host.localAction(action);
  else if (App.client) App.client.action(action);
}

async function onCardClick(card) {
  const s = App.view;
  if (!s || App.busy) return;
  if (!s.legal.includes(card.id)) {
    if (s.turnId === s.you && s.phase === 'playing') { ui.toast('Cette carte n\'est pas jouable.', 'warn'); audio.sfx('error'); }
    return;
  }
  App.busy = true;
  try {
    const action = { type: 'play', cardId: card.id };
    if (isWild(card)) {
      const color = await ui.pickColor();
      if (!color) return;
      audio.sfx('color');
      action.color = color;
    }
    if (s.settings.sevenZero && card.value === '7' && s.players.length > 1) {
      const target = await ui.pickTarget(s);
      if (!target) return;
      action.targetId = target;
    }
    if (s.hand.length === 2 && (App.armedUno || !s.settings.unoRule)) action.uno = true;
    send(action);
    App.armedUno = false;
  } finally {
    App.busy = false;
  }
}

/* ═══════════════════════════ câblage DOM ═══════════════════════════ */
function wireHome() {
  const nameInput = $('input-name');
  nameInput.value = localStorage.getItem('webno.name') || '';
  const codeInput = $('input-code');
  codeInput.addEventListener('input', () => { codeInput.value = normalizeCode(codeInput.value); });

  const err = (m) => { const e = $('home-error'); e.textContent = m; e.hidden = !m; };
  const getName = () => {
    const n = sanitizeName(nameInput.value);
    localStorage.setItem('webno.name', n);
    return n;
  };

  $('btn-create').onclick = async () => {
    err('');
    const name = getName();
    App.role = 'host'; App.name = name; App.myId = HOST_ID;
    ui.setWaiting('Ouverture de la room…');
    try {
      App.host = new Host(name);
      const code = await App.host.open();
      ui.setWaiting(null);
      ui.setRole(true);
      ui.showScreen('lobby');
      App.host.syncLobby();
      $('hud-code').textContent = 'Room ' + code;
    } catch (e) {
      ui.setWaiting(null);
      App.role = null;
      err('Impossible d\'ouvrir la room : ' + (e && e.message ? e.message : 'réseau indisponible.'));
    }
  };

  $('btn-join').onclick = async () => {
    err('');
    const code = normalizeCode(codeInput.value);
    if (code.length < 5) { err('Entrez le code à 5 caractères fourni par l\'hôte.'); return; }
    const name = getName();
    App.role = 'guest'; App.name = name;
    ui.setWaiting('Connexion à la room ' + code + '…');
    try {
      App.client = new Guest(name);
      await App.client.join(code);
      ui.setRole(false);
    } catch (e) {
      ui.setWaiting(null);
      App.role = null; App.client = null;
      err(e && e.message ? e.message : 'Connexion impossible.');
    }
  };

  document.body.classList.toggle('can-scan', canScan());
  $('btn-scan').onclick = () => openScanner();
  $('overlay-scan').querySelector('[data-cancel]').onclick = () => stopScanner();

  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-create').click(); });
}

function wireLobby() {
  $('qr-box').onclick = () => {
    const code = $('code-value').textContent;
    if (!code || code === '-----') return;
    $('qr-big-code').textContent = code;
    $('qr-big').innerHTML = $('qr-box').innerHTML;
    $('overlay-qr').hidden = false;
  };
  $('overlay-qr').querySelector('[data-cancel]').onclick = () => { $('overlay-qr').hidden = true; };

  $('btn-copy').onclick = async () => {
    const code = $('code-value').textContent;
    const link = ui.joinUrl(code);
    try { await navigator.clipboard.writeText(link); ui.toast('Lien d\'invitation copié !'); }
    catch (_) { ui.toast('Code de la room : ' + code); }
  };
  $('btn-add-bot').onclick = () => App.host && App.host.addBot();
  $('btn-fill-bots').onclick = () => App.host && App.host.fillBots();
  $('btn-shuffle-groups').onclick = () => App.host && App.host.shuffleGroups();
  $('btn-start').onclick = () => App.host && App.host.start();
  $('btn-lobby-leave').onclick = () => leave();

  for (const seg of document.querySelectorAll('.seg[data-setting]')) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !App.host) return;
      const key = seg.dataset.setting;
      let val = b.dataset.value;
      if (key === 'targetScore' || key === 'tables') val = Number(val);
      App.host.setSetting(key, val);
    });
  }
  for (const sw of document.querySelectorAll('.switch[data-setting]')) {
    sw.querySelector('input').addEventListener('change', (e) => {
      if (!App.host) { e.target.checked = !e.target.checked; return; }
      App.host.setSetting(sw.dataset.setting, e.target.checked);
    });
  }
}

function wireSound() {
  const btn = $('btn-sound'), panel = $('sound-panel');
  const vm = $('vol-music'), vs = $('vol-sfx'), mute = $('btn-mute');
  const v = audio.volumes();
  vm.value = Math.round(v.music * 100);
  vs.value = Math.round(v.sfx * 100);

  const refresh = () => {
    const cur = audio.volumes();
    document.body.classList.toggle('muted', cur.music === 0 && cur.sfx === 0);
    mute.textContent = (cur.music === 0 && cur.sfx === 0) ? 'Rétablir le son' : 'Couper le son';
  };
  refresh();

  btn.onclick = (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; };
  vm.oninput = () => { audio.setMusicVolume(vm.value / 100); refresh(); };
  vs.oninput = () => { audio.setSfxVolume(vs.value / 100); refresh(); };
  vs.onchange = () => audio.sfx('click');
  mute.onclick = () => {
    const cur = audio.volumes();
    if (cur.music === 0 && cur.sfx === 0) {
      audio.setMusicVolume(0.45); audio.setSfxVolume(0.7);
    } else {
      App.lastVol = cur;
      audio.setMusicVolume(0); audio.setSfxVolume(0);
    }
    const nv = audio.volumes();
    vm.value = Math.round(nv.music * 100);
    vs.value = Math.round(nv.sfx * 100);
    refresh();
  };
  document.addEventListener('click', (e) => {
    if (!panel.hidden && !e.target.closest('.sound-dock')) panel.hidden = true;
  });

  // le son ne peut démarrer qu'après une interaction : on saisit la première
  const start = () => {
    audio.unlock();
    if (!$('screen-game').classList.contains('active')) audio.playMusic('menu');
    document.removeEventListener('pointerdown', start);
    document.removeEventListener('keydown', start);
  };
  document.addEventListener('pointerdown', start);
  document.addEventListener('keydown', start);

  // clic générique sur les boutons (hors sélecteur de couleur, qui a son son)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && !b.closest('#overlay-color') && !b.disabled) audio.sfx('click');
  }, true);
}

function wireGame() {
  $('btn-draw').onclick = () => send({ type: 'draw' });
  $('deck-pile').onclick = () => {
    const s = App.view;
    if (s && s.turnId === s.you && (s.canDraw || s.pendingDraw > 0)) send({ type: 'draw' });
  };
  $('btn-pass').onclick = () => send({ type: 'pass' });
  $('btn-challenge').onclick = () => send({ type: 'challenge' });
  $('btn-uno').onclick = () => {
    const s = App.view;
    if (!s) return;
    if (s.canUno) send({ type: 'uno' });
    else if (s.hand.length === 2) {
      App.armedUno = !App.armedUno;
      $('btn-uno').classList.toggle('armed', App.armedUno);
      ui.toast(App.armedUno ? 'UNO armé : votre prochaine pose annoncera UNO.' : 'UNO désarmé.');
    }
  };
  $('btn-quit').onclick = () => leave();
  $('btn-next-round').onclick = () => App.host && App.host.nextRound();
  $('btn-rematch').onclick = () => App.host && App.host.rematch();
  $('btn-home').onclick = () => leave();

  $('btn-bracket').onclick = () => { ui.bracketVisible() ? ui.hideBracket() : ui.showBracket(App.view); };
  $('overlay-bracket').querySelector('[data-cancel]').onclick = () => ui.hideBracket();
  $('btn-help').onclick = () => { $('overlay-help').hidden = !$('overlay-help').hidden; };
  $('overlay-help').querySelector('[data-cancel]').onclick = () => { $('overlay-help').hidden = true; };
  wireKeyboard();
}

/* ── clavier ─────────────────────────────────────────────────────── */
/* ── lecture d'un QR code par la caméra ────────────────────────────── */
// Un ordinateur de bureau sait souvent lire les codes-barres, mais on ne
// braque pas un écran devant sa webcam : le bouton n'a de sens qu'au doigt.
const isHandheld = () => window.matchMedia
  && (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(hover: none)').matches);
const canScan = () => typeof window.BarcodeDetector === 'function'
  && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  && isHandheld();

let scanStream = null, scanTimer = null;

function stopScanner() {
  clearTimeout(scanTimer);
  scanTimer = null;
  if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
  const v = $('scan-video');
  if (v) v.srcObject = null;
  $('overlay-scan').hidden = true;
}

async function openScanner() {
  const ov = $('overlay-scan'), video = $('scan-video'), note = $('scan-note');
  note.textContent = "Visez le QR affiché sur l'écran de l'hôte.";
  ov.hidden = false;
  if (!canScan()) {
    note.textContent = "Ce navigateur ne lit pas les QR codes. Utilisez l'appareil photo de votre "
      + "téléphone : il ouvrira le lien de la partie directement.";
    return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }, audio: false,
    });
    video.srcObject = scanStream;
    await video.play();
  } catch (_) {
    note.textContent = "Accès à la caméra refusé. Saisissez le code à la main, il fonctionne aussi.";
    return;
  }
  const det = new window.BarcodeDetector({ formats: ['qr_code'] });
  const loop = async () => {
    if (ov.hidden) return;
    try {
      const found = await det.detect(video);
      for (const b of found) {
        const code = codeFromScan(b.rawValue);
        if (code) { onScanned(code); return; }
      }
      if (found.length) note.textContent = "Ce QR ne mène pas à une partie WebNo.";
    } catch (_) { /* image non exploitable, on réessaie */ }
    scanTimer = setTimeout(loop, 220);
  };
  loop();
}

function onScanned(code) {
  stopScanner();
  audio.sfx('join');
  $('input-code').value = code;
  if ($('input-name').value.trim()) {
    $('btn-join').click();
  } else {
    ui.toast(`Room ${code} trouvée — entrez votre pseudo`);
    $('input-name').focus();
  }
}

function moveSelection(dir) {
  const s = App.view;
  if (!s || !s.hand.length) return;
  const ids = s.hand.map((c) => c.id);
  const i = ids.indexOf(ui.getSelection());
  const next = i < 0 ? (dir > 0 ? 0 : ids.length - 1) : (i + dir + ids.length) % ids.length;
  ui.setSelection(ids[next]);
  audio.sfx('click');
}

function playSelected() {
  const s = App.view;
  const id = ui.getSelection();
  if (!s || !id) { ui.toast('Choisissez une carte avec ← et →.'); return; }
  const card = s.hand.find((c) => c.id === id);
  if (card) onCardClick(card);
}

function clickIn(overlayId, selector, index) {
  const list = $(overlayId).querySelectorAll(selector);
  if (list[index]) { list[index].click(); return true; }
  return false;
}

function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea')) return;
    const k = e.key;

    if (k === '?' || k === 'h' || k === 'H') {
      $('overlay-help').hidden = !$('overlay-help').hidden;
      e.preventDefault(); return;
    }
    if (k === 'Escape') {
      for (const id of ['overlay-help', 'overlay-bracket', 'overlay-scan', 'overlay-qr', 'overlay-color', 'overlay-target']) {
        const ov = $(id);
        if (!ov.hidden) { const c = ov.querySelector('[data-cancel]'); if (c) c.click(); e.preventDefault(); return; }
      }
      if (!$('sound-panel').hidden) $('sound-panel').hidden = true;
      return;
    }
    if (k === 'm' || k === 'M') { $('btn-mute').click(); return; }

    // un sélecteur ouvert capte les chiffres
    if (!$('overlay-color').hidden) {
      if ('1234'.includes(k)) { clickIn('overlay-color', '.col', Number(k) - 1); e.preventDefault(); }
      return;
    }
    if (!$('overlay-target').hidden) {
      if ('123'.includes(k)) { clickIn('overlay-target', '#target-picker button', Number(k) - 1); e.preventDefault(); }
      return;
    }
    if (!$('overlay-round').hidden) {
      if (k === 'Enter' && App.role === 'host' && !$('btn-next-round').disabled) $('btn-next-round').click();
      return;
    }
    if (!$('overlay-help').hidden || !$('screen-game').classList.contains('active') || !App.view) return;

    const press = (id) => { const b = $(id); if (b && !b.disabled && !b.hidden) b.click(); };
    switch (k) {
      case 'ArrowLeft':  moveSelection(-1); e.preventDefault(); break;
      case 'ArrowRight': moveSelection(1);  e.preventDefault(); break;
      case 'Enter':      playSelected();    e.preventDefault(); break;
      case ' ':          press('btn-draw'); e.preventDefault(); break;
      case 'd': case 'D': press('btn-draw'); break;
      case 'p': case 'P': press('btn-pass'); break;
      case 'u': case 'U': press('btn-uno'); break;
      case 'b': case 'B':
        if (App.view && App.view.tournament) {
          ui.bracketVisible() ? ui.hideBracket() : ui.showBracket(App.view);
        }
        break;
      case 'c': case 'C': {
        const t = App.view.calloutTargets;
        if (t && t.length) send({ type: 'callout', targetId: t[0] });
        break;
      }
    }
  });
}

function leave() {
  if (!confirmLeave()) return;
  App.leaving = true;                    // désarme le garde-fou de fermeture
  try { if (App.host) App.host.destroy(); } catch (_) {}
  try { if (App.client) App.client.destroy(); } catch (_) {}
  App.role = null;
  App.view = null;
  audio.stopMusic();
  // on repart sur une adresse propre, sans l'ancre de la room quittée
  location.replace(location.origin + location.pathname);
}

function confirmLeave() {
  if (App.role === null) return true;
  return window.confirm(App.view ? 'Quitter la partie en cours ?' : 'Quitter le salon ?');
}

export { Host, Guest, App };   // exposés pour les tests

/* ═══════════════════════════ démarrage ═══════════════════════════ */
function boot() {
  if (!window.Peer) {
    const e = $('home-error');
    e.textContent = 'La bibliothèque réseau (PeerJS) n\'a pas pu être chargée. Vérifiez votre connexion.';
    e.hidden = false;
  }
  wireHome();
  wireLobby();
  wireGame();
  wireSound();
  ui.showScreen('home');

  window.__webno = App;   // point d'accès pour le débogage / les tests
  window.__apply = applyState;
  window.__ui = ui;

  // rejoindre directement via #CODE
  // arrivée par un lien d'invitation ou un QR scanné avec l'appareil photo
  const hash = normalizeCode(location.hash.replace('#', ''));
  if (hash.length === 5) {
    $('input-code').value = hash;
    setTimeout(() => {
      ui.toast(`Room ${hash} — entrez votre pseudo pour rejoindre`);
      $('input-name').focus();
    }, 300);
  }
}

// les modules sont différés : le DOM est prêt, mais on couvre le cas contraire
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();

// Avertit d'une fermeture accidentelle, mais jamais quand on quitte exprès :
// sinon l'utilisateur enchaîne deux boîtes de dialogue et croit être bloqué.
window.addEventListener('beforeunload', (e) => {
  if (!App.leaving && App.role && App.view) { e.preventDefault(); e.returnValue = ''; }
});
