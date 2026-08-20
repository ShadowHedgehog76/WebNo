// tournament.js — mode party : un tournoi à quatre tables.
// Seize joueurs s'affrontent sur quatre tables de quatre, en parallèle. Le
// vainqueur de chaque table monte sur la table finale, où tout repart de zéro.
import { UnoGame } from './engine.js';

export const TABLE_COUNT = 4;
export const SEATS_PER_TABLE = 4;
export const TOURNAMENT_SIZE = TABLE_COUNT * SEATS_PER_TABLE;

export class Tournament {
  /** @param roster [{id, name, isBot}] — seize joueurs, l'hôte non compris */
  constructor(roster, settings) {
    this.settings = { ...settings };
    this.roster = roster.slice(0, TOURNAMENT_SIZE);
    this.phase = 'qualif';        // qualif | final | done
    this.tables = [];
    this.final = null;
    this.qualified = [];          // [{id, name, table}]
    this.champion = null;
    this.version = 0;
    this.log = [];
  }

  say(text) {
    this.log.push({ type: 'tournoi', text, t: Date.now() });
    if (this.log.length > 60) this.log.shift();
  }

  /** Règles d'une table : les joueurs s'y affrontent individuellement. */
  tableRules(isFinal) {
    return {
      ...this.settings,
      mode: 'solo',
      // les qualifications se jouent en une manche pour tenir le rythme ;
      // la finale suit le réglage de victoire choisi par l'hôte
      winCondition: isFinal ? (this.settings.winCondition || 'single') : 'single',
    };
  }

  start() {
    this.tables = [];
    for (let t = 0; t < TABLE_COUNT; t++) {
      const seats = this.roster.slice(t * SEATS_PER_TABLE, (t + 1) * SEATS_PER_TABLE);
      const g = new UnoGame(seats.map((p) => ({ ...p, connected: true })), this.tableRules(false));
      g.startRound();
      this.tables.push(g);
    }
    this.phase = 'qualif';
    this.qualified = [];
    this.final = null;
    this.champion = null;
    this.say(`Qualifications : ${TABLE_COUNT} tables de ${SEATS_PER_TABLE} joueurs.`);
    this.version++;
    return this;
  }

  /** Répartition aléatoire des joueurs sur les tables. */
  shuffleSeats() {
    const r = this.roster;
    for (let i = r.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [r[i], r[j]] = [r[j], r[i]];
    }
    this.version++;
  }

  /** Toutes les parties en cours, finale comprise. */
  games() { return this.phase === 'final' ? (this.final ? [this.final] : []) : this.tables; }

  tableIndexOf(playerId) {
    if (this.phase !== 'qualif') return this.final && this.final.byId(playerId) ? TABLE_COUNT : -1;
    return this.tables.findIndex((g) => g.byId(playerId));
  }

  /** La partie à laquelle ce joueur participe encore, s'il y en a une. */
  gameOf(playerId) {
    if (this.phase === 'final') return this.final && this.final.byId(playerId) ? this.final : null;
    if (this.phase === 'done') return null;
    return this.tables.find((g) => g.byId(playerId)) || null;
  }

  handle(playerId, action) {
    const g = this.gameOf(playerId);
    if (!g) return { ok: false, error: 'Vous ne jouez pas cette partie' };
    const res = g.handle(playerId, action);
    if (res.ok) { this.version++; this.advance(); }
    return res;
  }

  /** Fait progresser le tournoi quand une table s'achève. */
  advance() {
    // Personne ne clique « manche suivante » dans un tournoi : une table qui
    // termine une manche sans avoir de vainqueur redistribue d'elle-même.
    for (const g of this.games()) {
      if (g.phase === 'roundEnd') { g.startRound(); this.version++; }
    }
    if (this.phase === 'qualif') {
      for (let i = 0; i < this.tables.length; i++) {
        const g = this.tables[i];
        if (g.phase !== 'gameEnd' || this.qualified.some((q) => q.table === i)) continue;
        const winner = g.players.find((p) => p.id === g.gameResult.playerId);
        this.qualified.push({ id: winner.id, name: winner.name, table: i });
        this.say(`${winner.name} remporte la table ${i + 1} et se qualifie.`);
      }
      if (this.qualified.length === TABLE_COUNT) this.openFinal();
    } else if (this.phase === 'final' && this.final && this.final.phase === 'gameEnd') {
      const champ = this.final.players.find((p) => p.id === this.final.gameResult.playerId);
      this.champion = { id: champ.id, name: champ.name, score: champ.score };
      this.phase = 'done';
      this.say(`${champ.name} remporte le tournoi !`);
      this.version++;
    }
  }

  openFinal() {
    const seats = this.qualified
      .slice()
      .sort((a, b) => a.table - b.table)
      .map((q) => {
        const src = this.roster.find((p) => p.id === q.id);
        return { id: q.id, name: q.name, isBot: src ? src.isBot : false, connected: true };
      });
    this.final = new UnoGame(seats, this.tableRules(true));
    this.final.startRound();
    this.phase = 'final';
    this.say(`Table finale : ${seats.map((s) => s.name).join(', ')}. Tout repart de zéro.`);
    this.version++;
  }

  /* ─────────────────── vues ─────────────────── */

  /** Résumé d'une table, sans jamais livrer les mains. */
  tableSummary(g, index) {
    if (!g) return null;
    const top = g.topCard ? g.topCard() : null;
    return {
      index,
      phase: g.phase,
      turnId: g.phase === 'playing' && g.current ? g.current.id : null,
      currentColor: g.currentColor,
      top: top ? { ...top } : null,
      direction: g.direction,
      pendingDraw: g.pendingDraw,
      deckCount: g.deck ? g.deck.length : 0,
      roundNo: g.roundNo,
      players: g.players.map((p) => ({
        id: p.id, name: p.name, isBot: p.isBot, connected: p.connected,
        seat: p.seat, handCount: p.hand.length, score: p.score,
        mustCallUno: p.mustCallUno,
      })),
      winnerId: g.gameResult ? g.gameResult.playerId : null,
    };
  }

  /** Tableau du tournoi, destiné aux spectateurs et aux joueurs éliminés. */
  board() {
    return {
      phase: this.phase,
      qualified: this.qualified.slice(),
      champion: this.champion,
      tables: this.tables.map((g, i) => this.tableSummary(g, i)),
      final: this.tableSummary(this.final, TABLE_COUNT),
      log: this.log.slice(-20),
    };
  }

  /** État complet pour un joueur : sa partie si elle existe, sinon le tableau. */
  stateFor(playerId) {
    const g = this.gameOf(playerId);
    const board = this.board();
    if (g) {
      const s = g.stateFor(playerId);
      s.tournament = board;
      s.tableIndex = this.tableIndexOf(playerId);
      s.settings = { ...s.settings, mode: 'party' };
      return s;
    }
    // Spectateur ou joueur éliminé. Pendant la finale, on lui donne la vue
    // complète de cette table — sans les mains — pour l'afficher en grand.
    const focus = (this.phase === 'final' || this.phase === 'done') ? this.final : null;
    const s = focus ? focus.stateFor(playerId) : {
      phase: 'playing', players: [], hand: [], legal: [], calloutTargets: [],
      top: null, currentColor: null, direction: 1, deckCount: 0,
      pendingDraw: 0, turnId: null, roundNo: 0, log: board.log,
    };
    s.spectator = true;
    s.eliminated = this.roster.some((p) => p.id === playerId);
    s.tournament = board;
    s.you = playerId;
    s.settings = { ...this.settings, mode: 'party' };
    return s;
  }
}
