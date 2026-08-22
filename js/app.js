// app.js — orchestration : accueil, salon, boucle hôte (moteur + IA), client
import { UnoGame, DEFAULT_SETTINGS } from './engine.js?v=202608220315';
import { botDecide, botJumpIn, botCallout, botDelay, botProfile } from './bot.js?v=202608220315';
import { HostNet, ClientNet, normalizeCode, codeFromScan } from './net.js?v=202608220315';
import { isWild } from './deck.js?v=202608220315';
import * as ui from './ui.js?v=202608220315';
import * as audio from './audio.js?v=202608220315';

const $ = (id) => document.getElementById(id);
const BOT_NAMES = ['Léa', 'Max', 'Zoé', 'Nino', 'Iris', 'Sacha', 'Milo', 'Nora', 'Tao', 'Lila',
  'Enzo', 'Jade', 'Otis', 'Rêva', 'Kais', 'Anouk', 'Basile', 'Cléo', 'Diego', 'Elsa',
  'Fabio', 'Gaia', 'Hugo', 'Inès'];

/** Places disponibles : en party l'hôte observe, il occupe une place en plus. */
function maxPlayers(settings) {
  if (settings.mode === 'party') return (settings.partySize || 12) + 1;  // l'hôte est l'écran
  return settings.mode === 'team' ? (settings.teamSize || 2) * 2 : 4;
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
    this.unoSince = new Map();
    this.turnEnd = 0;          // échéance du tour en cours (party)
    this.turnFor = null;       // à qui appartient ce tour
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
      if (this.game) { this.rejoin(peerId, msg.name); return; }
      if (this.players.length >= maxPlayers(this.settings)) { this.net.send(peerId, { t: 'error', msg: 'La room est complète.', fatal: true }); return; }
      if (this.settings.mode === 'party' && msg.handheld === false) {
        this.net.send(peerId, {
          t: 'error', fatal: true,
          msg: 'Le mode party se joue au téléphone : votre appareil sert de manette, '
            + 'et le plateau reste sur l\'écran de l\'hôte.',
        });
        return;
      }
      const name = sanitizeName(msg.name, this.players.map((p) => p.name));
      this.players.push({ id: this.newId(), name, isHost: false, isBot: false, peerId });
      audio.sfx('join');
      ui.toast(`${name} rejoint la partie`);
      this.syncLobby();
      return;
    }
    const player = this.byPeer(peerId);
    if (!player) return;
    if (msg.t === 'action' && this.game) {
      const res = this.game.handle(player.id, msg.action);
      if (!res.ok) this.net.send(peerId, { t: 'error', msg: res.error });
      this.afterChange();
    }
    if (msg.t === 'nextRound') { /* réservé à l'hôte */ }
  }

  /**
   * Reprise d'une place en cours de partie. On rend d'abord au revenant le
   * siège qu'il vient de quitter, reconnu à son pseudo ; sinon on lui confie
   * un bot au hasard. Si toutes les places sont tenues, la partie est fermée.
   */
  rejoin(peerId, rawName) {
    const voulu = String(rawName || '').trim().slice(0, 14);
    const libres = this.players.filter((p) => !p.isHost && !p.peerId);
    if (!libres.length) {
      this.net.send(peerId, {
        t: 'error', fatal: true,
        msg: 'La partie a commencé et toutes les places sont tenues par des joueurs.',
      });
      return;
    }
    const sien = libres.find((p) => p.name.toLowerCase() === voulu.toLowerCase());
    const place = sien || libres[Math.floor(Math.random() * libres.length)];
    const ancien = place.name;

    place.peerId = peerId;
    place.isBot = false;
    if (!sien && voulu) {
      place.name = sanitizeName(voulu, this.players.filter((p) => p !== place).map((p) => p.name));
    }

    const gp = this.game.byId(place.id);
    if (gp) {
      gp.connected = true;
      gp.isBot = false;
      gp.name = place.name;
      this.game.say('join', sien
        ? `${place.name} est de retour et reprend sa main.`
        : `${place.name} prend la place de ${ancien}.`, { playerId: place.id });
      this.game.version++;
    }

    audio.sfx('join');
    ui.toast(sien ? `${place.name} est de retour` : `${place.name} remplace ${ancien}`);
    this.net.send(peerId, { t: 'started' });
    this.afterChange();
  }

  onClose(peerId) {
    const p = this.byPeer(peerId);
    if (!p) return;
    p.peerId = null;
    if (!this.game) {
      this.players = this.players.filter((x) => x.id !== p.id);
      ui.toast(`${p.name} a quitté le salon`, 'warn');
      this.syncLobby();
    } else {
      const gp = this.game ? this.game.byId(p.id) : null;
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

  /** Les joueurs assis à la table : en party, l'hôte n'est que l'écran. */
  roster() {
    return this.settings.mode === 'party' ? this.players.filter((p) => !p.isHost) : this.players;
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
    this.game = new UnoGame(seats, this.settings);
    this.game.startRound();
    this.unoSince.clear();
    ui.resetGameView();
    this.broadcastStart();
    this.afterChange();
    if (!this.pump) this.pump = setInterval(() => this.tick(), 320);
  }

  broadcastStart() {
    for (const p of this.players) if (p.peerId) this.net.send(p.peerId, { t: 'started' });
    if (this.settings.mode === 'party') pleinEcran();
    audio.playMusic('game');
    audio.sfx('shuffle');
    ui.showScreen('game');
    $('hud-code').textContent = 'Room ' + this.code;
  }

  nextRound() {
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
    if (false) {
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

  /** Durée de réflexion accordée, en millisecondes (0 = pas de limite). */
  turnLimit() {
    const s = this.settings;
    return s.mode === 'party' ? Math.max(0, (s.turnSeconds ?? 15) * 1000) : 0;
  }

  /** Relance le chronomètre quand la main change de joueur. */
  syncTurnClock() {
    const g = this.game;
    const limite = this.turnLimit();
    if (!g || g.phase !== 'playing' || !limite) { this.turnEnd = 0; this.turnFor = null; return; }
    const cur = g.current;
    if (!cur || this.turnFor === cur.id) return;
    this.turnFor = cur.id;
    this.turnEnd = Date.now() + limite;
  }

  /** Le temps écoulé fait piocher d'office : la partie ne s'enlise pas. */
  checkTurnClock() {
    const g = this.game;
    if (!g || g.phase !== 'playing' || !this.turnEnd) return;
    if (Date.now() < this.turnEnd) return;
    const cur = g.current;
    this.turnEnd = 0;
    g.handle(cur.id, { type: 'draw' });
    // piocher une carte jouable laisse la main : le temps écoulé, on passe
    // quand même, sans quoi le tour resterait bloqué sur un joueur absent
    if (g.phase === 'playing' && g.current.id === cur.id) {
      g.handle(cur.id, { type: 'pass' });
    }
    g.say('timeout', `${cur.name} a laissé filer le temps : il pioche et passe.`, { playerId: cur.id });
    this.afterChange();
  }

  afterChange() {
    const g = this.game;
    if (!g) return;
    this.syncTurnClock();
    // horodatage des oublis de UNO (délai de grâce avant dénonciation par les bots)
    for (const p of g.players) {
      if (p.mustCallUno && !this.unoSince.has(p.id)) this.unoSince.set(p.id, Date.now());
      if (!p.mustCallUno) this.unoSince.delete(p.id);
    }
    if (g.discard && g.discard.length !== this.jumpToken) {
      this.jumpToken = g.discard.length;
      this.jumpTried.clear();
    }
    // le temps restant part avec l'état : chaque appareil décompte ensuite
    // depuis sa propre horloge, ce qui évite tout écart de pendule
    const reste = this.turnEnd ? Math.max(0, this.turnEnd - Date.now()) : null;
    for (const p of this.players) {
      if (p.peerId) this.net.send(p.peerId, { t: 'state', state: { ...g.stateFor(p.id), turnLeft: reste } });
    }
    applyState({ ...g.stateFor(HOST_ID), turnLeft: reste });
  }

  /** Boucle IA. */
  tick() {
    this.checkTurnClock();
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
    if (!this.game) return;
    if (this.settings.mode === 'party') return;   // l'hôte ne joue pas
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
    this.net.send({ t: 'hello', name: this.name, handheld: isHandheld() });
  }

  onMessage(msg) {
    switch (msg.t) {
      case 'lobby':
        App.myId = msg.you;
        App.lobby = msg;
        App.partyPad = msg.settings && msg.settings.mode === 'party';
        if (App.partyPad) { pleinEcran(); exigeHorizontal(); }
        renderLobbyLocal(msg, false);
        ui.showScreen('lobby');
        ui.setWaiting(null);
        break;
      case 'started':
        if (App.partyPad) pleinEcran();
        audio.playMusic('game');
        audio.sfx('shuffle');
        ui.setWaiting(null);
        ui.setRole(false);
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
  challenge: 'penalty', round: 'shuffle', win: 'win', flip: 'rotate',
  launcher: 'shuffle', out: 'lose', party: 'swap', shield: 'uno', timeout: 'error',
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
  if (prev && prev.side && s.side && prev.side !== s.side) ui.flipAnnounce(s.side);
  App.lastLogAt = s.log.length ? s.log[s.log.length - 1].t : App.lastLogAt;

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

/** Joue une carte party, en demandant sa cible si elle en réclame une. */
async function jouerParty(carte, modele) {
  const s = App.view;
  if (!s) return;
  const action = { type: 'party', cardId: carte.id };
  if (modele.cible) {
    const cible = await ui.pickTarget(s);
    if (!cible) return;
    action.targetId = cible;
  }
  if (modele.id === 'cadeau') {
    const don = await ui.pickGift(s);
    if (!don) return;
    action.giveId = don;
  }
  audio.sfx('swap');
  send(action);
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
      const color = await ui.pickColor(s.side);
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
  const agrandirQr = (source) => {
    const code = $('code-value').textContent;
    if (!code || code === '-----') return;
    $('qr-big-code').textContent = code;
    $('qr-big').innerHTML = $(source).innerHTML;
    $('overlay-qr').hidden = false;
  };
  $('qr-box-party').onclick = () => agrandirQr('qr-box-party');
  $('btn-copy-party').onclick = () => $('btn-copy').click();
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

  $('btn-rules').onclick = () => { $('overlay-rules').hidden = false; };
  $('btn-settings').onclick = () => { $('overlay-settings').hidden = false; };
  $('overlay-settings').querySelector('[data-cancel]').onclick = () => { $('overlay-settings').hidden = true; };
  $('overlay-rules').querySelector('[data-cancel]').onclick = () => { $('overlay-rules').hidden = true; };

  // les quatre réglages du salon suivent le même schéma
  const reglage = (bouton, overlay, ouvrir) => {
    $(bouton).onclick = () => {
      if (!App.host) { ui.toast('Seul l\'hôte règle la partie.'); return; }
      ouvrir(App.host.settings);
    };
    $(overlay).querySelector('[data-cancel]').onclick = () => { $(overlay).hidden = true; };
  };
  reglage('btn-mode', 'overlay-modes', (s) => ui.showModes(s, (m) => {
    App.host.settings.teamSize = m.teamSize || 2;
    App.host.settings.partySize = App.host.settings.partySize || 12;
    App.host.setSetting('mode', m.mode || 'solo');
  }));
  reglage('btn-pack', 'overlay-packs', (s) => ui.showPacks(s, (id) => App.host.setSetting('pack', id)));
  reglage('btn-win', 'overlay-win', (s) => ui.showWins(s, (w) => {
    App.host.settings.targetScore = w.targetScore || App.host.settings.targetScore;
    App.host.setSetting('winCondition', w.winCondition);
  }));
  reglage('btn-bots', 'overlay-bots', (s) => ui.showBots(s, (id) => App.host.setSetting('botLevel', id)));
  $('btn-start').onclick = () => App.host && App.host.start();
  $('btn-lobby-leave').onclick = () => leave();

  for (const seg of document.querySelectorAll('.seg[data-setting]')) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !App.host) return;
      const key = seg.dataset.setting;
      let val = b.dataset.value;
      if (key === 'targetScore' || key === 'teamSize') val = Number(val);
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
  // la manette du mode party : les mêmes actions, ses propres boutons
  $('pad-draw').onclick = () => send({ type: 'draw' });
  $('pad-pass').onclick = () => send({ type: 'pass' });
  $('pad-uno').onclick = () => $('btn-uno').click();
  $('pad-party').onclick = () => {
    if (!App.view) return;
    ui.showPartyHand(App.view, (carte, modele) => jouerParty(carte, modele));
  };
  $('overlay-party').querySelector('[data-cancel]').onclick = () => ui.hidePartyHand();

  $('btn-quit').onclick = () => leave();
  $('btn-next-round').onclick = () => App.host && App.host.nextRound();
  $('btn-rematch').onclick = () => App.host && App.host.rematch();
  $('btn-home').onclick = () => leave();

  $('btn-help').onclick = () => { $('overlay-help').hidden = !$('overlay-help').hidden; };
  $('overlay-help').querySelector('[data-cancel]').onclick = () => { $('overlay-help').hidden = true; };
  wireKeyboard();
}

/* ── clavier ─────────────────────────────────────────────────────── */
/** Le mode party sur téléphone exige le paysage et le plein écran. */
function exigeHorizontal() {
  const dur = App.partyPad && isHandheld();
  const gate = $('rotate-gate');
  if (!gate) return;
  if (!dur) { gate.hidden = true; return; }
  const portrait = window.innerHeight > window.innerWidth;
  const dehors = !(document.fullscreenElement || document.webkitFullscreenElement);
  gate.hidden = !(portrait || dehors);
  if (gate.hidden) return;
  $('rg-title').textContent = portrait ? 'Tournez votre téléphone' : 'Passez en plein écran';
  $('rg-sub').textContent = portrait
    ? 'Le mode party se joue à l\'horizontale : votre téléphone est votre main.'
    : 'Le plein écran laisse toute la place à vos cartes.';
  $('rg-go').hidden = !dehors;
}

/** Passe en plein écran, et demande le paysage sur un téléphone. */
function pleinEcran() {
  const el = document.documentElement;
  const demande = el.requestFullscreen || el.webkitRequestFullscreen;
  if (demande) {
    try {
      const p = demande.call(el);
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* refusé : la partie se joue quand même */ }
  }
  const o = screen.orientation;
  if (o && o.lock && isHandheld()) {
    try {
      const p = o.lock('landscape');
      if (p && p.catch) p.catch(() => {});
    } catch (_) { /* l'appareil n'en veut pas */ }
  }
  setTimeout(exigeHorizontal, 300);
}

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
      for (const id of ['overlay-help', 'overlay-packs', 'overlay-modes', 'overlay-win',
        'overlay-bots', 'overlay-rules', 'overlay-party', 'overlay-settings', 'overlay-scan', 'overlay-qr', 'overlay-color', 'overlay-target']) {
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
  // on retient la room quittée : y revenir ne demande que de retaper le code
  try {
    const code = App.host ? App.host.code : (App.client ? App.client.code : null);
    if (code) localStorage.setItem('webno.last', code);
  } catch (_) {}
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
  $('rg-go').onclick = () => pleinEcran();
  for (const ev of ['resize', 'orientationchange', 'fullscreenchange', 'webkitfullscreenchange']) {
    window.addEventListener(ev, () => setTimeout(exigeHorizontal, 120));
  }
  ui.showScreen('home');

  window.__webno = App;   // point d'accès pour le débogage / les tests
  window.__apply = applyState;
  window.__ui = ui;

  // rejoindre directement via #CODE
  // dernière room quittée : le code est proposé, il suffit de valider
  try {
    const dernier = normalizeCode(localStorage.getItem('webno.last') || '');
    if (dernier.length === 5 && !location.hash) $('input-code').value = dernier;
  } catch (_) {}

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
