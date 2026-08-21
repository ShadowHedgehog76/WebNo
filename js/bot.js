// bot.js — IA des joueurs virtuels (exécutée chez l'hôte)
import { isWild, isNumber, colorsOf } from './deck.js';

const LEVELS = {
  easy:   { smart: 0.15, uno: 0.55, callout: 0.15, jump: 0.10, challenge: 0.2, delay: [900, 1600] },
  normal: { smart: 0.80, uno: 0.92, callout: 0.60, jump: 0.45, challenge: 0.5, delay: [700, 1400] },
  hard:   { smart: 1.00, uno: 1.00, callout: 0.95, jump: 0.85, challenge: 0.9, delay: [450, 1000] },
};

export function botProfile(level) { return LEVELS[level] || LEVELS.normal; }

export function botDelay(level) {
  const [a, b] = botProfile(level).delay;
  return a + Math.random() * (b - a);
}

/** Compte les couleurs d'une main, faces actives uniquement. */
function countColors(game, hand) {
  const c = {};
  for (const col of colorsOf(game.side)) c[col] = 0;
  for (const card of hand) {
    const f = game.face(card);
    if (!isWild(f) && c[f.color] !== undefined) c[f.color]++;
  }
  return c;
}

function bestColor(game, hand) {
  const cols = colorsOf(game.side);
  const c = countColors(game, hand);
  let best = cols[Math.floor(Math.random() * cols.length)];
  let max = -1;
  for (const col of cols) {
    if (c[col] > max) { max = c[col]; best = col; }
  }
  return best;
}

/** Adversaire (hors coéquipier) le plus proche de la victoire. */
function threat(game, bot) {
  const foes = game.players.filter((p) => p.id !== bot.id && !game.areAllies(bot, p));
  return foes.sort((a, b) => a.hand.length - b.hand.length)[0] || null;
}

function nextPlayer(game) {
  const n = game.players.length;
  return game.players[((game.turnIndex + game.direction) % n + n) % n];
}

function prevPlayer(game) {
  const n = game.players.length;
  return game.players[((game.turnIndex - game.direction) % n + n) % n];
}

/**
 * Note une carte jouable : plus c'est haut, plus c'est souhaitable.
 */
function scoreCard(game, bot, card) {
  const next = nextPlayer(game);
  const nextIsAlly = game.areAllies(bot, next);
  const nextClose = next.hand.length <= 2;
  const colors = countColors(game, bot.hand);
  const myCount = bot.hand.length;
  const f = game.face(card);
  let s = 0;

  switch (f.value) {
    case 'draw2':
      s = nextIsAlly ? -25 : 40 + (nextClose ? 30 : 0);
      break;
    case 'draw5':
      s = nextIsAlly ? -40 : 55 + (nextClose ? 35 : 0);
      break;
    case 'skipAll':
      s = 45 + (myCount <= 3 ? 25 : 0);       // on rejoue : toujours bon
      break;
    case 'wildDraw':
      s = nextIsAlly ? -45 : 20 + (nextClose ? 50 : 0) + (myCount <= 2 ? 30 : 0);
      break;
    case 'flip':
      // retourner brouille tout le monde : intéressant si notre autre face est fournie
      s = 26 + (myCount <= 3 ? 14 : 0);
      break;
    case 'wild4':
      // gardée en réserve, sauf si l'adversaire suivant est dangereux
      s = nextIsAlly ? -35 : 12 + (nextClose ? 45 : 0) + (myCount <= 2 ? 30 : 0);
      break;
    case 'wild':
      s = 10 + (myCount <= 2 ? 35 : 0);
      break;
    case 'skip':
      s = nextIsAlly ? -20 : 35 + (nextClose ? 25 : 0);
      break;
    case 'reverse': {
      const prev = prevPlayer(game);
      const prevIsAlly = game.areAllies(bot, prev);
      if (game.players.length === 2) s = 35;
      else s = (nextIsAlly && !prevIsAlly) ? 38 : (nextIsAlly ? 5 : 25);
      break;
    }
    case '7':
      if (game.settings.sevenZero) {
        const t = threat(game, bot);
        const gain = t ? myCount - t.hand.length : 0;
        s = gain > 1 ? 30 + gain * 8 : (myCount <= 2 ? -30 : 5);
      } else s = 20;
      break;
    case '0':
      if (game.settings.sevenZero) {
        const n = game.players.length;
        const giver = game.players[((bot.seat - game.direction) % n + n) % n];
        const gain = myCount - giver.hand.length;
        s = gain > 1 ? 25 + gain * 6 : (myCount <= 2 ? -25 : 8);
      } else s = 22;
      break;
    default:
      s = 20 + Number(f.value) * 0.4; // se débarrasser des grosses valeurs
  }

  // Bonus : jouer dans sa couleur dominante préserve la flexibilité
  if (!isWild(f)) s += (colors[f.color] || 0) * 2.5;
  // Malus : ne pas gaspiller sa dernière carte d'une couleur si on a mieux
  if (!isWild(f) && colors[f.color] === 1 && myCount > 3) s -= 4;
  return s;
}

/** Choisit avec qui échanger sa main lors d'un 7. */
function pickSwapTarget(game, bot, prof) {
  const foes = game.players.filter((p) => p.id !== bot.id);
  if (!foes.length) return null;
  const smart = foes
    .filter((p) => !game.areAllies(bot, p))
    .sort((a, b) => a.hand.length - b.hand.length)[0];
  const pick = Math.random() > prof.smart
    ? foes[Math.floor(Math.random() * foes.length)]
    : (smart || foes[0]);
  return pick.id;
}

/** Choisit une action pour le bot dont c'est le tour. Renvoie null si rien à faire. */
export function botDecide(game, bot) {
  const prof = botProfile(game.settings.botLevel);
  const legal = game.legalCardsFor(bot);

  if (legal.length === 0) {
    if (game.pendingDraw > 0 && game.settings.bluff && game.pendingKind === 'wild4'
        && Math.random() < prof.challenge * 0.4) {
      return { type: 'challenge' };
    }
    if (game.pendingDraw > 0) return { type: 'draw' };
    if (game.drawnCardId) return { type: 'pass' };
    return { type: 'draw' };
  }

  const cards = legal.map((id) => bot.hand.find((c) => c.id === id));
  let chosen;
  if (Math.random() > prof.smart) {
    chosen = cards[Math.floor(Math.random() * cards.length)];
  } else {
    chosen = cards
      .map((c) => ({ c, s: scoreCard(game, bot, c) }))
      .sort((a, b) => b.s - a.s)[0].c;
  }

  const action = { type: 'play', cardId: chosen.id };
  const cf = game.face(chosen);

  if (isWild(cf)) {
    const cols = colorsOf(game.side);
    action.color = Math.random() > prof.smart
      ? cols[Math.floor(Math.random() * cols.length)]
      : bestColor(game, bot.hand.filter((c) => c.id !== chosen.id));
  }

  if (game.settings.sevenZero && cf.value === '7') {
    action.targetId = pickSwapTarget(game, bot, prof);
  }

  // Annonce UNO en même temps que la pose
  if (bot.hand.length === 2 && Math.random() < prof.uno) action.uno = true;

  return action;
}

/** Le bot tente-t-il de poser à la volée ? Renvoie une action ou null. */
export function botJumpIn(game, bot) {
  if (!game.settings.jumpIn || game.phase !== 'playing') return null;
  if (bot.id === game.current.id || game.pendingDraw > 0) return null;
  const prof = botProfile(game.settings.botLevel);
  if (Math.random() > prof.jump) return null;
  const card = bot.hand.find((c) => game.canJumpIn(bot, c));
  if (!card) return null;
  const action = { type: 'play', cardId: card.id };
  if (game.settings.sevenZero && game.face(card).value === '7') {
    action.targetId = pickSwapTarget(game, bot, prof);
    if (!action.targetId) return null;
  }
  if (bot.hand.length === 2 && Math.random() < prof.uno) action.uno = true;
  return action;
}

/** Le bot dénonce-t-il un joueur qui a oublié de dire UNO ? */
export function botCallout(game, bot) {
  if (!game.settings.unoRule || game.phase !== 'playing') return null;
  const prof = botProfile(game.settings.botLevel);
  const target = game.players.find(
    (p) => p.mustCallUno && p.id !== bot.id && !game.areAllies(bot, p)
  );
  if (!target) return null;
  if (Math.random() > prof.callout) return null;
  return { type: 'callout', targetId: target.id };
}
