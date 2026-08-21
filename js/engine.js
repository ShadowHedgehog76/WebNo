// engine.js — moteur de jeu UNO autoritaire (tourne uniquement chez l'hôte)
import {
  buildDeck, buildFlipDeck, buildNoMercyDeck, decksNeeded, shuffle, isWild, isNumber,
  cardPoints, cardLabel, face, colorsOf, COLORS, COLOR_LABEL, DRAW_AMOUNT, isDrawCard,
} from './deck.js?v=202608220144';

/** Au-delà de ce nombre de cartes, No Mercy élimine le joueur de la manche. */
export const MERCY_LIMIT = 25;

export const DEFAULT_SETTINGS = {
  mode: 'solo',            // 'solo' | 'team'
  stacking: true,          // Accumulation des +2 / +4
  sevenZero: true,         // Règle 7-0
  jumpIn: true,            // À la volée
  bluff: false,            // Dénonciation du +4 (désactivée par défaut)
  pack: 'classic',         // 'classic' | 'flip' | 'nomercy' | 'extreme'
  unoRule: true,           // Obligation de dire UNO
  winCondition: 'points',  // 'points' | 'single'
  targetScore: 500,
  teamSize: 2,             // mode équipes : 2v2, 3v3 ou 4v4
  botLevel: 'normal',      // 'easy' | 'normal' | 'hard'
  startCards: 7,
};

export class UnoGame {
  /** @param players [{id, name, isBot, connected}] — 2 à 4 joueurs */
  constructor(players, settings) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.groups = 2;
    this.players = players.map((p, i) => ({
      id: p.id,
      name: p.name,
      isBot: !!p.isBot,
      connected: p.connected !== false,
      seat: i,
      team: i % this.groups, // sièges alternés : le groupe se lit dans la place
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

  /** Face visible d'une carte, selon le côté en cours (pack Flip). */
  face(card) { return face(card, this.side); }

  /**
   * Carte telle qu'on la montre : sa face active, et en pack Flip l'autre
   * face — celle que les adversaires voient puisqu'ils tiennent le carton
   * tourné vers eux.
   */
  publicCard(card) {
    if (!card) return null;
    const f = this.face(card);
    const out = { id: card.id, color: f.color, value: f.value };
    if (card.chosen) out.chosen = card.chosen;
    if (this.isFlip) out.back = { ...face(card, this.otherSide()) };
    return out;
  }

  otherSide() { return this.side === 'light' ? 'dark' : 'light'; }

  get isFlip() { return this.settings.pack === 'flip'; }

  get isNoMercy() { return this.settings.pack === 'nomercy'; }

  get isExtreme() { return this.settings.pack === 'extreme'; }

  /** Joueurs encore en lice (No Mercy en élimine). */
  alive() { return this.players.filter((p) => !p.out).length; }

  /**
   * Le lanceur d'UNO Extreme : on appuie, il crache un nombre imprévisible
   * de cartes — souvent aucune, parfois une poignée.
   */
  launcherShot() {
    const r = Math.random();
    if (r < 0.45) return 0;
    if (r < 0.75) return 1 + Math.floor(Math.random() * 2);
    if (r < 0.92) return 3 + Math.floor(Math.random() * 2);
    return 5 + Math.floor(Math.random() * 4);
  }

  /** Le jeu se compte-t-il par groupes ? */
  isTeamPlay() { return this.settings.mode === 'team'; }

  teamOf(player) { return this.isTeamPlay() ? player.team : player.seat; }

  areAllies(a, b) {
    return this.isTeamPlay() && a.id !== b.id && a.team === b.team;
  }

  // ------------------------------------------------------------ round setup
  startRound() {
    this.roundNo++;
    this.side = 'light';
    // No Mercy garde jusqu'à 25 cartes par joueur avant élimination : il faut
    // prévoir bien plus large que pour une partie ordinaire.
    const copies = this.isNoMercy
      ? Math.max(1, Math.ceil((this.players.length * MERCY_LIMIT + 30) / 128))
      : decksNeeded(this.players.length, this.settings.startCards);
    this.deck = shuffle(this.isFlip ? buildFlipDeck(copies)
      : (this.isNoMercy ? buildNoMercyDeck(copies) : buildDeck(copies)));
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
      p.out = false;
    }
    for (let i = 0; i < this.settings.startCards; i++) {
      for (const p of this.players) p.hand.push(this.drawFromDeck());
    }

    // Première carte retournée : on force une carte chiffrée pour un départ neutre
    let first = this.drawFromDeck();
    let guard = 0;
    while (!isNumber(this.face(first)) && guard++ < 200) {
      this.deck.push(first);
      shuffle(this.deck);
      first = this.drawFromDeck();
    }
    this.discard.push(first);
    this.currentColor = this.face(first).color;

    this.dealer = (this.dealer + 1) % this.players.length;
    this.turnIndex = (this.dealer + 1) % this.players.length;

    this.say('round', `Manche ${this.roundNo} — carte de départ : ${cardLabel(this.face(first))}`);
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
    const recycled = this.discard.map((c) => (c.chosen ? { ...c, chosen: undefined } : c));
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
    this.checkElimination(player);
    return given;
  }

  /** No Mercy : passé 25 cartes, on quitte la manche sur-le-champ. */
  checkElimination(player) {
    if (!this.isNoMercy || player.out || this.phase !== 'playing') return;
    if (player.hand.length < MERCY_LIMIT) return;
    player.out = true;
    player.mustCallUno = false;
    this.say('out', `${player.name} dépasse ${MERCY_LIMIT} cartes : éliminé de la manche !`,
      { playerId: player.id });
    const restants = this.players.filter((p) => !p.out);
    if (restants.length === 1) this.endRound(restants[0]);
  }

  // ------------------------------------------------------------- validation
  matches(card, allowWild = true) {
    const f = this.face(card);
    if (isWild(f)) return allowWild;
    const t = this.face(this.topCard());
    return f.color === this.currentColor || f.value === t.value;
  }

  /** Carte jouable pour répondre à une accumulation en cours. */
  stackable(card) {
    if (!this.settings.stacking) return false;
    const f = this.face(card);
    if (this.isNoMercy) return this.pendingDraw > 0 && isDrawCard(f);
    const v = f.value;
    if (this.pendingKind === 'draw2') return v === 'draw2' || v === 'wild4';
    if (this.pendingKind === 'wild4') return v === 'wild4';
    if (this.pendingKind === 'draw5') return v === 'draw5';
    return false;
  }

  /** Peut-on poser cette carte à la volée (hors de son tour) ? */
  canJumpIn(player, card) {
    if (!this.settings.jumpIn) return false;
    if (this.pendingDraw > 0) return false;
    if (player.id === this.current.id) return false;
    const f = this.face(card), t = this.face(this.topCard());
    if (isWild(f) || isWild(t)) return false;
    return f.color === t.color && f.value === t.value;
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
    const f = this.face(card);
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

    if (isWild(f) && !colorsOf(this.side).includes(color)) return { ok: false, error: 'Choisissez une couleur' };
    if (this.settings.sevenZero && f.value === '7' && this.players.length > 1) {
      const target = this.byId(targetId);
      if (!target || target.id === player.id) return { ok: false, error: 'Choisissez un joueur pour l\'échange' };
    }

    // mémorise la couleur en vigueur AVANT la pose (pour la dénonciation du +4)
    const colorBefore = this.currentColor;
    const hadColor = player.hand.some((c, i) => {
      const cf = this.face(c);
      return i !== idx && !isWild(cf) && cf.color === colorBefore;
    });

    if (jumping) {
      this.turnIndex = player.seat;
      this.say('jump', `${player.name} pose à la volée !`);
    }

    player.hand.splice(idx, 1);
    const played = isWild(f) ? { ...card, chosen: color } : card;
    this.discard.push(played);
    this.currentColor = isWild(f) ? color : f.color;
    this.drawnCardId = null;

    this.say('play', `${player.name} pose ${cardLabel(f)}${isWild(f) ? ` (${COLOR_LABEL[color]})` : ''}`,
      { playerId: player.id, card: this.publicCard(played) });

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
    const f = this.face(card);

    switch (f.value) {
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
      case 'draw5':
        this.pendingDraw += DRAW_AMOUNT[f.value];
        this.pendingKind = f.value;
        this.say('effect', `${DRAW_AMOUNT[f.value] === 5 ? '+5' : '+2'} — accumulation : ${this.pendingDraw} cartes en attente.`);
        break;
      case 'skipAll':
        skip = Math.max(this.alive() - 1, 0);
        this.say('effect', `${player.name} saute tout le monde et rejoue.`);
        break;
      case 'draw10':
        this.pendingDraw += 10;
        this.pendingKind = 'draw10';
        this.say('effect', `+10 — accumulation : ${this.pendingDraw} cartes en attente.`);
        break;
      case 'discardAll': {
        const jetees = player.hand.filter((c) => this.face(c).color === f.color);
        player.hand = player.hand.filter((c) => this.face(c).color !== f.color);
        for (const c of jetees) this.discard.splice(this.discard.length - 1, 0, c);
        this.say('effect', `${player.name} se défausse de ${jetees.length} carte${jetees.length > 1 ? 's' : ''} ${COLOR_LABEL[f.color].toLowerCase()}${jetees.length > 1 ? 's' : ''}.`);
        if (player.hand.length === 1 && this.settings.unoRule) player.mustCallUno = true;
        if (player.hand.length === 0) return this.endRound(player);
        break;
      }
      case 'reverseDraw4': {
        this.direction *= -1;
        this.pendingDraw += 4;
        this.pendingKind = 'draw2';
        this.say('effect', `Sens inversé, et ${this.playerAt(1).name} doit encaisser ${this.pendingDraw} cartes.`);
        break;
      }
      case 'flip': {
        this.side = this.otherSide();
        this.currentColor = this.face(card).color;
        this.pendingDraw = 0; this.pendingKind = null;
        this.say('flip', `Retournement ! Tout le monde passe du côté ${this.side === 'dark' ? 'sombre' : 'clair'}.`,
          { side: this.side });
        break;
      }
      case 'wildDraw': {
        // le joueur suivant pioche jusqu'à trouver la couleur demandée
        const cible = this.playerAt(1);
        let pioche = 0;
        while (pioche < 15) {
          const c = this.drawFromDeck();
          if (!c) break;
          cible.hand.push(c);
          pioche++;
          if (this.face(c).color === ctx.color) break;
        }
        if (cible.hand.length > 1) cible.mustCallUno = false;
        this.say('penalty', `${cible.name} pioche ${pioche} carte${pioche > 1 ? 's' : ''} jusqu'au ${COLOR_LABEL[ctx.color].toLowerCase()}.`,
          { playerId: cible.id, count: pioche });
        skip = 1;
        break;
      }
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
      let garde = 0;
      do {
        this.turnIndex = ((this.turnIndex + this.direction) % n + n) % n;
      } while (this.players[this.turnIndex].out && ++garde < n);
    }
    this.drawnCardId = null;
    if (this.current.mustCallUno && this.current.hand.length === 1) {
      this.current.mustCallUno = false; // il est passé entre les mailles
    }
    if (this.phase === 'playing') this.say('turn', `Au tour de ${this.current.name}`, { playerId: this.current.id });
  }

  resolvePenalty(player, autoAdvance) {
    const n = this.pendingDraw;
    if (this.isExtreme) {
      // la pénalité se compte en coups de lanceur, pas en cartes
      let total = 0;
      for (let i = 0; i < n; i++) total += this.fire(player);
      this.say('penalty', `${player.name} déclenche ${n} fois le lanceur : ${total} carte${total > 1 ? 's' : ''}.`,
        { playerId: player.id, count: total, shots: n });
    } else {
      this.giveCards(player, n);
      this.say('penalty', `${player.name} pioche ${n} carte${n > 1 ? 's' : ''}.`, { playerId: player.id, count: n });
    }
    this.pendingDraw = 0;
    this.pendingKind = null;
    this.lastWild4 = null;
    if (autoAdvance) this.advance(1);
  }

  /** Un coup de lanceur : renvoie le nombre de cartes crachées. */
  fire(player) {
    const n = this.launcherShot();
    if (n > 0) this.giveCards(player, n);
    return n;
  }

  actDraw(player) {
    if (player.id !== this.current.id) return { ok: false, error: 'Ce n\'est pas votre tour' };
    if (this.pendingDraw > 0) {
      this.resolvePenalty(player, true);
      return { ok: true };
    }
    if (this.isExtreme) {
      // pas de pioche à l'unité : on appuie sur le lanceur et le tour s'achève
      const n = this.fire(player);
      this.say('launcher', n === 0
        ? `${player.name} appuie sur le lanceur… rien ne sort !`
        : `${player.name} appuie sur le lanceur : ${n} carte${n > 1 ? 's' : ''} !`,
        { playerId: player.id, count: n });
      this.advance(1);
      return { ok: true };
    }
    if (this.drawnCardId) return { ok: false, error: 'Vous avez déjà pioché' };
    const [card] = this.giveCards(player, 1);
    if (!card) {
      // paquet et défausse épuisés : on ne bloque pas la partie pour autant
      this.say('info', `Plus une carte à distribuer : ${player.name} passe son tour.`);
      this.advance(1);
      return { ok: true };
    }
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
      const pts = p.hand.reduce((s, c) => s + cardPoints(this.face(c)), 0);
      detail.push({ id: p.id, name: p.name, cards: p.hand.length, points: pts });
      const sameSide = this.isTeamPlay() ? p.team === winner.team : p.id === winner.id;
      if (!sameSide) points += pts;
    }

    if (this.isTeamPlay()) {
      for (const p of this.players) if (p.team === winner.team) p.score += points;
    } else {
      winner.score += points;
    }

    const label = this.isTeamPlay() ? this.groupName(winner.team) : winner.name;
    this.say('win', `${winner.name} termine la manche ! ${label} marque ${points} points.`, { playerId: winner.id });

    this.roundResult = {
      winnerId: winner.id, winnerName: winner.name, team: winner.team, points, detail,
      label: this.isTeamPlay() ? this.groupName(winner.team) : null,
    };

    // Condition de victoire
    let done = false;
    if (this.settings.winCondition === 'single') {
      done = true;
    } else if (this.isTeamPlay()) {
      done = this.groupIndexes().some((t) => this.groupScore(t) >= this.settings.targetScore);
    } else {
      done = this.players.some((p) => p.score >= this.settings.targetScore);
    }

    if (done) {
      this.phase = 'gameEnd';
      if (this.isTeamPlay()) {
        const t = this.settings.winCondition === 'single'
          ? winner.team
          : this.groupIndexes().sort((a, b) => this.groupScore(b) - this.groupScore(a))[0];
        this.gameResult = {
          type: 'team', team: t, label: this.groupName(t),
          names: this.players.filter((p) => p.team === t).map((p) => p.name),
          score: this.groupScore(t),
        };
        this.say('gameover', `Victoire du ${this.groupName(t).toLowerCase()} !`);
      } else {
        const best = [...this.players].sort((a, b) => b.score - a.score)[0];
        const champ = this.settings.winCondition === 'single' ? winner : best;
        this.gameResult = { type: 'solo', playerId: champ.id, names: [champ.name], score: champ.score };
        this.say('gameover', `${champ.name} remporte la partie !`);
      }
    }
    this.version++;
  }

  groupIndexes() { return Array.from({ length: this.groups }, (_, i) => i); }

  groupName(t) {
    return this.settings.mode === 'party'
      ? `Groupe ${t + 1}`
      : `Équipe ${t === 0 ? 'A' : 'B'}`;
  }

  groupScore(t) {
    const m = this.players.filter((p) => p.team === t);
    return m.length ? Math.max(...m.map((p) => p.score)) : 0;
  }

  teamScores() {
    if (!this.isTeamPlay()) return null;
    return this.groupIndexes().map((t) => {
      const members = this.players.filter((p) => p.team === t);
      return {
        team: t, name: this.groupName(t),
        names: members.map((p) => p.name),
        score: this.groupScore(t),
        cards: members.reduce((n, p) => n + p.hand.length, 0),
      };
    });
  }

  // ------------------------------------------------------------- sérialisation
  /** Vue filtrée de l'état pour un joueur donné (masque les mains adverses). */
  stateFor(playerId) {
    const me = this.byId(playerId);
    const top = this.topCard();
    // en mode équipes, les coéquipiers jouent à cartes ouvertes
    const allies = (me && this.settings.mode === 'team')
      ? this.players.filter((p) => p.team === me.team && p.id !== me.id)
      : [];
    const allyHands = {};
    for (const a of allies) allyHands[a.id] = a.hand.map((c) => this.publicCard(c));
    const calloutTargets = (this.settings.unoRule && me)
      ? this.players.filter((p) => p.mustCallUno && p.id !== playerId).map((p) => p.id)
      : [];
    return {
      version: this.version,
      phase: this.phase,
      settings: this.settings,
      spectator: !me,            // l'hôte du mode party observe sans jouer
      groups: this.groups,
      roundNo: this.roundNo,
      you: playerId,
      turnId: this.phase === 'playing' ? this.current.id : null,
      direction: this.direction,
      currentColor: this.currentColor,
      side: this.side,
      pack: this.settings.pack || 'classic',
      mercyLimit: this.isNoMercy ? MERCY_LIMIT : null,
      top: this.publicCard(top),
      discardCount: this.discard.length,
      deckCount: this.deck ? this.deck.length : 0,
      pendingDraw: this.pendingDraw,
      pendingKind: this.pendingKind,
      players: this.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot, connected: p.connected,
        seat: p.seat, team: p.team, score: p.score,
        handCount: p.hand.length, mustCallUno: p.mustCallUno, out: !!p.out,
        // en pack Flip on voit l'autre face des cartes que les autres tiennent
        backs: (this.isFlip && p.id !== playerId)
          ? p.hand.map((c) => ({ ...face(c, this.otherSide()) })) : undefined,
      })),
      hand: me ? me.hand.map((c) => this.publicCard(c)) : [],
      allyIds: allies.map((a) => a.id),
      allyHands: allies.length ? allyHands : null,
      legal: me ? this.legalCardsFor(me) : [],
      canDraw: !!me && this.phase === 'playing' && me.id === this.current.id && !this.drawnCardId,
      canPass: !!me && this.phase === 'playing' && me.id === this.current.id && !!this.drawnCardId,
      canUno: !!me && me.hand.length === 1 && me.mustCallUno,
      canChallenge: !!me && this.settings.bluff && this.phase === 'playing'
        && me.id === this.current.id && this.pendingKind === 'wild4' && this.pendingDraw > 0,
      calloutTargets,
      teamScores: this.teamScores(),
      turnSeat: this.phase === 'playing' ? this.turnIndex : null,
      // en party : quel « tour de table » on joue (les nᵉˢ joueurs de chaque groupe)
      lap: this.phase === 'playing' ? Math.floor(this.turnIndex / this.groups) + 1 : null,
      roundResult: this.roundResult,
      gameResult: this.gameResult,
      log: this.log.slice(-40),
    };
  }
}
