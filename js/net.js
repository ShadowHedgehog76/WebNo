// net.js — couche pair-à-pair (WebRTC via PeerJS)
// Topologie en étoile : l'hôte est l'autorité, les joueurs lui envoient leurs actions.

const PREFIX = 'webno-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I/O/0/1

export function makeCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export function normalizeCode(str) {
  return (str || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

/**
 * Code de room contenu dans un texte scanné : soit l'ancre d'un lien
 * d'invitation, soit le code seul. Tout le reste est rejeté — mieux vaut
 * ne rien trouver que d'inventer un code à partir d'un lien quelconque.
 */
export function codeFromScan(text) {
  const raw = String(text || '').trim();
  const hash = raw.match(/#([A-Za-z0-9]{5})(?![A-Za-z0-9])/);
  if (hash) return normalizeCode(hash[1]);
  if (/^[A-Za-z0-9]{5}$/.test(raw)) return normalizeCode(raw);
  return null;
}

class Emitter {
  constructor() { this._h = {}; }
  on(evt, fn) { (this._h[evt] ||= []).push(fn); return this; }
  emit(evt, ...args) { (this._h[evt] || []).forEach((fn) => fn(...args)); }
}

function peerOptions() {
  return {
    debug: 0,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
      ],
    },
  };
}

/** Hôte : ouvre une room identifiée par un code court. */
export class HostNet extends Emitter {
  constructor() {
    super();
    this.peer = null;
    this.code = null;
    this.conns = new Map(); // peerId -> DataConnection
  }

  /** Ouvre la room ; réessaie avec un autre code si celui-ci est déjà pris. */
  open(attempts = 6) {
    return new Promise((resolve, reject) => {
      const tryOnce = (left) => {
        const code = makeCode();
        const peer = new window.Peer(PREFIX + code, peerOptions());
        let settled = false;

        peer.on('open', () => {
          settled = true;
          this.peer = peer;
          this.code = code;
          this._wire();
          resolve(code);
        });

        peer.on('error', (err) => {
          if (settled) { this.emit('error', err); return; }
          peer.destroy();
          if (err.type === 'unavailable-id' && left > 0) tryOnce(left - 1);
          else reject(err);
        });
      };
      tryOnce(attempts);
    });
  }

  _wire() {
    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        this.emit('open', conn.peer);
      });
      conn.on('data', (msg) => this.emit('message', conn.peer, msg));
      conn.on('close', () => {
        this.conns.delete(conn.peer);
        this.emit('close', conn.peer);
      });
      conn.on('error', () => {
        this.conns.delete(conn.peer);
        this.emit('close', conn.peer);
      });
    });
    this.peer.on('disconnected', () => {
      if (this.peer && !this.peer.destroyed) this.peer.reconnect();
    });
  }

  send(peerId, msg) {
    const c = this.conns.get(peerId);
    if (c && c.open) { try { c.send(msg); } catch (_) { /* lien coupé */ } }
  }

  broadcast(msg) {
    for (const id of this.conns.keys()) this.send(id, msg);
  }

  kick(peerId) {
    const c = this.conns.get(peerId);
    if (c) { try { c.send({ t: 'kicked' }); } catch (_) {} setTimeout(() => c.close(), 120); }
    this.conns.delete(peerId);
  }

  close() {
    for (const c of this.conns.values()) { try { c.close(); } catch (_) {} }
    this.conns.clear();
    if (this.peer) this.peer.destroy();
    this.peer = null;
  }
}

/** Joueur : se connecte à la room de l'hôte via son code. */
export class ClientNet extends Emitter {
  constructor() {
    super();
    this.peer = null;
    this.conn = null;
  }

  connect(code, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(null, peerOptions());
      let settled = false;
      const fail = (e) => { if (!settled) { settled = true; try { peer.destroy(); } catch (_) {} reject(e); } };
      const timer = setTimeout(() => fail(new Error('Room introuvable ou hôte injoignable.')), timeoutMs);

      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        conn.on('open', () => {
          clearTimeout(timer);
          settled = true;
          this.peer = peer;
          this.conn = conn;
          conn.on('data', (msg) => this.emit('message', msg));
          conn.on('close', () => this.emit('close'));
          conn.on('error', () => this.emit('close'));
          resolve(conn);
        });
        conn.on('error', (e) => { clearTimeout(timer); fail(e); });
      });

      peer.on('error', (err) => {
        clearTimeout(timer);
        if (err.type === 'peer-unavailable') fail(new Error('Aucune room avec ce code.'));
        else fail(err);
      });
    });
  }

  send(msg) {
    if (this.conn && this.conn.open) { try { this.conn.send(msg); } catch (_) {} }
  }

  close() {
    if (this.conn) { try { this.conn.close(); } catch (_) {} }
    if (this.peer) this.peer.destroy();
    this.conn = null;
    this.peer = null;
  }
}
