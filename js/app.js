// app.js — orchestration : accueil, salon, boucle hôte (moteur + IA), client
import { UnoGame, DEFAULT_SETTINGS } from './engine.js';
import { botDecide, botJumpIn, botCallout, botDelay, botProfile } from './bot.js';
import { HostNet, ClientNet, normalizeCode } from './net.js';
import { isWild } from './deck.js';
import * as ui from './ui.js';
import * as audio from './audio.js';

const $ = (id) => document.getElementById(id);
const MAX_PLAYERS = 4;
const BOT_NAMES = ['Robo-Léa', 'Robo-Max', 'Robo-Zoé', 'Robo-Nino', 'Robo-Iris'];
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
      if (this.game) { this.net.send(peerId, { t: 'error', msg: 'La partie a déjà commencé.', fatal: true }); return; }
      if (this.players.length >= MAX_PLAYERS) { this.net.send(peerId, { t: 'error', msg: 'La room est complète.', fatal: true }); return; }
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

  onClose(peerId) {
    const p = this.byPeer(peerId);
    if (!p) return;
    p.peerId = null;
    if (!this.game) {
      this.players = this.players.filter((x) => x.id !== p.id);
      ui.toast(`${p.name} a quitté le salon`, 'warn');
      this.syncLobby();
    } else {
      const gp = this.game.byId(p.id);
      if (gp) { gp.connected = false; gp.isBot = true; }
      p.isBot = true;
      ui.toast(`${p.name} s'est déconnecté — un bot prend la main`, 'warn');
      this.afterChange();
    }
  }

  addBot() {
    if (this.players.length >= MAX_PLAYERS) return;
    const used = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || 'Bot ' + this.players.length;
    this.players.push({ id: this.newId(), name, isHost: false, isBot: true, peerId: null });
    this.syncLobby();
  }

  fillBots() { while (this.players.length < MAX_PLAYERS) this.addBot(); }

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
    this.syncLobby();
  }

  lobbyPayload() {
    return {
      code: this.code,
      settings: this.settings,
      players: this.players.map((p) => ({ id: p.id, name: p.name, isHost: p.isHost, isBot: p.isBot })),
    };
  }

  syncLobby() {
    const payload = this.lobbyPayload();
    for (const p of this.players) {
      if (p.peerId) this.net.send(p.peerId, { t: 'lobby', ...payload, you: p.id });
    }
    renderLobbyLocal(payload, true);
  }

  start() {
    this.game = new UnoGame(
      this.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot, connected: true })),
      this.settings
    );
    this.game.startRound();
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

  /** Boucle IA. */
  tick() {
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
      this.actAt = now + botDelay(g.settings.botLevel);
      return;
    }
    if (!cur.isBot || now < this.actAt) return;

    const action = botDecide(g, cur);
    let res = g.handle(cur.id, action);
    if (!res.ok) res = g.handle(cur.id, { type: 'draw' });   // filet de sécurité
    if (!res.ok) g.handle(cur.id, { type: 'pass' });
    this.actAt = now + botDelay(g.settings.botLevel);
    this.afterChange();
  }

  localAction(action) {
    if (!this.game) return;
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
  ui.renderLobby({ ...payload, isHost, maxPlayers: MAX_PLAYERS }, {
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

  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-create').click(); });
}

function wireLobby() {
  $('btn-copy').onclick = async () => {
    const code = $('code-value').textContent;
    const link = location.origin + location.pathname + '#' + code;
    try { await navigator.clipboard.writeText(link); ui.toast('Lien d\'invitation copié !'); }
    catch (_) { ui.toast('Code de la room : ' + code); }
  };
  $('btn-add-bot').onclick = () => App.host && App.host.addBot();
  $('btn-fill-bots').onclick = () => App.host && App.host.fillBots();
  $('btn-start').onclick = () => App.host && App.host.start();
  $('btn-lobby-leave').onclick = () => leave();

  for (const seg of document.querySelectorAll('.seg[data-setting]')) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || !App.host) return;
      const key = seg.dataset.setting;
      let val = b.dataset.value;
      if (key === 'targetScore') val = Number(val);
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
  $('btn-toggle-log').onclick = () => { const p = $('logpanel'); p.hidden = !p.hidden; };
  $('btn-quit').onclick = () => leave();
  $('btn-next-round').onclick = () => App.host && App.host.nextRound();
  $('btn-rematch').onclick = () => App.host && App.host.rematch();
  $('btn-home').onclick = () => leave();

  document.addEventListener('keydown', (e) => {
    if (!App.view || $('screen-game').classList.contains('active') === false) return;
    if (e.key === 'd' || e.key === 'D') $('btn-draw').click();
    if (e.key === 'u' || e.key === 'U') $('btn-uno').click();
    if (e.key === 'p' || e.key === 'P') { if (!$('btn-pass').hidden) $('btn-pass').click(); }
  });
}

function leave() {
  if (confirmLeave()) {
    if (App.host) App.host.destroy();
    if (App.client) App.client.destroy();
    location.reload();
  }
}

function confirmLeave() {
  return App.role === null || window.confirm('Quitter la partie ?');
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

  // rejoindre directement via #CODE
  const hash = normalizeCode(location.hash.replace('#', ''));
  if (hash.length === 5) $('input-code').value = hash;
}

// les modules sont différés : le DOM est prêt, mais on couvre le cas contraire
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', boot);
else boot();

window.addEventListener('beforeunload', (e) => {
  if (App.role && App.view) { e.preventDefault(); e.returnValue = ''; }
});
