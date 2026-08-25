// plateau2d.js — le plateau sans volume, pour les appareils qui n'affichent
// pas de 3D et pour la manette du mode party.
//
// Même rôle que scene3d : on lui donne l'état, il montre. Les cartes sont ici
// des éléments du document, ce qui les rend tactiles sans effort.

import { peindreFace, peindreDos } from './cardtex.js?v=202608251351';

const $ = (id) => document.getElementById(id);

/* Les cartes portent ici le même dessin qu'en volume : la toile est peinte
   une fois, puis servie en image. Deux jeux de dessins pour une seule carte,
   l'un pour le relief et l'autre pour le plat, finissaient par diverger. */
const IMAGES = new Map();
function image(color, value, pack, verso) {
  const cle = verso ? `dos:${pack}:${value}` : `${color}:${value}:${pack}`;
  let url = IMAGES.get(cle);
  if (!url) {
    const cv = verso ? peindreDos(pack, value) : peindreFace(color, value, pack);
    url = cv.toDataURL('image/png');
    IMAGES.set(cle, url);
  }
  return url;
}

/** Une carte, à plat. */
export function carte2d(c, opts = {}) {
  const el = document.createElement('div');
  el.className = 'c2';
  const pack = opts.pack || 'classic';
  if (opts.verso || !c) {
    el.classList.add('verso');
    el.style.backgroundImage = `url("${image(null, opts.side || 'light', pack, true)}")`;
    return el;
  }
  el.dataset.cardId = c.id;
  el.style.backgroundImage = `url("${image(c.color, c.value, pack)}")`;
  if (c.chosen) {
    const marque = document.createElement('i');
    marque.className = 'c2-choix ' + c.chosen;
    el.appendChild(marque);
  }
  return el;
}

export class Plateau2d {
  constructor(hote) {
    this.hote = hote;
    this.cartes = new Map();
    this.surCarte = null;
    this.surPioche = null;
    this.pret = false;
    this.etat = null;
  }

  demarrer() {
    this.hote.innerHTML = `
      <div class="p2-sieges" id="p2-sieges"></div>
      <div class="p2-centre">
        <span class="p2-sens" id="p2-sens" aria-hidden="true"></span>
        <button class="p2-pioche" id="p2-pioche" title="Piocher">
          <span id="p2-dos"></span><em id="p2-reste"></em>
        </button>
        <div class="p2-defausse" id="p2-defausse"></div>
      </div>
      <div class="p2-main" id="p2-main"></div>`;
    $('p2-pioche').onclick = () => this.surPioche && this.surPioche();
    this.pret = true;
    return true;
  }

  appliquer(state) {
    if (!this.pret || !state) return;
    this.etat = state;
    this.hote.dataset.pack = state.pack || 'classic';
    this.hote.classList.toggle('cote-sombre', state.side === 'dark');
    this._sieges(state);
    this._centre(state);
    this._main(state);
  }

  /** Les adversaires, en bandeau : chacun son avatar et son compte. */
  _sieges(state) {
    const hote = $('p2-sieges');
    if (!hote) return;
    const autres = state.players.filter((p) => p.id !== state.you);
    const cle = autres.map((p) => [p.id, p.name, p.handCount, p.score, p.out,
      p.mustCallUno, state.turnId === p.id].join(':')).join('|');
    if (hote.dataset.cle === cle) return;
    hote.dataset.cle = cle;
    hote.innerHTML = '';
    for (const p of autres) {
      const box = document.createElement('div');
      box.className = 'p2-siege';
      box.classList.toggle('actif', state.turnId === p.id);
      box.classList.toggle('sorti', !!p.out);
      const av = document.createElement('i');
      av.className = 'p2-av a' + (p.seat % 4);
      av.textContent = (p.name || '?').slice(0, 1).toUpperCase();
      const nom = document.createElement('b');
      nom.textContent = p.name;
      const n = document.createElement('span');
      n.className = 'p2-n';
      n.textContent = p.handCount;
      box.append(av, nom, n);
      if (p.out) { const s = document.createElement('u'); s.textContent = 'éliminé'; box.appendChild(s); }
      else if (p.mustCallUno) { const s = document.createElement('u'); s.className = 'uno'; s.textContent = 'UNO'; box.appendChild(s); }
      hote.appendChild(box);
    }
  }

  _centre(state) {
    const pack = state.pack || 'classic';
    // le dos suit le paquet, et le côté en pack Flip
    const dos = $('p2-dos');
    const sigDos = pack + ':' + (state.side || 'light');
    if (dos.dataset.sig !== sigDos) {
      dos.dataset.sig = sigDos;
      dos.innerHTML = '';
      dos.appendChild(carte2d(null, { verso: true, pack, side: state.side }));
    }
    // les flèches disent dans quel sens on tourne
    const sens = $('p2-sens');
    sens.className = 'p2-sens' + (state.direction === -1 ? ' inverse' : '');
    if (!sens.childElementCount) {
      for (let i = 0; i < 8; i++) {
        const f = document.createElement('i');
        f.style.setProperty('--i', String(i));
        sens.appendChild(f);
      }
    }
    $('p2-reste').textContent = state.deckCount;
    $('p2-pioche').classList.toggle('active',
      state.canDraw || (state.pendingDraw > 0 && state.turnId === state.you));
    const pile = $('p2-defausse');
    const sig = state.top
      ? [state.top.id, state.top.color, state.top.value, state.top.chosen || '', pack].join(':')
      : '';
    if (pile.dataset.sig === sig) return;
    pile.dataset.sig = sig;
    pile.innerHTML = '';
    if (state.top) {
      const el = carte2d(state.top, { pack });
      el.classList.add('posee');
      pile.appendChild(el);
    }
    pile.style.setProperty('--teinte', state.currentColor || 'transparent');
  }

  /** La main : défilante, chaque carte se touche. */
  _main(state) {
    const hote = $('p2-main');
    const pack = state.pack || 'classic';
    const legaux = new Set(state.legal || []);
    const vus = new Set();
    const monTour = state.turnId === state.you && state.phase === 'playing';

    for (const c of state.hand) {
      vus.add(c.id);
      const sig = `${c.color}:${c.value}:${c.chosen || ''}:${pack}`;
      let el = this.cartes.get(c.id);
      if (el && el.dataset.sig !== sig) { el.remove(); this.cartes.delete(c.id); el = null; }
      if (!el) {
        el = carte2d(c, { pack });
        el.dataset.sig = sig;
        el.addEventListener('click', () => {
          if (this.etat && this.etat.eliminated) return;
          this.surCarte && this.surCarte(c, el);
        });
        hote.appendChild(el);
        this.cartes.set(c.id, el);
      }
      el.classList.toggle('jouable', legaux.has(c.id));
      el.classList.toggle('eteinte', monTour && !legaux.has(c.id));
    }
    for (const [id, el] of [...this.cartes]) {
      if (vus.has(id)) continue;
      el.remove();
      this.cartes.delete(id);
    }
    // l'ordre du document suit celui de la main
    state.hand.forEach((c) => {
      const el = this.cartes.get(c.id);
      if (el) hote.appendChild(el);
    });
  }

  selectionne(id) {
    for (const [cid, el] of this.cartes) el.classList.toggle('choisie', cid === id);
    const el = id && this.cartes.get(id);
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }); } catch (_) {}
    }
  }

  reinitialise() {
    this.cartes.clear();
    if ($('p2-main')) $('p2-main').innerHTML = '';
    if ($('p2-defausse')) { $('p2-defausse').innerHTML = ''; $('p2-defausse').dataset.sig = ''; }
    if ($('p2-sieges')) { $('p2-sieges').innerHTML = ''; $('p2-sieges').dataset.cle = ''; }
  }

  // la scène en volume expose ces gestes : ici, ils n'ont pas d'objet
  finirAnimations() {}
  redimensionner() {}
  reserve() {}
  animeRetournement() {}
  animePenalite() {}
  animeVictoire() {}
  detruire() { this.pret = false; }
}
