// engine.js — moteur de jeu UNO autoritaire (tourne uniquement chez l'hôte)
import { buildDeck, shuffle, isWild, isNumber, cardPoints, cardLabel, COLORS, COLOR_LABEL } from './deck.js';

export const DEFAULT_SETTINGS = {
  mode: 'solo',            // 'solo' | 'team'
  stacking: true,          // Accumulation des +2 / +4
  sevenZero: true,         // Règle 7-0
  jumpIn: true,            // À la volée
  bluff: false,            // Dénonciation du +4 (désactivée par défaut)
  unoRule: true,           // Obligation de dire UNO
  winCondition: 'points',  // 'points' | 'single'
  targetScore: 500,
  botLevel: 'normal',      // 'easy' | 'normal' | 'hard'
  startCards: 7,
};

export class UnoGame {
  /** @param players [{id, name, isBot, connected}] — 2 à 4 joueurs */
  constructor(players, settings) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.players = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      isBot: !!p.isBot,
      connected: p.connected !== false,
      seat: i,
      team: i % 2,           // équipes : sièges 0/2 contre 1/3
      score: 0,
      hand: [],
      mustCallUno: false,
    }));
    this.log = [];
    this.roundNo = 0;
    this.dealer = this.players.length - 1;
    this.phase = 'idle';    // idle | playing | roundEnd | gameEnd
    this.roundResult = null;
    this.gameResult = null;
    this.version = 0;
  }

  // ---------------------------------------------------------------- helpers
  get current() { return this.players[this.turnIndex]; }

  byId(id) { return this.players.find((p) => p.id === id); }

  activePlayers() { return this.players; }

  say(type, text, data = {}) {
    this.log.push({ type, text, ...data, t: Date.now() });
    if (this.log.length > 120) this.log.shift();
  }

  topCard() { return this.discard[this.discard.length - 1]; }

  teamOf(player) { return this.settings.mode === 'team' ? player.team : player.seat; }

  areAllies(a, b) {
    return this.settings.mode === 'team' && a.id !== b.id && a.team === b.team;
  }

  // ------------------------------------------------------------ round setup
  startRound() {
    this.roundNo++;
    this.deck = shuffle(buildDeck());
    this.discard = [];
    this.direction = 1;
    this.pendingDraw = 0;
    this.pendingKind = null;
    this.drawnCardId = null;
    this.lastWild4 = null;
    this.roundResult = null;
    this.phase = 'playing';
    this.log = [];

    for (const p of this.players) {
      p.hand = [];
      p.mustCallUno = false;
    }
    for (let i = 0; i < this.settings.startCards; i++) {
      for (const p of this.players) p.hand.push(this.drawFromDeck());
    }

    // Première carte retournée : on force une carte chiffrée pour un départ neutre
    let first = this.drawFromDeck();
    let guard = 0;
    while (!isNumber(first) && guard++ < 200) {
      this.deck.push(first);
      shuffle(this.deck);
      first = this.drawFromDeck();
    }
    this.discard.push(first);
    this.currentColor = first.color;

    this.dealer = (this.dealer + 1) % this.players.length;
    this.turnIndex = (this.dealer + 1) % this.players.length;

    this.say('round', `Manche ${this.roundNo} — carte de départ : ${cardLabel(first)}`);
    this.say('turn', `Au tour de ${this.current.name}`);
    this.version++;
    return this;
  }

  drawFromDeck() {
    if (this.deck.length === 0) this.recycle();
    if (this.deck.length === 0) return null;
    return this.deck.pop();
  }

  recycle() {
    if (this.discard.length <= 1) return;
    const top = this.discard.pop();
    const recycled = this.discard.map((c) => (isWild(c) ? { ...c, color: 'wild' } : c));
    this.deck = shuffle(recycled);
    this.discard = [top];
    this.say('info', 'La pioche est vide : la défausse est remélangée.');
  }

  giveCards(player, n) {
    const given = [];
    for (let i = 0; i < n; i++) {
      const c = this.drawFromDeck();
      if (!c) break;
      player.hand.push(c);
      given.push(c);
    }
    if (player.hand.length > 1) player.mustCallUno = false;
    return given;
  }

  // ------------------------------------------------------------- validation
  matches(card, allowWild = true) {
    if (isWild(card)) return allowWild;
    const top = this.topCard();
    return card.color === this.currentColor || card.value === top.value;
  }

  /** Carte jouable pour répondre à une accumulation en cours. */
  stackable(card) {
    if (!this.settings.stacking) return false;
    if (this.pendingKind === 'draw2') return card.value === 'draw2' || card.value === 'wild4';
    if (this.pendingKind === 'wild4') return card.value === 'wild4';
    return false;
  }

  /** Peut-on poser cette carte à la volée (hors de son tour) ? */
  canJumpIn(player, card) {
    if (!this.settings.jumpIn) return false;
    if (this.pendingDraw > 0) return false;
    if (player.id === this.current.id) return false;
    const top = this.topCard();
    if (isWild(card) || isWild(top)) return false;
    return card.color === top.color && card.value === top.value;
  }

  legalCardsFor(player) {
    if (this.phase !== 'playing') return [];
    const ids = [];
    const isTurn = player.id === this.current.id;
    for (const card of player.hand) {
      if (isTurn) {
        if (this.pendingDraw > 0) {
          if (this.stackable(card)) ids.push(card.id);
        } else if (this.drawnCardId) {
          // après une pioche, seule la carte piochée peut être jouée
          if (card.id === this.drawnCardId && this.matches(card)) ids.push(card.id);
        } else if (this.matches(card)) {
          ids.push(card.id);
        }
      } else if (this.canJumpIn(player, card)) {
        ids.push(card.id);
      }
    }
    return ids;
  }

  // ----------------------------------------------------------------- actions
  /**
   * action : {type:'play', cardId, color?, targetId?, uno?}
   *        | {type:'draw'} | {type:'pass'} | {type:'uno'}
   *        | {type:'callout', targetId} | {type:'challenge'}
   */
  handle(playerId, action) {
    const player = this.byId(playerId);
    if (!player) return { ok: false, error: 'Joueur inconnu' };
    if (this.phase !== 'playing' && action.type !== 'callout') {
      return { ok: false, error: 'La manche n\'est pas en cours' };
    }
    let res;
    switch (action.type) {
      case 'play':     res = this.actPlay(player, action); break;
      case 'draw':     res = this.actDraw(player); break;
      case 'pass':     res = this.actPass(player); break;
      case 'uno':      res = this.actUno(player); break;
      case 'callout':  res = this.actCallout(player, action.targetId); break;
      case 'challenge':res = this.actChallenge(player); break;
      default:         res = { ok: false, error: 'Action inconnue' };
    }
    if (res.ok) this.version++;
    return res;
  }

  actPlay(player, { cardId, color, targetId, uno }) {
    const idx = player.hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return { ok: false, error: 'Carte absente de votre main' };
    const card = player.hand[idx];
    const jumping = player.id !== this.current.id;

    if (jumping) {
      if (!this.canJumpIn(player, card)) return { ok: false, error: 'Impossible de jouer à la volée' };
    } else if (this.pendingDraw > 0) {
      if (!this.stackable(card)) return { ok: false, error: `Vous devez piocher ${this.pendingDraw} cartes` };
    } else if (this.drawnCardId && card.id !== this.drawnCardId) {
      return { ok: false, error: 'Vous ne pouvez jouer que la carte piochée' };
    } else if (!this.matches(card)) {
      return { ok: false, error: 'Carte non jouable' };
    }

    if (isWild(card) && !COLORS.includes(color)) return { ok: false, error: 'Choisissez une couleur' };
    if (this.settings.sevenZero && card.value === '7' && this.players.length > 1) {
      const target = this.byId(targetId);
      if (!target || target.id === player.id) return { ok: false, error: 'Choisissez un joueur pour l\'échange' };
    }

    // mémorise la couleur en vigueur AVANT la pose (pour la dénonciation du +4)
    const colorBefore = this.currentColor;
    const hadColor = player.hand.some((c, i) => i !== idx && !isWild(c) && c.color === colorBefore);

    if (jumping) {
      this.turnIndex = player.seat;
      this.say('jump', `${player.name} pose à la volée !`);
    }

    player.hand.splice(idx, 1);
    const played = isWild(card) ? { ...card, chosen: color } : card;
    this.discard.push(played);
    this.currentColor = isWild(card) ? color : card.color;
    this.drawnCardId = null;

    this.say('play', `${player.name} pose ${cardLabel(card)}${isWild(card) ? ` (${COLOR_LABEL[color]})` : ''}`,
      { playerId: player.id, card: played });

    // UNO
    if (player.hand.length === 1) {
      if (uno || !this.settings.unoRule) {
        player.mustCallUno = false;
        this.say('uno', `${player.name} annonce UNO !`, { playerId: player.id });
      } else {
        player.mustCallUno = true;
      }
    }

    // Fin de manche ?
    if (player.hand.length === 0) {
      this.endRound(player);
      return { ok: true };
    }

    this.applyEffect(player, card, { color, targetId, hadColor, colorBefore });
    return { ok: true };
  }

  applyEffect(player, card, ctx) {
    const n = this.players.length;
    let skip = 0;

    switch (card.value) {
      case 'skip':
        skip = 1;
        this.say('effect', `${this.playerAt(1).name} passe son tour.`);
        break;
      case 'reverse':
        if (n === 2) {
          skip = 1;
          this.say('effect', 'Changement de sens : le tour repasse.');
        } else {
          this.direction *= -1;
          this.say('effect', 'Le sens de jeu s\'inverse.');
        }
        break;
      case 'draw2':
        this.pendingDraw += 2;
        this.pendingKind = 'draw2';
        this.say('effect', `+2 — accumulation : ${this.pendingDraw} cartes en attente.`);
        break;
      case 'wild4':
        this.pendingDraw += 4;
        this.pendingKind = 'wild4';
        this.lastWild4 = { playerId: player.id, hadColor: ctx.hadColor, color: ctx.colorBefore };
        this.say('effect', `+4 — accumulation : ${this.pendingDraw} cartes en attente.`);
        break;
      case '7':
        if (this.settings.sevenZero) {
          const target = this.byId(ctx.targetId);
          const tmp = player.hand;
          player.hand = target.hand;
          target.hand = tmp;
          player.mustCallUno = player.hand.length === 1 && this.settings.unoRule;
          target.mustCallUno = target.hand.length === 1 && this.settings.unoRule;
          this.say('swap', `7 — ${player.name} échange sa main avec ${target.name}.`,
            { a: player.id, b: target.id });
          if (player.hand.length === 0) return this.endRound(player);
          if (target.hand.length === 0) return this.endRound(target);
        }
        break;
      case '0':
        if (this.settings.sevenZero) {
          const hands = this.players.map((p) => p.hand);
          const rotated = this.players.map((_, i) => {
            const from = ((i - this.direction) % n + n) % n;
            return hands[from];
          });
          this.players.forEach((p, i) => {
            p.hand = rotated[i];
            p.mustCallUno = p.hand.length === 1 && this.settings.unoRule;
          });
          this.say('rotate', `0 — toutes les mains tournent d'un cran ${this.direction === 1 ? '(sens horaire)' : '(sens antihoraire)'}.`,
            { direction: this.direction });
          const empty = this.players.find((p) => p.hand.length === 0);
          if (empty) return this.endRound(empty);
        }
        break;
    }

    this.advance(1 + skip);

    // Sans accumulation, la pénalité tombe immédiatement sur le joueur suivant
    if (this.pendingDraw > 0 && !this.settings.stacking) {
      this.resolvePenalty(this.current, true);
    }
  }

  /** Joueur situé à `offset` tours du joueur courant. */
  playerAt(offset) {
    const n = this.players.length;
    const i = ((this.turnIndex + this.direction * offset) % n + n) % n;
    return this.players[i];
  }

  advance(steps = 1) {
    const n = this.players.length;
    // le joueur qui reprend la main n'est plus vulnérable à la dénonciation
    for (let s = 0; s < steps; s++) {
      this.turnIndex = ((this.turnIndex + this.direction) % n + n) % n;
    }
    this.drawnCardId = null;
    if (this.current.mustCallUno && this.current.hand.length === 1) {
      this.current.mustCallUno = false; // il est passé entre les mailles
    }
    if (this.phase === 'playing') this.say('turn', `Au tour de ${this.current.name}`, { playerId: this.current.id });
  }

  resolvePenalty(player, autoAdvance) {
    const n = this.pendingDraw;
    this.giveCards(player, n);
    this.say('penalty', `${player.name} pioche ${n} carte${n > 1 ? 's' : ''}.`, { playerId: player.id, count: n });
    this.pendingDraw = 0;
    this.pendingKind = null;
    this.lastWild4 = null;
    if (autoAdvance) this.advance(1);
  }

  actDraw(player) {
    if (player.id !== this.current.id) return { ok: false, error: 'Ce n\'est pas votre tour' };
    if (this.pendingDraw > 0) {
      this.resolvePenalty(player, true);
      return { ok: true };
    }
    if (this.drawnCardId) return { ok: false, error: 'Vous avez déjà pioché' };
    const [card] = this.giveCards(player, 1);
    if (!card) return { ok: false, error: 'Plus de cartes' };
    this.say('draw', `${player.name} pioche une carte.`, { playerId: player.id });
    if (this.matches(card)) {
      this.drawnCardId = card.id;   // il peut la jouer ou passer
    } else {
      this.advance(1);
    }
    return { ok: true };
  }

  actPass(player) {
    if (player.id !== this.current.id) return { ok: false, error: 'Ce n\'est pas votre tour' };
    if (!this.drawnCardId) return { ok: false, error: 'Vous devez d\'abord piocher' };
    this.say('pass', `${player.name} passe son tour.`, { playerId: player.id });
    this.advance(1);
    return { ok: true };
  }

  actUno(player) {
    if (player.hand.length !== 1) return { ok: false, error: 'Vous n\'avez pas une seule carte' };
    player.mustCallUno = false;
    this.say('uno', `${player.name} annonce UNO !`, { playerId: player.id });
    return { ok: true };
  }

  actCallout(player, targetId) {
    if (!this.settings.unoRule) return { ok: false, error: 'Règle UNO désactivée' };
    const target = this.byId(targetId);
    if (!target || !target.mustCallUno) return { ok: false, error: 'Rien à dénoncer' };
    if (target.id === player.id) return { ok: false, error: 'Dénonciation impossible sur soi-même' };
    target.mustCallUno = false;
    this.giveCards(target, 2);
    this.say('callout', `${player.name} dénonce ${target.name} : +2 cartes !`, { playerId: target.id });
    this.version++;
    return { ok: true };
  }

  actChallenge(player) {
    if (!this.settings.bluff) return { ok: false, error: 'La dénonciation du +4 est désactivée' };
    if (player.id !== this.current.id) return { ok: false, error: 'Ce n\'est pas votre tour' };
    if (this.pendingKind !== 'wild4' || !this.lastWild4) return { ok: false, error: 'Aucun +4 à contester' };
    const accused = this.byId(this.lastWild4.playerId);
    if (this.lastWild4.hadColor) {
      this.say('challenge', `${player.name} conteste : ${accused.name} bluffait ! Il pioche ${this.pendingDraw}.`);
      this.giveCards(accused, this.pendingDraw);
    } else {
      const total = this.pendingDraw + 2;
      this.say('challenge', `${player.name} conteste à tort : il pioche ${total} cartes.`);
      this.giveCards(player, total);
    }
    this.pendingDraw = 0;
    this.pendingKind = null;
    this.lastWild4 = null;
    this.advance(1);
    return { ok: true };
  }

  // ------------------------------------------------------------- fin de partie
  endRound(winner) {
    this.phase = 'roundEnd';
    const detail = [];
    let points = 0;
    for (const p of this.players) {
      const pts = p.hand.reduce((s, c) => s + cardPoints(c), 0);
      detail.push({ id: p.id, name: p.name, cards: p.hand.length, points: pts });
      const sameSide = this.settings.mode === 'team'
        ? p.team === winner.team
        : p.id === winner.id;
      if (!sameSide) points += pts;
    }

    if (this.settings.mode === 'team') {
      for (const p of this.players) if (p.team === winner.team) p.score += points;
    } else {
      winner.score += points;
    }

    const label = this.settings.mode === 'team'
      ? `Équipe ${winner.team === 0 ? 'A' : 'B'}`
      : winner.name;
    this.say('win', `${winner.name} termine la manche ! ${label} marque ${points} points.`, { playerId: winner.id });

    this.roundResult = { winnerId: winner.id, winnerName: winner.name, team: winner.team, points, detail };

    // Condition de victoire
    let done = false;
    if (this.settings.winCondition === 'single') {
      done = true;
    } else if (this.settings.mode === 'team') {
      const teamScore = (t) => this.players.filter((p) => p.team === t).reduce((s, p) => Math.max(s, p.score), 0);
      done = teamScore(0) >= this.settings.targetScore || teamScore(1) >= this.settings.targetScore;
    } else {
      done = this.players.some((p) => p.score >= this.settings.targetScore);
    }

    if (done) {
      this.phase = 'gameEnd';
      if (this.settings.mode === 'team') {
        const t = this.settings.winCondition === 'single'
          ? winner.team
          : (this.players.filter((p) => p.team === 0)[0].score >= this.settings.targetScore ? 0 : 1);
        this.gameResult = {
          type: 'team', team: t,
          names: this.players.filter((p) => p.team === t).map((p) => p.name),
          score: this.players.find((p) => p.team === t).score,
        };
        this.say('gameover', `Victoire de l'équipe ${t === 0 ? 'A' : 'B'} (${this.gameResult.names.join(' & ')}) !`);
      } else {
        const best = [...this.players].sort((a, b) => b.score - a.score)[0];
        const champ = this.settings.winCondition === 'single' ? winner : best;
        this.gameResult = { type: 'solo', playerId: champ.id, names: [champ.name], score: champ.score };
        this.say('gameover', `${champ.name} remporte la partie !`);
      }
    }
    this.version++;
  }

  teamScores() {
    if (this.settings.mode !== 'team') return null;
    return [0, 1].map((t) => {
      const members = this.players.filter((p) => p.team === t);
      return { team: t, names: members.map((p) => p.name), score: members.length ? members[0].score : 0 };
    });
  }

  // ------------------------------------------------------------- sérialisation
  /** Vue filtrée de l'état pour un joueur donné (masque les mains adverses). */
  stateFor(playerId) {
    const me = this.byId(playerId);
    const top = this.topCard();
    const calloutTargets = this.settings.unoRule
      ? this.players.filter((p) => p.mustCallUno && p.id !== playerId).map((p) => p.id)
      : [];
    return {
      version: this.version,
      phase: this.phase,
      settings: this.settings,
      roundNo: this.roundNo,
      you: playerId,
      turnId: this.phase === 'playing' ? this.current.id : null,
      direction: this.direction,
      currentColor: this.currentColor,
      top: top ? { ...top } : null,
      discardCount: this.discard.length,
      deckCount: this.deck ? this.deck.length : 0,
      pendingDraw: this.pendingDraw,
      pendingKind: this.pendingKind,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot, connected: p.connected,
        seat: p.seat, team: p.team, score: p.score,
        handCount: p.hand.length, mustCallUno: p.mustCallUno,
      })),
      hand: me ? me.hand.map((c) => ({ ...c })) : [],
      legal: me ? this.legalCardsFor(me) : [],
      canDraw: !!me && this.phase === 'playing' && me.id === this.current.id && !this.drawnCardId,
      canPass: !!me && this.phase === 'playing' && me.id === this.current.id && !!this.drawnCardId,
      canUno: !!me && me.hand.length === 1 && me.mustCallUno,
      canChallenge: !!me && this.settings.bluff && this.phase === 'playing'
        && me.id === this.current.id && this.pendingKind === 'wild4' && this.pendingDraw > 0,
      calloutTargets,
      teamScores: this.teamScores(),
      roundResult: this.roundResult,
      gameResult: this.gameResult,
      log: this.log.slice(-40),
    };
  }
}
