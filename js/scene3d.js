// scene3d.js — le plateau et les cartes, en volume.
//
// Le DOM ne garde que les menus : tout ce qui se joue vit ici. La scène est
// pilotée par l'état que l'hôte diffuse ; elle ne décide de rien, elle montre.

import * as T from './vendor/three.module.min.js';
import { peindreFace, peindreDos } from './cardtex.js?v=202608241826';

/* ─────────────── réglages ─────────────── */
const CARTE = { l: 1, h: 1.5, e: 0.014 };     // largeur, hauteur, épaisseur
const TAPIS_R = 5.2;                           // rayon du feutre
const DUREE = { pose: 460, pioche: 400, donne: 300, retour: 520 };
const PILE_MAX = 5;          // cartes visibles sur la défausse
const PILE_PAS = 0.055;      // écart entre deux cartes de la pile
const OVALE = 1.34;          // la table est plus large que profonde
const MAIN_Z = 3.55;        // à quelle distance du centre le joueur tient sa main
const MAIN_ECH = 0.92;      // les cartes en main, un peu plus petites que sur table

/* ─────────────── petites animations ───────────────
   Trois courbes suffisent : une pour poser, une pour rebondir, une pour
   revenir en douceur. Pas de bibliothèque, la boucle de rendu s'en charge. */
const facile = {
  doux: (t) => 1 - Math.pow(1 - t, 3),
  ressort: (t) => 1 - Math.pow(2, -9 * t) * Math.cos(t * 13),
  rond: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

let tweens = [];
/** Anime des propriétés d'un objet ; renvoie une promesse. */
function anime(cible, vers, duree = 400, courbe = 'doux', retard = 0) {
  return new Promise((fini) => {
    const depart = {};
    tweens.push({
      demarre: null, retard, duree, courbe, cible, vers, depart, fini,
    });
  });
}
function avanceTweens(now) {
  if (!tweens.length) return;
  const restants = [];
  for (const tw of tweens) {
    if (tw.demarre === null) tw.demarre = now + tw.retard;
    if (now < tw.demarre) { restants.push(tw); continue; }
    if (!tw.pret) {
      for (const cle in tw.vers) {
        const [obj, prop] = cheminDe(tw.cible, cle);
        tw.depart[cle] = obj[prop];
      }
      tw.pret = true;
    }
    const t = Math.min(1, (now - tw.demarre) / tw.duree);
    const k = facile[tw.courbe](t);
    for (const cle in tw.vers) {
      const [obj, prop] = cheminDe(tw.cible, cle);
      obj[prop] = tw.depart[cle] + (tw.vers[cle] - tw.depart[cle]) * k;
    }
    if (t < 1) restants.push(tw); else tw.fini();
  }
  tweens = restants;
}
function cheminDe(cible, cle) {
  const bouts = cle.split('.');
  let obj = cible;
  for (let i = 0; i < bouts.length - 1; i++) obj = obj[bouts[i]];
  return [obj, bouts[bouts.length - 1]];
}
function stopTweens() { tweens = []; }

/** Saute à la fin de toutes les animations en cours. */
function finisTweens() {
  for (const tw of tweens) {
    for (const cle in tw.vers) {
      const [obj, prop] = cheminDe(tw.cible, cle);
      obj[prop] = tw.vers[cle];
    }
    tw.fini();
  }
  tweens = [];
}

/* ─────────────── la scène ─────────────── */
export class Plateau {
  constructor(canvas) {
    this.canvas = canvas;
    this.pret = false;
    this.cartes = new Map();       // id → mesh
    this.dossiers = new Map();     // id → { racine, etiquette }
    this.etat = null;
    this.pack = 'classic';
    this.side = 'light';
    this.surCarte = null;          // rappel au clic
    this.surPioche = null;
    this.survolee = null;
    this.mesTuiles = [];
    this._boucle = this._boucle.bind(this);
  }

  /** Prépare le rendu. Renvoie faux si la machine ne sait pas faire de 3D. */
  demarrer() {
    try {
      this.renderer = new T.WebGLRenderer({
        canvas: this.canvas, antialias: true, alpha: true,
        powerPreference: 'high-performance',
      });
    } catch (_) { return false; }
    if (!this.renderer) return false;

    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;

    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(42, 1, 0.1, 80);
    this.groupe = new T.Group();
    this.scene.add(this.groupe);

    this._lumieres();
    this._salle();
    this._bibliotheque();
    this._tapis();
    this._piles();
    this._fleches();

    this.horloge = new T.Clock();
    this.rayon = new T.Raycaster();
    this.souris = new T.Vector2();
    this.redimensionner();
    this.pret = true;
    this.renderer.setAnimationLoop(this._boucle);
    return true;
  }

  _lumieres() {
    this.scene.add(new T.HemisphereLight(0x6B7AA8, 0x121620, 0.86));
    const cle = new T.DirectionalLight(0xFFFBF4, 1.25);
    cle.position.set(-3.5, 8, 4.5);
    cle.castShadow = true;
    cle.shadow.mapSize.set(1024, 1024);
    cle.shadow.camera.near = 1;
    cle.shadow.camera.far = 24;
    const c = cle.shadow.camera;
    c.left = -8; c.right = 8; c.top = 8; c.bottom = -8;
    cle.shadow.bias = -0.0012;
    this.scene.add(cle);
    const appoint = new T.DirectionalLight(0x88AAFF, 0.35);
    appoint.position.set(5, 4, -5);
    this.scene.add(appoint);
  }

  /**
   * La salle autour de la table : un sol qui s'enfonce dans la pénombre, une
   * suspension au-dessus du feutre, et de la brume pour que les bords se
   * perdent au lieu de buter sur du vide noir.
   */
  _salle() {
    this.scene.fog = new T.FogExp2(0x090C15, 0.0155);
    this.scene.background = null;

    // le plancher, bien au-delà du tapis
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const x = cv.getContext('2d');
    x.fillStyle = '#14161F';
    x.fillRect(0, 0, 512, 512);
    // lattes irrégulières, pour que le sol ne soit pas une nappe unie
    for (let ligne = 0; ligne < 8; ligne++) {
      const dec = (ligne % 2) * 32;
      for (let i = -1; i < 9; i++) {
        const l = 64 + Math.random() * 26;
        const t = 26 + Math.random() * 9;
        x.fillStyle = `rgb(${t},${t + 2},${t + 7})`;
        x.fillRect(i * 64 + dec, ligne * 64, l - 2, 62);
      }
    }
    x.globalAlpha = 0.5;
    for (let i = 0; i < 2400; i++) {
      x.fillStyle = Math.random() < 0.5 ? '#000' : '#2A2E3A';
      x.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
    }
    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(9, 9);
    tex.anisotropy = 8;
    const sol = new T.Mesh(
      new T.CircleGeometry(46, 64),
      new T.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0.04 }),
    );
    sol.rotation.x = -Math.PI / 2;
    sol.position.y = -1.42;
    sol.receiveShadow = true;
    this.groupe.add(sol);

    // le pied et le fût de la table
    const pied = new T.Mesh(
      new T.CylinderGeometry(TAPIS_R * 0.30, TAPIS_R * 0.52, 1.4, 40, 1, true),
      new T.MeshStandardMaterial({ color: 0x17131A, roughness: 0.62, side: T.DoubleSide }),
    );
    pied.position.y = -0.72;
    pied.receiveShadow = true;
    this.groupe.add(pied);
    const socle = new T.Mesh(
      new T.CylinderGeometry(TAPIS_R * 0.56, TAPIS_R * 0.62, 0.16, 40),
      new T.MeshStandardMaterial({ color: 0x120F16, roughness: 0.7 }),
    );
    socle.position.y = -1.35;
    socle.receiveShadow = true;
    this.groupe.add(socle);

    // la suspension : l'abat-jour, son intérieur chaud, et le halo au sol
    const lampe = new T.Group();
    lampe.position.y = 11.2;
    this.groupe.add(lampe);
    const abat = new T.Mesh(
      new T.ConeGeometry(1.55, 0.95, 44, 1, true),
      new T.MeshStandardMaterial({ color: 0x1A1D26, roughness: 0.5, metalness: 0.35, side: T.BackSide }),
    );
    lampe.add(abat);
    const dedans = new T.Mesh(
      new T.ConeGeometry(1.52, 0.92, 44, 1, true),
      new T.MeshBasicMaterial({ color: 0xFFE9C2, side: T.FrontSide }),
    );
    dedans.position.y = 0.02;
    lampe.add(dedans);
    const tige = new T.Mesh(
      new T.CylinderGeometry(0.035, 0.035, 5, 10),
      new T.MeshStandardMaterial({ color: 0x2A2E3A, roughness: 0.5 }),
    );
    tige.position.y = 3.1;
    lampe.add(tige);
    const ampoule = new T.PointLight(0xFFF1DC, 165, 30, 2.0);
    ampoule.position.y = -0.6;
    lampe.add(ampoule);
    this.lampe = lampe;

    // un cône de lumière visible, qui donne son épaisseur à l'air de la salle
    const faisceau = new T.Mesh(
      new T.ConeGeometry(TAPIS_R * 1.15, 10.4, 40, 1, true),
      new T.MeshBasicMaterial({
        color: 0xFFEBC8, transparent: true, opacity: 0.030,
        side: T.BackSide, depthWrite: false, blending: T.AdditiveBlending,
      }),
    );
    faisceau.position.y = 5.1;
    this.groupe.add(faisceau);

    this.chaises = new T.Group();
    this.groupe.add(this.chaises);
    this._boisChaise = new T.MeshStandardMaterial({ color: 0x4A3A50, roughness: 0.68 });
  }

  /**
   * Une chaise par joueur, posée sur l'ovale, dossier vers l'extérieur —
   * on s'assied face à la table, pas dos à elle.
   */
  _majChaises(n) {
    if (this._chaisesN === n) return;
    this._chaisesN = n;
    while (this.chaises.children.length) this.chaises.remove(this.chaises.children[0]);
    const bois = this._boisChaise;
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (i / n) * Math.PI * 2;
      const rx = (TAPIS_R * OVALE + 1.5), rz = (TAPIS_R + 1.5);
      const x = Math.cos(a) * rx, z = Math.sin(a) * rz;
      const chaise = new T.Group();
      chaise.position.set(x, -0.98, z);
      // le dossier regarde le dehors : on fait face au centre
      chaise.rotation.y = -Math.atan2(z, x) - Math.PI / 2;

      const assise = new T.Mesh(new T.BoxGeometry(1.15, 0.17, 1.08), bois);
      assise.castShadow = assise.receiveShadow = true;
      chaise.add(assise);
      const dossier = new T.Mesh(new T.BoxGeometry(1.15, 1.35, 0.15), bois);
      dossier.position.set(0, 0.75, 0.50);       // derrière celui qui s'assied
      dossier.castShadow = true;
      chaise.add(dossier);
      for (const [px, pz] of [[-0.46, 0.44], [0.46, 0.44], [-0.46, -0.44], [0.46, -0.44]]) {
        const p = new T.Mesh(new T.CylinderGeometry(0.065, 0.055, 0.88, 8), bois);
        p.position.set(px, -0.52, pz);
        chaise.add(p);
      }
      this.chaises.add(chaise);
    }
  }

  /**
   * Une bibliothèque en fond de salle : des rayonnages garnis de livres aux
   * dos irréguliers. C'est peint sur une toile puis appliqué à plat — mille
   * volumes en volume coûteraient cher pour un décor qu'on ne fait qu'entrevoir.
   */
  _bibliotheque() {
    const L = 1024, H = 1024;
    const cv = document.createElement('canvas');
    cv.width = L; cv.height = H;
    const x = cv.getContext('2d');
    x.fillStyle = '#150F12';
    x.fillRect(0, 0, L, H);

    const rayons = 6;
    const hR = H / rayons;
    const teintes = ['#7A2E2A', '#2E4A6B', '#3E5B39', '#6B5426', '#4A2E5B',
                     '#6B3A2E', '#2E5B58', '#5B4A2E', '#3A3550', '#6B2E4A'];
    for (let r = 0; r < rayons; r++) {
      const y0 = r * hR;
      // le fond du rayonnage
      x.fillStyle = '#0E0A0D';
      x.fillRect(0, y0, L, hR);
      // les livres, largeurs et hauteurs irrégulières
      let px = 6 + Math.random() * 10;
      while (px < L - 14) {
        const w = 13 + Math.random() * 30;
        const h = hR * (0.58 + Math.random() * 0.32);
        const t = teintes[(Math.random() * teintes.length) | 0];
        const pench = Math.random() < 0.06;
        x.save();
        x.translate(px, y0 + hR - 14);
        if (pench) x.rotate(-0.12 - Math.random() * 0.1);
        x.fillStyle = t;
        x.fillRect(0, -h, w, h);
        // le liseré du dos, et parfois un titre doré
        x.fillStyle = 'rgba(0,0,0,.32)';
        x.fillRect(0, -h, 3, h);
        x.fillStyle = 'rgba(255,255,255,.10)';
        x.fillRect(w - 3, -h, 2, h);
        if (w > 20 && Math.random() < 0.55) {
          x.fillStyle = 'rgba(214,184,110,.62)';
          x.fillRect(4, -h * 0.72, w - 9, 3);
          if (Math.random() < 0.5) x.fillRect(4, -h * 0.34, w - 9, 2);
        }
        x.restore();
        px += w + 1 + Math.random() * 3;
      }
      // la planche
      x.fillStyle = '#241A20';
      x.fillRect(0, y0 + hR - 14, L, 14);
      x.fillStyle = 'rgba(255,255,255,.06)';
      x.fillRect(0, y0 + hR - 14, L, 2);
    }
    // les montants
    x.fillStyle = '#241A20';
    x.fillRect(0, 0, 12, H);
    x.fillRect(L - 12, 0, 12, H);
    // la pénombre du bas, pour fondre avec le sol
    const g = x.createLinearGradient(0, H * 0.62, 0, H);
    g.addColorStop(0, 'rgba(8,10,18,0)');
    g.addColorStop(1, 'rgba(8,10,18,.92)');
    x.fillStyle = g;
    x.fillRect(0, H * 0.62, L, H * 0.38);

    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    tex.wrapS = T.RepeatWrapping;
    tex.repeat.set(3, 1);
    tex.anisotropy = 8;
    // Un mur courbe plutôt que des pans plats : assemblés, ceux-ci formaient
    // un couloir dont les bords venaient barrer la table.
    tex.repeat.set(6, 1);
    const mur = new T.Mesh(
      new T.CylinderGeometry(15.5, 15.5, 8.8, 64, 1, true, Math.PI * 0.30, Math.PI * 1.40),
      new T.MeshStandardMaterial({ map: tex, roughness: 0.92, side: T.BackSide }),
    );
    mur.position.y = 2.9;
    mur.receiveShadow = true;
    this.groupe.add(mur);
    // une lueur rasante, pour que les rayonnages sortent de l'ombre
    const veilleuse = new T.PointLight(0xC9B48A, 26, 26, 1.7);
    veilleuse.position.set(0, 4.4, -9.5);
    this.groupe.add(veilleuse);
  }

  /** Le feutre, sa bordure et la marque au centre. */  /** Le feutre, sa bordure et la marque au centre. */
  _tapis() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1024;
    const x = cv.getContext('2d');
    const g = x.createRadialGradient(512, 400, 40, 512, 512, 620);
    g.addColorStop(0, '#1E7A4C');
    g.addColorStop(0.55, '#136A40');
    g.addColorStop(1, '#06301F');
    x.fillStyle = g;
    x.fillRect(0, 0, 1024, 1024);
    // grain, pour que le feutre ne soit pas une surface morte
    x.globalAlpha = 0.045;
    for (let i = 0; i < 5200; i++) {
      x.fillStyle = i % 2 ? '#000' : '#9FE8C0';
      x.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
    }
    x.globalAlpha = 1;
    x.strokeStyle = 'rgba(255,255,255,.13)';
    x.lineWidth = 3;
    x.setLineDash([14, 12]);
    x.beginPath(); x.arc(512, 512, 388, 0, Math.PI * 2); x.stroke();
    x.setLineDash([]);
    x.save();
    x.translate(512, 512);
    x.rotate(-0.3);
    x.globalAlpha = 0.07;
    x.font = 'italic 900 190px "Arial Black", Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#FFFFFF';
    x.fillText('WebNo', 0, 0);
    x.restore();

    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    tex.anisotropy = 8;
    const feutre = new T.Mesh(
      new T.CircleGeometry(TAPIS_R, 96),
      new T.MeshStandardMaterial({ map: tex, roughness: 0.94, metalness: 0 }),
    );
    feutre.rotation.x = -Math.PI / 2;
    feutre.scale.x = OVALE;
    feutre.receiveShadow = true;
    this.groupe.add(feutre);

    const bord = new T.Mesh(
      new T.TorusGeometry(TAPIS_R + 0.04, 0.13, 18, 120),
      new T.MeshStandardMaterial({ color: 0x3A1C22, roughness: 0.38, metalness: 0.28 }),
    );
    bord.rotation.x = -Math.PI / 2;
    bord.scale.x = OVALE;
    bord.position.y = -0.02;
    bord.castShadow = bord.receiveShadow = true;
    this.groupe.add(bord);
  }

  /** Pioche et défausse, au centre. */
  _piles() {
    this.pioche = new T.Group();
    this.pioche.position.set(-0.92, 0, 0);
    this.groupe.add(this.pioche);
    this.defausse = new T.Group();
    this.defausse.position.set(0.92, 0, 0);
    this.groupe.add(this.defausse);
    this._refaitPioche(24);
  }

  _refaitPioche(n) {
    while (this.pioche.children.length) {
      const m = this.pioche.children.pop();
      m.geometry.dispose?.();
    }
    const hauteur = Math.max(3, Math.min(26, n));
    for (let i = 0; i < hauteur; i++) {
      const m = this._mesh(null, true);
      m.position.y = i * CARTE.e * 1.05 + 0.01;
      m.rotation.y = (Math.random() - 0.5) * 0.03;
      m.userData.pioche = true;
      this.pioche.add(m);
    }
  }

  /** L'anneau qui dit dans quel sens on tourne. */
  _fleches() {
    this.anneau = new T.Group();
    this.groupe.add(this.anneau);
    const forme = new T.Shape();
    forme.moveTo(0, 0.30); forme.lineTo(-0.22, -0.10);
    forme.lineTo(0, 0.02); forme.lineTo(0.22, -0.10);
    forme.closePath();
    const geo = new T.ExtrudeGeometry(forme, { depth: 0.05, bevelEnabled: false });
    geo.center();
    const mat = new T.MeshStandardMaterial({
      color: 0xFFFFFF, emissive: 0x556677, emissiveIntensity: 0.35,
      roughness: 0.5, transparent: true, opacity: 0.62,
    });
    this.flechesMat = mat;
    for (let i = 0; i < 8; i++) {
      const f = new T.Mesh(geo, mat);
      const a = (i / 8) * Math.PI * 2;
      f.position.set(Math.cos(a) * 2.55, 0.012, Math.sin(a) * 2.55);
      f.rotation.x = -Math.PI / 2;
      f.userData.angle = a;
      this.anneau.add(f);
    }
  }

  /* ── fabrication d'une carte ── */
  _materiaux(card, verso) {
    if (!this._geo) this._geo = new T.BoxGeometry(CARTE.l, CARTE.e, CARTE.h);
    const tranche = new T.MeshStandardMaterial({ color: 0xF2F4F8, roughness: 0.75, transparent: true, opacity: 0.9 });
    const face = (cv) => {
      const t = new T.CanvasTexture(cv);
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 8;
      // Les coins de la toile sont transparents ; sans « alphaTest » ils se
      // peignaient en noir au lieu d'être découpés.
      return new T.MeshStandardMaterial({
        map: t, roughness: 0.62, metalness: 0.02,
        transparent: true, alphaTest: 0.5,
      });
    };
    const dessus = verso || !card
      ? face(peindreDos(this.pack, this.side))
      : face(peindreFace(card.color, card.value, this.pack));
    const dessous = face(peindreDos(this.pack, this.side));
    // ordre des faces d'une boîte : +x, -x, +y, -y, +z, -z
    return [tranche, tranche, dessus, dessous, tranche, tranche];
  }

  _mesh(card, verso = false) {
    if (!this._geo) this._geo = new T.BoxGeometry(CARTE.l, CARTE.e, CARTE.h);
    const m = new T.Mesh(this._geo, this._materiaux(card, verso));
    m.castShadow = true;
    m.receiveShadow = false;
    m.userData.card = card;
    return m;
  }

  /** Ce que l'interface recouvre, en haut et en bas, en pixels. */
  reserve(haut, bas) {
    if (haut === this.margeHaut && bas === this.margeBas) return;
    this.margeHaut = haut;
    this.margeBas = bas;
    this._placeCamera();
  }

  redimensionner() {
    if (!this.pret) return;
    const l = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.renderer.setSize(l, h, false);
    this.camera.aspect = l / h;
    this.camera.updateProjectionMatrix();
    this._placeCamera();
  }

  /**
   * Cadre la scène par le calcul plutôt qu'à coups de valeurs choisies au
   * jugé : on donne le rectangle à faire tenir, la caméra recule ce qu'il
   * faut pour l'englober — en hauteur comme en largeur, sur tout écran.
   */
  _placeCamera() {
    const l = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const ratio = l / h;

    // ce qu'il faut voir : la table, et devant elle la main du joueur
    let zAvant, zArriere, demiLarge, incline;
    if (this.vueManette) {
      zAvant = MAIN_Z + 1.5; zArriere = MAIN_Z - 2.2; demiLarge = 3.4; incline = 0.62;
    } else if (this.vueEcran) {
      zAvant = TAPIS_R + 0.7; zArriere = -TAPIS_R - 0.7;
      demiLarge = TAPIS_R * OVALE + 0.7; incline = 0.86;
    } else {
      zAvant = MAIN_Z + 1.35; zArriere = -TAPIS_R - 0.5;
      demiLarge = TAPIS_R * OVALE + 0.3; incline = 0.62;
    }

    const profondeur = zAvant - zArriere;
    const centreZ = (zAvant + zArriere) / 2;
    const fov = (this.camera.fov * Math.PI) / 180;

    // distance pour tenir en hauteur, puis en largeur ; on garde la plus grande
    const vue = profondeur * Math.cos(incline) + 1.1;      // hauteur apparente
    const dH = (vue / 2) / Math.tan(fov / 2);
    const dL = (demiLarge / Math.tan(fov / 2)) / ratio;
    const dist = Math.max(dH, dL) * 1.06;

    this._cadre = { incline, centreZ, dist };
    this._poseCamera(dist, incline, centreZ);
    this._ajusteCadre();
  }

  /**
   * La formule cadre un rectangle à plat ; les cartes sont dressées et
   * s'étalent. On projette donc ce qui est réellement là et on recule tant
   * que quelque chose sort — la seule mesure qui dise ce que l'on voit.
   */
  _ajusteCadre() {
    const c = this._cadre;
    if (!c) return;
    const coins = [];
    // on vise la place d'arrivée, pas celle du vol en cours : sans quoi le
    // cadre oscillerait à chaque carte qui bouge
    const ajoute = (m, dx, dz) => {
      if (!m || !m.visible) return;
      const r = m.userData.repos;
      const pos = r
        ? new T.Vector3(r['position.x'], r['position.y'], r['position.z'])
        : m.getWorldPosition(new T.Vector3());
      const rot = r
        ? new T.Euler(r['rotation.x'] || 0, r['rotation.y'] || 0, r['rotation.z'] || 0)
        : m.rotation;
      for (const sx of [-dx, dx]) for (const sz of [-dz, dz]) {
        const v = new T.Vector3(sx, 0, sz);
        v.applyEuler(rot).multiplyScalar(m.scale.x || 1);
        v.add(pos);
        coins.push(v);
      }
    };
    for (const m of this.cartes.values()) ajoute(m, CARTE.l / 2, CARTE.h / 2);
    for (const d of this.dossiers.values()) {
      for (const m of d.cartes) ajoute(m, CARTE.l / 2, CARTE.h / 2);
      if (d.etiquette) ajoute(d.etiquette, 0.68, 0.20);
    }
    ajoute(this.defausse.children[this.defausse.children.length - 1], CARTE.l / 2, CARTE.h / 2);
    ajoute(this.pioche.children[this.pioche.children.length - 1], CARTE.l / 2, CARTE.h / 2);
    if (!coins.length) return;

    // La toile occupe tout l'écran, mais l'interface flotte par-dessus : on
    // garde le jeu dans la bande restée libre entre la barre et les commandes.
    const h = this.canvas.clientHeight || 1;
    const hautLibre = 1 - (2 * (this.margeHaut || 0)) / h;
    const basLibre = 1 - (2 * (this.margeBas || 0)) / h;
    let dist = c.dist;
    for (let essai = 0; essai < 18; essai++) {
      let pire = 0;
      for (const v of coins) {
        const p = v.clone().project(this.camera);
        pire = Math.max(pire, Math.abs(p.x) - 0.965,
          p.y - Math.min(0.965, hautLibre), -p.y - Math.min(0.965, basLibre));
      }
      if (pire <= 0) break;
      dist *= 1 + Math.min(0.12, pire * 0.6);
      this._poseCamera(dist, c.incline, c.centreZ);
    }
    c.dist = dist;
  }

  _poseCamera(dist, incline, centreZ) {
    this.camera.position.set(0, Math.sin(incline) * dist, centreZ + Math.cos(incline) * dist);
    this.camera.lookAt(0, 0, centreZ);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
  }

  _boucle() {
    this.images = (this.images || 0) + 1;
    // La toile change de taille sans toujours prévenir : bascule de mode,
    // barre du navigateur, rotation. On surveille plutôt que d'attendre.
    const l = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (l && h && (l !== this._l || h !== this._h)) {
      this._l = l; this._h = h;
      this.redimensionner();
    }
    const now = performance.now();
    avanceTweens(now);
    const t = this.horloge.getElapsedTime();
    if (this.anneau) {
      const sens = this.etat && this.etat.direction === -1 ? -1 : 1;
      this.anneau.children.forEach((f, i) => {
        const a = f.userData.angle + t * 0.22 * sens;
        f.position.x = Math.cos(a) * 2.55;
        f.position.z = Math.sin(a) * 2.55;
        f.rotation.z = -a + (sens > 0 ? Math.PI : 0);
        f.material.opacity = 0.34 + 0.30 * Math.sin(t * 2 + i * 0.7) ** 2;
      });
    }
    // les plaques restent lisibles quel que soit l'angle du siège
    for (const d of this.dossiers.values()) {
      if (d.etiquette) d.etiquette.quaternion.copy(this.camera.quaternion);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /* ═══════════════ synchronisation avec la partie ═══════════════
     La scène compare ce qu'elle montre à ce que l'hôte annonce, puis anime
     la différence : une carte qui apparaît sur la défausse y vole depuis la
     main de son propriétaire, une main qui grandit reçoit ses cartes. */

  /** Point d'entrée : appelé à chaque nouvel état reçu. */
  appliquer(state) {
    if (!this.pret || !state) return;
    const avant = this.etat;
    this.etat = state;
    const changePack = state.pack !== this.pack || state.side !== this.side;
    this.pack = state.pack || 'classic';
    this.side = state.side || 'light';
    this.vueEcran = !!(state.party && state.spectator);
    this.vueManette = !!(state.party && !state.spectator);
    this._modeVue();
    if (changePack) { this._repeindreTout(); this._placeCamera(); }

    this._majChaises(Math.max(4, state.players.length));
    this._placeAdversaires(state);
    this._majDefausse(state, avant);
    this._majMain(state, avant);
    this._majPioche(state);
    this._ajusteCadre();
  }

  /** En manette, seule la main compte : la table s'efface. */
  _modeVue() {
    const montreTable = !this.vueManette;
    if (this._tableVisible === montreTable) return;
    this._tableVisible = montreTable;
    for (const o of this.groupe.children) {
      if (o === this.anneau) { o.visible = montreTable; continue; }
      if (o === this.pioche || o === this.defausse) { o.visible = montreTable; continue; }
      if (o.geometry && (o.geometry.type === 'CircleGeometry' || o.geometry.type === 'TorusGeometry')) {
        o.visible = montreTable;
      }
    }
    for (const d of this.dossiers.values()) {
      d.racine.visible = montreTable;
      if (d.etiquette) d.etiquette.visible = montreTable;
    }
    this._placeCamera();
  }

  /** Mène toutes les animations à leur terme, sans attendre. */
  finirAnimations() { finisTweens(); this._ajusteCadre(); }

  /** Remet la scène à zéro entre deux manches. */
  reinitialise() {
    stopTweens();
    for (const m of this.cartes.values()) this.groupe.remove(m);
    this.cartes.clear();
    while (this.defausse.children.length) this.defausse.remove(this.defausse.children[0]);
    for (const d of this.dossiers.values()) {
      this.groupe.remove(d.racine);
      if (d.etiquette) this.groupe.remove(d.etiquette);
    }
    this.dossiers.clear();
    this.etat = null;
  }

  /** Le paquet a changé : toutes les faces sont refaites. */
  _repeindreTout() {
    for (const m of this.cartes.values()) {
      m.material.forEach((mm) => mm.map && mm.map.dispose());
      m.material = this._materiaux(m.userData.card, m.userData.verso);
    }
    this._refaitPioche(this.etat ? this.etat.deckCount : 20);
  }

  /* ── la défausse ── */
  _majDefausse(state, avant) {
    const top = state.top;
    if (!top) return;
    const dejaLa = this.defausse.children.length
      && this.defausse.children[this.defausse.children.length - 1].userData.cardId === top.id;
    if (dejaLa) return;

    // La pile garde une hauteur bornée : au-delà de cinq cartes, la plus
    // ancienne s'efface et les autres descendent d'un cran. Sans quoi les
    // suivantes se poseraient à la même hauteur et se mordraient.
    if (this.defausse.children.length >= PILE_MAX) {
      const vieille = this.defausse.children[0];
      this.defausse.remove(vieille);
      vieille.material.forEach((mm) => { mm.transparent = true; });
      for (const reste of this.defausse.children) {
        anime(reste, { 'position.y': reste.position.y - PILE_PAS }, 220, 'doux');
      }
    }

    const m = this._mesh(top, false);
    m.userData.cardId = top.id;
    m.userData.card = top;
    const rang = this.defausse.children.length;
    const cible = {
      'position.y': 0.014 + rang * PILE_PAS,
      'rotation.y': (Math.random() - 0.5) * 0.5,
    };

    // d'où vient-elle ? de la main de celui qui vient de jouer
    const depart = this._origineDe(state, avant);
    m.position.copy(depart.pos);
    m.rotation.set(depart.rot.x, depart.rot.y, depart.rot.z);
    this.defausse.add(m);
    m.position.sub(this.defausse.position);

    // Un seul mouvement, pas deux enchaînés : la courbe « ressort » dépasse
    // la pile puis y revient, et l'état final est atteint même si l'on force
    // la fin de l'animation.
    anime(m, {
      'position.x': 0, 'position.z': 0,
      'rotation.x': 0, 'rotation.z': 0,
      'rotation.y': cible['rotation.y'],
    }, DUREE.pose, 'rond');
    anime(m, { 'position.y': cible['position.y'] }, DUREE.pose + 120, 'ressort');
  }

  /** La place d'où la carte s'envole : la main du joueur qui l'a posée. */
  _origineDe(state, avant) {
    const pos = new T.Vector3(0, 2.4, 0);
    const rot = new T.Euler(0, 0, 0);
    const joueur = state.players.find((p) => p.id === state.lastPlayed)
      || (avant && state.players.find((p) => p.id === avant.turnId));
    if (joueur) {
      const d = this.dossiers.get(joueur.id);
      if (d) {
        pos.set(d.racine.position.x, 0.9, d.racine.position.z);
        rot.set(-0.7, d.racine.rotation.y, 0);
      } else if (joueur.id === state.you) {
        pos.set(0, 1.2, 4.4);
        rot.set(-1.1, 0, 0);
      }
    }
    return { pos, rot };
  }

  /* ── ma main, en éventail devant la caméra ── */
  _majMain(state, avant) {
    const mienne = state.hand || [];
    const vus = new Set();
    const jouables = new Set(state.legal || []);

    mienne.forEach((c, i) => {
      vus.add(c.id);
      let m = this.cartes.get(c.id);
      const neuve = !m;
      const signature = `${c.color}:${c.value}:${c.chosen || ''}`;
      if (m && m.userData.signature !== signature) {
        // même carton, autre face : on la repeint (retournement Flip)
        m.material.forEach((mm) => mm.map && mm.map.dispose());
        m.material = this._materiaux(c, false);
        m.userData.card = c;
        m.userData.signature = signature;
      }
      if (neuve) {
        m = this._mesh(c, false);
        m.userData.cardId = c.id;
        m.userData.signature = signature;
        m.userData.mienne = true;
        this.groupe.add(m);
        this.cartes.set(c.id, m);
        // elle arrive de la pioche
        m.position.set(this.pioche.position.x, 0.35, this.pioche.position.z);
        m.rotation.set(0, 0, 0);
      }
      const p = this._placeEnMain(i, mienne.length);
      const cible = {
        'position.x': p.x, 'position.y': p.y, 'position.z': p.z,
        'rotation.x': p.rx, 'rotation.y': 0, 'rotation.z': p.rz,
      };
      m.userData.repos = { ...cible };
      m.userData.jouable = jouables.includes ? jouables.includes(c.id) : jouables.has(c.id);
      // Une carte injouable s'éteint. On l'assombrit plutôt que de la rendre
      // translucide : la transparence laisserait voir le tapis au travers et
      // trierait mal les faces.
      const eteinte = state.turnId === state.you && !m.userData.jouable;
      const teinte = eteinte ? 0x7C8290 : 0xFFFFFF;
      m.material.forEach((mm) => { if (mm.color) mm.color.setHex(teinte); });
      m.scale.setScalar(MAIN_ECH);
      anime(m, cible, neuve ? DUREE.donne : 240, neuve ? 'ressort' : 'doux',
        neuve ? i * 45 : 0);
    });

    // les cartes qui ont quitté la main
    for (const [id, m] of [...this.cartes]) {
      if (vus.has(id) || !m.userData.mienne) continue;
      this.cartes.delete(id);
      anime(m, { 'position.y': m.position.y + 0.9, 'rotation.x': -1.4 }, 260, 'doux')
        .then(() => { this.groupe.remove(m); });
      m.material.forEach((mm) => { mm.transparent = true; });
      anime({ o: 1 }, { o: 0 }, 260).then(() => {});
    }
  }

  /** Position d'une carte dans l'éventail. */
  _placeEnMain(i, total) {
    const large = Math.min(7.4, Math.max(1.4, total * 0.86));
    const pas = total > 1 ? large / (total - 1) : 0;
    const x = total > 1 ? -large / 2 + i * pas : 0;
    const centre = total > 1 ? (i - (total - 1) / 2) / ((total - 1) / 2 || 1) : 0;
    return {
      x,
      y: 0.72 - Math.abs(centre) * 0.08,
      z: MAIN_Z + Math.abs(centre) * 0.18,
      rx: 0.80,
      rz: -centre * 0.18,
    };
  }

  /* ── les autres joueurs, tout autour ── */
  _placeAdversaires(state) {
    const autres = state.players.filter((p) => p.id !== state.you);
    const total = autres.length;
    const vus = new Set();

    autres.forEach((p, i) => {
      vus.add(p.id);
      let d = this.dossiers.get(p.id);
      if (!d) {
        const racine = new T.Group();
        this.groupe.add(racine);
        d = { racine, cartes: [], etiquette: null };
        this.dossiers.set(p.id, d);
      }
      // en vue « écran », le tour complet ; sinon l'arc face à nous
      // le joueur occupe le devant (z positif) : les autres se rangent sur
      // l'arc opposé, du plus à gauche au plus à droite
      const a = this.vueEcran
        ? (i / total) * Math.PI * 2 + Math.PI / 2
        : Math.PI + ((i + 1) / (total + 1)) * Math.PI;
      const r = TAPIS_R * 0.80;
      d.racine.position.set(Math.cos(a) * r * OVALE, 0.02, Math.sin(a) * r);
      d.racine.rotation.y = -Math.atan2(Math.sin(a), Math.cos(a) * OVALE) - Math.PI / 2;

      this._majEventail(d, p, state);
      this._majEtiquette(d, p, state);
      if (d.etiquette) {
        d.etiquette.position.set(d.racine.position.x * 1.05, 0.74, d.racine.position.z * 1.05);
      }
    });

    for (const [id, d] of [...this.dossiers]) {
      if (vus.has(id)) continue;
      this.groupe.remove(d.racine);
      if (d.etiquette) this.groupe.remove(d.etiquette);
      this.dossiers.delete(id);
    }
  }

  /** L'éventail d'un adversaire : verso, sauf s'il est de notre camp. */
  _majEventail(d, p, state) {
    const ouvertes = (state.allyHands && state.allyHands[p.id]) || null;
    const n = Math.min(p.handCount, 12);
    while (d.cartes.length > n) {
      const m = d.cartes.pop();
      d.racine.remove(m);
    }
    while (d.cartes.length < n) {
      const m = this._mesh(null, true);
      m.userData.verso = true;
      d.racine.add(m);
      d.cartes.push(m);
      m.scale.setScalar(0.01);
      anime(m, { 'scale.x': 0.62, 'scale.y': 0.62, 'scale.z': 0.62 }, 260, 'ressort');
    }
    d.cartes.forEach((m, i) => {
      const c = ouvertes && ouvertes[i];
      const sig = c ? `${c.color}:${c.value}` : 'dos';
      if (m.userData.signature !== sig) {
        m.material.forEach((mm) => mm.map && mm.map.dispose());
        m.material = this._materiaux(c || null, !c);
        m.userData.signature = sig;
        m.userData.card = c || null;
      }
      const large = Math.min(1.5, n * 0.20);
      const x = n > 1 ? -large / 2 + (i * large) / (n - 1) : 0;
      const centre = n > 1 ? (i - (n - 1) / 2) / ((n - 1) / 2) : 0;
      m.scale.setScalar(0.62);
      anime(m, {
        'position.x': x, 'position.y': 0.30 - Math.abs(centre) * 0.03,
        'position.z': -0.10, 'rotation.x': 1.05, 'rotation.z': -centre * 0.24,
      }, 240, 'doux');
    });
  }

  /** La plaque avec le nom, le score et l'état du joueur. */
  _majEtiquette(d, p, state) {
    const actif = state.turnId === p.id;
    const cle = [p.name, p.handCount, p.score, actif, p.out, p.mustCallUno,
      p.connected, p.partyCount].join('|');
    if (d.cle === cle) {
      if (d.etiquette) d.etiquette.position.y = 0.62 + (actif ? 0.06 : 0);
      return;
    }
    d.cle = cle;
    if (d.etiquette) { this.groupe.remove(d.etiquette); d.etiquette.material.map.dispose(); }

    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 148;
    const x = cv.getContext('2d');
    const r = 26;
    x.beginPath();
    x.moveTo(r, 0); x.arcTo(512, 0, 512, 148, r); x.arcTo(512, 148, 0, 148, r);
    x.arcTo(0, 148, 0, 0, r); x.arcTo(0, 0, 512, 0, r); x.closePath();
    x.fillStyle = p.out ? 'rgba(40,8,12,.94)' : (actif ? 'rgba(28,26,10,.95)' : 'rgba(10,12,18,.90)');
    x.fill();
    x.lineWidth = 5;
    x.strokeStyle = p.out ? '#8E0F14' : (actif ? '#FFC900' : 'rgba(255,255,255,.16)');
    x.stroke();

    const AV = ['#ED1C24', '#0071CE', '#00A651', '#FFC900'];
    x.fillStyle = AV[(p.seat || 0) % 4];
    x.beginPath();
    x.roundRect(20, 28, 92, 92, 22);
    x.fill();
    x.fillStyle = (p.seat % 4) === 3 ? '#2E2400' : '#FFFFFF';
    x.font = 'italic 900 54px "Arial Black", Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText((p.name || '?').slice(0, 1).toUpperCase(), 66, 76);

    x.textAlign = 'left';
    x.fillStyle = p.out ? '#C99' : '#FFFFFF';
    x.font = '700 46px Arial, sans-serif';
    x.fillText((p.name || '').slice(0, 13), 132, 56);
    x.font = '600 34px Arial, sans-serif';
    x.fillStyle = '#9AA3B4';
    const bouts = [`${p.handCount} carte${p.handCount > 1 ? 's' : ''}`, `${p.score} pt`];
    if (p.partyCount) bouts.push(`${p.partyCount} party`);
    if (p.isBot) bouts.push('bot');
    if (!p.connected) bouts.push('hors ligne');
    x.fillText(bouts.join(' · '), 132, 108);
    if (p.out) {
      x.fillStyle = '#FF6B62';
      x.font = 'italic 900 40px "Arial Black", Arial, sans-serif';
      x.textAlign = 'right';
      x.fillText('ÉLIMINÉ', 492, 84);
    } else if (p.mustCallUno) {
      x.fillStyle = '#FFC900';
      x.font = 'italic 900 44px "Arial Black", Arial, sans-serif';
      x.textAlign = 'right';
      x.fillText('UNO !', 492, 84);
    }

    const tex = new T.CanvasTexture(cv);
    tex.colorSpace = T.SRGBColorSpace;
    const plaque = new T.Mesh(
      new T.PlaneGeometry(1.30, 0.376),
      new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    // La plaque est fille du plateau, pas du siège : rattachée au siège, son
    // orientation vers la caméra hériterait de la rotation de celui-ci et
    // les joueurs du bas se liraient à l'envers.
    plaque.position.copy(d.racine.position);
    plaque.position.y = 0.72;
    plaque.position.multiplyScalar(1.0);
    this.groupe.add(plaque);
    d.etiquette = plaque;
  }

  _majPioche(state) {
    const veut = Math.max(3, Math.min(26, Math.round((state.deckCount || 20) / 4)));
    if (this._piocheN === veut) return;
    this._piocheN = veut;
    this._refaitPioche(veut);
  }

  /* ═══════════════ le doigt et la souris ═══════════════
     Un rayon part du curseur : ce qu'il touche en premier est ce qu'on
     désigne. C'est ce qui remplace les clics du DOM. */

  brancherEntrees() {
    const c = this.canvas;
    const point = (ev) => {
      const r = c.getBoundingClientRect();
      const t = ev.touches ? ev.touches[0] : ev;
      this.souris.x = ((t.clientX - r.left) / r.width) * 2 - 1;
      this.souris.y = -((t.clientY - r.top) / r.height) * 2 + 1;
    };
    const viser = () => {
      this.rayon.setFromCamera(this.souris, this.camera);
      const cibles = [...this.cartes.values(), ...this.pioche.children];
      const touches = this.rayon.intersectObjects(cibles, false);
      return touches.length ? touches[0].object : null;
    };

    c.addEventListener('pointermove', (ev) => {
      point(ev);
      const o = viser();
      const carte = o && o.userData.mienne ? o : null;
      if (this.survolee === carte) return;
      if (this.survolee) this._souleve(this.survolee, false);
      this.survolee = carte;
      if (carte) this._souleve(carte, true);
      c.style.cursor = o ? 'pointer' : 'default';
    });
    c.addEventListener('pointerleave', () => {
      if (this.survolee) this._souleve(this.survolee, false);
      this.survolee = null;
    });
    c.addEventListener('pointerdown', (ev) => {
      point(ev);
      this._appuye = viser();
    });
    c.addEventListener('pointerup', (ev) => {
      point(ev);
      const o = viser();
      if (!o || o !== this._appuye) { this._appuye = null; return; }
      this._appuye = null;
      if (o.userData.pioche) { this.surPioche && this.surPioche(); return; }
      if (o.userData.mienne && o.userData.card) {
        this.surCarte && this.surCarte(o.userData.card, o);
      }
    });
  }

  /** La carte survolée sort de l'éventail. */
  _souleve(m, oui) {
    const r = m.userData.repos;
    if (!r) return;
    if (m.userData.jouable === false) {
      m.material.forEach((mm) => mm.color && mm.color.setHex(oui ? 0xB6BCC8 : 0x7C8290));
    }
    anime(m, {
      'position.y': r['position.y'] + (oui ? 0.42 : 0),
      'position.z': r['position.z'] - (oui ? 0.30 : 0),
      'rotation.x': r['rotation.x'] + (oui ? 0.30 : 0),
    }, 180, 'doux');
  }

  /* ═══════════════ effets ═══════════════ */

  /** Marque la carte choisie avant de l'envoyer. */
  selectionne(cardId) {
    for (const [id, m] of this.cartes) {
      const choisie = id === cardId;
      const r = m.userData.repos;
      if (!r) continue;
      anime(m, {
        'position.y': r['position.y'] + (choisie ? 0.55 : 0),
        'position.z': r['position.z'] - (choisie ? 0.38 : 0),
      }, 170, 'doux');
    }
  }

  /** Retournement du paquet Flip : la table bascule. */
  animeRetournement() {
    const g = this.groupe;
    anime(g, { 'rotation.z': Math.PI }, DUREE.retour, 'rond')
      .then(() => { g.rotation.z = 0; this._repeindreTout(); });
  }

  /** Une pénalité tombe : la pioche tressaille. */
  animePenalite() {
    const p = this.pioche;
    anime(p, { 'position.y': 0.35 }, 120, 'doux')
      .then(() => anime(p, { 'position.y': 0 }, 260, 'ressort'));
  }

  /** Quelqu'un gagne : le tapis respire. */
  animeVictoire() {
    anime(this.groupe, { 'scale.x': 1.04, 'scale.y': 1.04, 'scale.z': 1.04 }, 260, 'doux')
      .then(() => anime(this.groupe, { 'scale.x': 1, 'scale.y': 1, 'scale.z': 1 }, 420, 'ressort'));
  }

  detruire() {
    stopTweens();
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
    }
    this.pret = false;
  }
}
