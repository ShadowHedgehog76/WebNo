// cardtex.js — les faces de cartes, peintes sur toile puis posées sur les
// plans de la scène. Rien n'est chargé depuis le réseau : tout est dessiné.

const CACHE = new Map();
export const TEX_W = 320;
export const TEX_H = 480;

const TEINTES = {
  red:    ['#FF5B52', '#ED1C24', '#8E0F14'],
  yellow: ['#FFE95C', '#FFC900', '#B08A00'],
  green:  ['#2ED47B', '#00A651', '#00693A'],
  blue:   ['#3D9BE8', '#0071CE', '#004A81'],
  pink:   ['#FF6FB5', '#E82A7C', '#8E0A4C'],
  teal:   ['#3FD8D4', '#00A8A2', '#046B69'],
  orange: ['#FFA24D', '#F57C00', '#9C4A00'],
  purple: ['#A87BD4', '#7B2FBE', '#4A2C6B'],
  wild:   ['#3A3A46', '#17171D', '#000000'],
};

/** Coins arrondis, tracés à la main : le canvas 2D n'en propose pas. */
function coinsArrondis(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** L'ovale blanc incliné, marque de fabrique de ces cartes. */
function ovale(ctx, cx, cy, rx, ry, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.restore();
}

/* ── les symboles des cartes d'action, tracés au trait ── */
function dessineSymbole(ctx, valeur, cx, cy, taille, couleur) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = couleur;
  ctx.fillStyle = couleur;
  ctx.lineWidth = taille * 0.13;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const u = taille;

  switch (valeur) {
    case 'skip':
      ctx.beginPath();
      ctx.arc(0, 0, u * 0.52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-u * 0.37, -u * 0.37);
      ctx.lineTo(u * 0.37, u * 0.37);
      ctx.stroke();
      break;
    case 'reverse':
      // deux flèches opposées : une monte, l'autre descend
      for (const s of [1, -1]) {
        ctx.save();
        ctx.scale(s, s);
        ctx.translate(-u * 0.26, 0);
        ctx.beginPath();
        ctx.moveTo(0, u * 0.44);
        ctx.lineTo(0, -u * 0.18);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-u * 0.23, -u * 0.10);
        ctx.lineTo(0, -u * 0.48);
        ctx.lineTo(u * 0.23, -u * 0.10);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      break;
    case 'flip':
      ctx.beginPath();
      ctx.arc(0, 0, u * 0.46, Math.PI * 0.15, Math.PI * 1.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(u * 0.20, -u * 0.52);
      ctx.lineTo(u * 0.52, -u * 0.20);
      ctx.lineTo(u * 0.14, -u * 0.10);
      ctx.closePath();
      ctx.fill();
      break;
    case 'skipAll':
      ctx.beginPath();
      ctx.arc(0, 0, u * 0.52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-u * 0.37, -u * 0.37);
      ctx.lineTo(u * 0.37, u * 0.37);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(u * 0.37, -u * 0.37);
      ctx.lineTo(-u * 0.37, u * 0.37);
      ctx.stroke();
      break;
    case 'discardAll': {
      // trois cartes qui s'envolent : pleines, pour rester lisibles en petit
      const teintes = ['#FFFFFF', couleur, '#FFFFFF'];
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.translate((i - 1) * u * 0.30, (i - 1) * u * 0.10);
        ctx.rotate((i - 1) * 0.36);
        ctx.fillStyle = teintes[i];
        ctx.strokeStyle = couleur;
        ctx.lineWidth = u * 0.09;
        const w = u * 0.40, h = u * 0.60;
        ctx.beginPath();
        ctx.roundRect(-w / 2, -h / 2, w, h, u * 0.07);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    default:
      return false;
  }
  ctx.restore();
  return true;
}

/** La roue des quatre couleurs, pour les jokers. */
function roue(ctx, cx, cy, r) {
  const teintes = ['#ED1C24', '#FFC900', '#00A651', '#0071CE'];
  teintes.forEach((c, i) => {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, i * Math.PI / 2 - Math.PI / 2, (i + 1) * Math.PI / 2 - Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
  });
}

/** Texte affiché au centre : chiffre ou mention courte. */
function libelle(valeur) {
  return { draw2: '+2', wild4: '+4', draw5: '+5', draw10: '+10',
    wildDraw: '+', reverseDraw4: '+4' }[valeur] || (/^\d$/.test(valeur) ? valeur : '');
}

/**
 * Peint une face et renvoie sa toile.
 * @param pack habille la carte selon le paquet en cours
 */
export function peindreFace(color, value, pack = 'classic') {
  const cle = `${color}:${value}:${pack}`;
  if (CACHE.has(cle)) return CACHE.get(cle);

  const cv = document.createElement('canvas');
  cv.width = TEX_W; cv.height = TEX_H;
  const ctx = cv.getContext('2d');
  const [clair, vif, sombre] = TEINTES[color] || TEINTES.wild;
  const W = TEX_W, H = TEX_H, R = W * 0.11;

  // bordure de la carte : blanche d'ordinaire, noire en No Mercy
  const bord = ctx.createLinearGradient(0, 0, W, H);
  if (pack === 'nomercy') { bord.addColorStop(0, '#1C1C24'); bord.addColorStop(1, '#08080C'); }
  else if (pack === 'extreme') { bord.addColorStop(0, '#F4F7FC'); bord.addColorStop(.5, '#B9C2D2'); bord.addColorStop(1, '#EDF1F8'); }
  else { bord.addColorStop(0, '#FFFFFF'); bord.addColorStop(1, '#E8ECF5'); }
  ctx.fillStyle = bord;
  coinsArrondis(ctx, 0, 0, W, H, R);
  ctx.fill();

  // le pan de couleur
  const marge = W * 0.075;
  const inter = ctx.createLinearGradient(marge, marge, W - marge, H - marge);
  inter.addColorStop(0, clair); inter.addColorStop(0.55, vif); inter.addColorStop(1, sombre);
  ctx.save();
  coinsArrondis(ctx, marge, marge, W - marge * 2, H - marge * 2, R * 0.72);
  ctx.clip();
  ctx.fillStyle = inter;
  ctx.fillRect(0, 0, W, H);
  if (pack === 'nomercy') {
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = W * 0.03;
    for (let x = -H; x < W + H; x += W * 0.11) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H * 0.6, H); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // Extreme : un éclat métallique part du centre
  if (pack === 'extreme') {
    ctx.save();
    coinsArrondis(ctx, marge, marge, W - marge * 2, H - marge * 2, R * 0.72);
    ctx.clip();
    ctx.globalAlpha = 0.30;
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(W / 2, H / 2);
      ctx.arc(W / 2, H / 2, H, a0, a0 + Math.PI / 16);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.35)';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // le cadre chromé
    ctx.save();
    const chrome = ctx.createLinearGradient(0, 0, W, H);
    chrome.addColorStop(0, '#F6F9FF'); chrome.addColorStop(0.35, '#9AA6BA');
    chrome.addColorStop(0.5, '#EDF1F8'); chrome.addColorStop(0.72, '#7C8798');
    chrome.addColorStop(1, '#E2E8F2');
    ctx.strokeStyle = chrome;
    ctx.lineWidth = W * 0.055;
    coinsArrondis(ctx, marge * 1.35, marge * 1.35, W - marge * 2.7, H - marge * 2.7, R * 0.6);
    ctx.stroke();
    ctx.restore();
  }

  // l'ovale blanc incliné
  const incline = pack === 'nomercy' ? 0.42 : (pack === 'extreme' ? 0.24 : 0.36);
  ctx.save();
  ovale(ctx, W / 2, H / 2, W * 0.40, H * 0.40, -incline);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.restore();

  // le signe central
  const estJoker = color === 'wild';
  if (estJoker && (value === 'wild' || value === 'wild4' || value === 'wildDraw')) {
    roue(ctx, W / 2, H / 2, W * 0.20);
  }
  const txt = libelle(value);
  const encreCentre = estJoker ? '#17171D' : vif;
  if (txt && !(estJoker && value === 'wild')) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-incline * 0.55);
    ctx.font = `900 ${W * (txt.length > 2 ? 0.38 : 0.52)}px "Arial Black", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = W * 0.035;
    ctx.strokeStyle = 'rgba(0,0,0,.18)';
    if (estJoker) { ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#17171D'; ctx.lineWidth = W * 0.05; }
    else ctx.fillStyle = encreCentre;
    ctx.strokeText(txt, 0, estJoker ? H * 0.02 : 0);
    ctx.fillText(txt, 0, estJoker ? H * 0.02 : 0);
    ctx.restore();
  } else if (!txt) {
    dessineSymbole(ctx, value, W / 2, H / 2, W * 0.30, encreCentre);
  }

  // les deux coins
  ctx.fillStyle = pack === 'nomercy' ? '#FFFFFF' : '#FFFFFF';
  ctx.font = `900 ${W * 0.13}px "Arial Black", Arial, sans-serif`;
  ctx.textBaseline = 'top';
  const coin = txt || { skip: '⊘', reverse: '⇅', flip: '↻', skipAll: '⊗', discardAll: '⇊' }[value] || '★';
  ctx.textAlign = 'left';
  ctx.fillText(coin, W * 0.10, H * 0.045);
  ctx.save();
  ctx.translate(W * 0.90, H * 0.955);
  ctx.rotate(Math.PI);
  ctx.textAlign = 'left';
  ctx.fillText(coin, 0, 0);
  ctx.restore();

  // Flip : le coin replié, signature du paquet — sa couleur annonce l'autre
  // face, comme sur les vraies cartes.
  if (pack === 'flip') {
    const pli = W * 0.30;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(W - pli, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, pli * 1.5);
    ctx.closePath();
    const g2 = ctx.createLinearGradient(W - pli, 0, W, pli * 1.5);
    g2.addColorStop(0, sombre);
    g2.addColorStop(1, clair);
    ctx.fillStyle = g2;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.28)';
    ctx.lineWidth = W * 0.012;
    ctx.beginPath();
    ctx.moveTo(W - pli, 0);
    ctx.lineTo(W, pli * 1.5);
    ctx.stroke();
    ctx.restore();
  }

  CACHE.set(cle, cv);
  return cv;
}

/** Le dos, commun à toutes les cartes d'un paquet. */
export function peindreDos(pack = 'classic', side = 'light') {
  const cle = `dos:${pack}:${side}`;
  if (CACHE.has(cle)) return CACHE.get(cle);
  const cv = document.createElement('canvas');
  cv.width = TEX_W; cv.height = TEX_H;
  const ctx = cv.getContext('2d');
  const W = TEX_W, H = TEX_H, R = W * 0.11;

  const fonds = {
    classic: ['#2A2C34', '#14151C', '#08080C'],
    flip: side === 'dark' ? ['#3D2A5C', '#1E1235', '#0C0818'] : ['#2A2C34', '#14151C', '#08080C'],
    nomercy: ['#2A0B0F', '#12050A', '#06020B'],
    extreme: ['#2C3444', '#141A26', '#080B12'],
  }[pack] || ['#2A2C34', '#14151C', '#08080C'];

  ctx.fillStyle = '#FFFFFF';
  coinsArrondis(ctx, 0, 0, W, H, R);
  ctx.fill();
  const marge = W * 0.05;
  const g = ctx.createRadialGradient(W * 0.36, H * 0.2, W * 0.05, W / 2, H / 2, H * 0.7);
  g.addColorStop(0, fonds[0]); g.addColorStop(0.55, fonds[1]); g.addColorStop(1, fonds[2]);
  ctx.save();
  coinsArrondis(ctx, marge, marge, W - marge * 2, H - marge * 2, R * 0.8);
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // l'ovale rouge et le mot, comme au dos d'un vrai paquet
  // motif de fond, propre à chaque paquet
  ctx.save();
  coinsArrondis(ctx, marge, marge, W - marge * 2, H - marge * 2, R * 0.8);
  ctx.clip();
  ctx.globalAlpha = 0.16;
  if (pack === 'nomercy') {
    ctx.strokeStyle = '#FF3B30';
    ctx.lineWidth = W * 0.035;
    for (let x = -H; x < W + H; x += W * 0.13) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H * 0.55, H); ctx.stroke();
    }
  } else if (pack === 'extreme') {
    ctx.strokeStyle = '#29A3E8';
    ctx.lineWidth = W * 0.02;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.moveTo(W / 2, H / 2);
      const a = (i / 14) * Math.PI * 2;
      ctx.lineTo(W / 2 + Math.cos(a) * H, H / 2 + Math.sin(a) * H);
      ctx.stroke();
    }
  } else if (pack === 'flip') {
    ctx.strokeStyle = side === 'dark' ? '#C39BEC' : '#8FA6C8';
    ctx.lineWidth = W * 0.02;
    for (let r = W * 0.14; r < H; r += W * 0.13) {
      ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.save();
  ovale(ctx, W / 2, H / 2, W * 0.38, H * 0.21, -0.36);
  const teinteDos = {
    nomercy: ['#FF5B52', '#9E0F16'],
    extreme: ['#3D9BE8', '#004A81'],
  }[pack] || (side === 'dark' ? ['#A87BD4', '#7B2FBE'] : ['#FF5B52', '#ED1C24']);
  const og = ctx.createLinearGradient(0, H * 0.3, 0, H * 0.7);
  og.addColorStop(0, teinteDos[0]);
  og.addColorStop(1, teinteDos[1]);
  ctx.fillStyle = og;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.36);
  ctx.font = `italic 900 ${W * 0.19}px "Arial Black", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('WebNo', 0, W * 0.012);
  ctx.restore();

  CACHE.set(cle, cv);
  return cv;
}

export function viderCache() { CACHE.clear(); }
