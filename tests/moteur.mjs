// Les règles du jeu, indépendamment de tout affichage.
import { UnoGame, MERCY_LIMIT } from '../js/engine.js';
import { buildDeck, buildFlipDeck, buildNoMercyDeck, cardCatalog, PACKS, MODES } from '../js/deck.js';
import { PARTY_CARDS, buildPartyDeck } from '../js/party.js';
import { botDecide, botParty, botCallout } from '../js/bot.js';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => { c ? (pass++, console.log('  ✓ ' + l)) : (fail++, console.log('  ✗ ' + l + (e ? ' → ' + e : ''))); };
const table = (n = 4, s = {}) => {
  const g = new UnoGame(Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'J' + i, isBot: true })), s);
  g.startRound();
  return g;
};

console.log('\n▸ Les paquets');
ok(buildDeck(1).length === 108, 'le paquet classique compte 108 cartes', String(buildDeck(1).length));
ok(buildFlipDeck(1).length === 116, 'le paquet Flip en compte 116', String(buildFlipDeck(1).length));
ok(buildNoMercyDeck(1).length > 108, 'No Mercy en compte davantage', String(buildNoMercyDeck(1).length));
ok(PACKS.length === 4, 'quatre paquets proposés');
ok(MODES.length === 5, 'cinq modes, dossiers compris');
ok(PARTY_CARDS.length === 8, 'huit cartes party');
ok(buildPartyDeck(12).length >= 24, 'la pioche party suit la tablée');

console.log('\n▸ Poser une carte');
{
  const g = table(4);
  const j = g.current;
  g.discard = [{ id: 'top', color: 'red', value: '5' }];
  g.currentColor = 'red';
  j.hand = [{ id: 'a', color: 'red', value: '9' }, { id: 'b', color: 'blue', value: '3' }];
  ok(g.handle(j.id, { type: 'play', cardId: 'a' }).ok, 'même couleur : accepté');
  const k = g.current;
  k.hand = [{ id: 'c', color: 'green', value: '2' }];
  ok(!g.handle(k.id, { type: 'play', cardId: 'c' }).ok, 'couleur et chiffre différents : refusé');
}

console.log('\n▸ Accumulation des pioches');
{
  const g = table(4, { stacking: true });
  const j = g.current;
  g.discard = [{ id: 't', color: 'red', value: '5' }];
  g.currentColor = 'red';
  // on garde une carte de rab : vider sa main terminerait la manche
  j.hand = [{ id: 'd1', color: 'red', value: 'draw2' }, { id: 'z', color: 'green', value: '4' }];
  g.handle(j.id, { type: 'play', cardId: 'd1' });
  ok(g.pendingDraw === 2, 'un +2 met deux cartes en attente', String(g.pendingDraw));
  const k = g.current;
  k.hand = [{ id: 'd2', color: 'blue', value: 'draw2' }, { id: 'z2', color: 'green', value: '4' }];
  g.handle(k.id, { type: 'play', cardId: 'd2' });
  ok(g.pendingDraw === 4, 'le suivant peut renchérir', String(g.pendingDraw));
}

console.log('\n▸ La règle du 7-0');
{
  const g = table(4, { sevenZero: true });
  const j = g.current, cible = g.players[(j.seat + 2) % 4];
  g.discard = [{ id: 't', color: 'red', value: '5' }];
  g.currentColor = 'red';
  const mienne = [{ id: 'x', color: 'blue', value: '1' }];
  j.hand = [{ id: 's7', color: 'red', value: '7' }, ...mienne];
  const sienne = cible.hand.map((c) => c.id).join();
  g.handle(j.id, { type: 'play', cardId: 's7', targetId: cible.id });
  ok(j.hand.map((c) => c.id).join() === sienne, 'le 7 échange les mains');
}

console.log('\n▸ No Mercy : l\'élimination');
{
  const g = table(4, { pack: 'nomercy' });
  const v = g.players[1];
  g.giveCards(v, MERCY_LIMIT - v.hand.length);
  ok(v.out === true, `passé ${MERCY_LIMIT} cartes, on quitte la manche`);
  ok(g.stateFor(v.id).eliminated === true, 'et la vue du joueur le dit');
  ok(!g.handle(v.id, { type: 'draw' }).ok, 'ses actions sont refusées');
  ok(g.stateFor(v.id).legal.length === 0, 'plus aucun coup légal');
}

console.log('\n▸ Party : la seconde main');
{
  const g = table(12, { mode: 'party' });
  ok(g.players.every((p) => p.party.length === 2), 'chacun démarre avec deux cartes party');
  const v = g.stateFor('p0');
  ok(v.partyHand.length === 2, 'le joueur voit les siennes');
  ok(v.players[1].party === undefined, 'et pas celles des autres');
  const j = g.current;
  j.party = [{ id: 'tst', party: 'bouclier' }];
  j.partyPlayed = false;
  ok(g.handle(j.id, { type: 'party', cardId: 'tst' }).ok, 'une carte party se joue');
  ok(j.shield === true, 'son effet s\'applique');
  ok(g.current.id === j.id, 'sans consommer le tour');
}

console.log('\n▸ Des parties menées à terme');
for (const [n, s] of [[4, {}], [8, { mode: 'team', teamSize: 4 }], [12, { mode: 'party' }],
                      [4, { pack: 'flip' }], [4, { pack: 'nomercy' }], [4, { pack: 'extreme' }]]) {
  let souci = null, coups = 0;
  for (let essai = 0; essai < 4 && !souci; essai++) {
    const g = table(n, { ...s, winCondition: 'single', stacking: true, sevenZero: true, jumpIn: true, unoRule: true });
    let pas = 0;
    while (g.phase === 'playing' && pas++ < 40000) {
      const cur = g.current;
      const pa = botParty(g, cur);
      if (pa && g.handle(cur.id, pa).ok) continue;
      const r = g.handle(cur.id, botDecide(g, cur));
      if (!r.ok && !g.handle(cur.id, { type: 'draw' }).ok && !g.handle(cur.id, { type: 'pass' }).ok) {
        souci = 'blocage : ' + r.error; break;
      }
    }
    coups += pas;
    if (pas >= 40000) souci = 'boucle sans fin';
    else if (!g.roundResult) souci = 'aucun vainqueur';
  }
  const quoi = s.mode || s.pack || 'classique';
  ok(!souci, `${n} joueurs, ${quoi} : 4 parties bouclées (${Math.round(coups / 4)} coups)`, souci || '');
}

console.log('\n▸ Le catalogue des cartes');
for (const p of ['classic', 'flip', 'nomercy', 'extreme']) {
  const c = cardCatalog({ pack: p, stacking: true, sevenZero: true, unoRule: true, bluff: false });
  ok(c.length > 5 && c.every((e) => e.name && e.desc), `le paquet ${p} décrit ses ${c.length} cartes`);
}

console.log(`\n${pass} tests réussis, ${fail} échec(s).`);
process.exit(fail ? 1 : 0);
