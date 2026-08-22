// party.js — les cartes party : une seconde main, pour les grandes tablées.
// Elles ne se posent pas sur la défausse et ne suivent pas les couleurs ;
// elles se déclenchent en plus d'un tour normal, une par tour au maximum.

export const PARTY_SIZE = { min: 8, max: 32 };
export const PARTY_START = 2;      // cartes party distribuées au départ
export const PARTY_MAX = 5;        // on n'en accumule pas indéfiniment

/**
 * Chaque carte dit ce qu'elle fait et sur quoi elle a besoin d'être visée.
 * `cible` : null, 'joueur' (n'importe qui d'autre) ou 'adverse'.
 */
export const PARTY_CARDS = [
  {
    id: 'tempete', name: 'Tempête', icon: '🌪',
    tagline: 'Tout le monde pioche une carte, sauf vous.',
    cible: null, teinte: 'orage',
  },
  {
    id: 'sniper', name: 'Visée', icon: '🎯',
    tagline: 'Le joueur de votre choix pioche trois cartes.',
    cible: 'joueur', teinte: 'rouge',
  },
  {
    id: 'bouclier', name: 'Bouclier', icon: '🛡',
    tagline: 'Annule la prochaine pénalité qui vous vise.',
    cible: null, teinte: 'bleu',
  },
  {
    id: 'contagion', name: 'Contagion', icon: '☣',
    tagline: 'Vos deux voisins piochent deux cartes chacun.',
    cible: null, teinte: 'vert',
  },
  {
    id: 'grandvent', name: 'Grand vent', icon: '🌀',
    tagline: 'Toutes les mains changent de propriétaire et passent au voisin.',
    cible: null, teinte: 'violet',
  },
  {
    id: 'raccourci', name: 'Raccourci', icon: '⏩',
    tagline: 'Le tour saute les trois prochains joueurs.',
    cible: null, teinte: 'jaune',
  },
  {
    id: 'cadeau', name: 'Cadeau', icon: '🎁',
    tagline: 'Offrez une de vos cartes au joueur de votre choix.',
    cible: 'joueur', teinte: 'rose',
  },
  {
    id: 'echange', name: 'Troc', icon: '🔄',
    tagline: 'Échangez votre main avec celle du joueur de votre choix.',
    cible: 'joueur', teinte: 'turquoise',
  },
];

export const partyById = (id) => PARTY_CARDS.find((c) => c.id === id);

let pid = 0;
/** Pioche party : un paquet mélangé, proportionné à la tablée. */
export function buildPartyDeck(joueurs) {
  const parExemplaire = Math.max(2, Math.ceil((joueurs * (PARTY_START + 3)) / PARTY_CARDS.length));
  const deck = [];
  for (const modele of PARTY_CARDS) {
    for (let i = 0; i < parExemplaire; i++) {
      deck.push({ id: 'pty' + (++pid), party: modele.id });
    }
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
