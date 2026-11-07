import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const storage = new DatabaseSync(process.env.BIKAS_DB_PATH || fileURLToPath(new URL('./sandbox.sqlite', import.meta.url)));
const secureCookie = (process.env.BIKAS_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL) ? '; Secure' : '';
storage.exec('CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
const getSnapshot = storage.prepare('SELECT body FROM snapshot WHERE id = 1');
const putSnapshot = storage.prepare('INSERT OR REPLACE INTO snapshot (id, body) VALUES (1, ?)');
function load() {
  const row = getSnapshot.get();
  return row ? JSON.parse(row.body) : { users: {}, offers: [], transfers: [] };
}
const sessions = new Map();
const sessionLifetime = 8 * 60 * 60 * 1000;
let authWindow = 0;
let authAttempts = 0;
const dummySalt = randomBytes(16).toString('hex');
const dummyHash = randomBytes(64);
class RequestError extends Error {}
function money(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return NaN;
  const text = String(value);
  return /^\d{1,7}(?:\.\d{1,2})?$/.test(text) ? Math.round(Number(text) * 100) : NaN;
}
const valid = value => Number.isSafeInteger(value) && value > 0 && value <= 100000000;
const fail = message => { throw new RequestError(message); };
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
function save(next) {
  putSnapshot.run(JSON.stringify(next));
}

export async function sandbox(req, res) {
  const action = req.url.slice('/api/sandbox/'.length);
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST required' });
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return send(res, 415, { error: 'JSON required' });
    }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 8192) fail('Request too large');
    }
    let input;
    try { input = JSON.parse(body); }
    catch { fail('Invalid JSON'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Expected a JSON object');
    const token = /(?:^|;\s*)coindeck_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const now = Date.now();
    const session = sessions.get(token);
    if (session?.expires <= now) sessions.delete(token);
    if (action !== 'signup' && action !== 'login' && (!session || session.expires <= now)) {
      return send(res, 401, { error: 'Sign in first' });
    }
    const db = load();
    if (action === 'signup' || action === 'login') {
      if (now >= authWindow) {
        authWindow = now + 60000;
        authAttempts = 0;
      }
      if (++authAttempts > 12) {
        res.setHeader('Retry-After', String(Math.ceil((authWindow - now) / 1000)));
        return send(res, 429, { error: 'Too many sign-in attempts. Try again shortly.' });
      }
      const name = typeof input.name === 'string' ? input.name.trim().toLowerCase() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      if (!/^[a-z0-9_]{3,24}$/.test(name) || ['constructor', 'prototype', '__proto__'].includes(name)
          || password.length < 8 || password.length > 128) fail('Use 3–24 letters, digits or underscores and an 8–128 character password');
      let user = Object.hasOwn(db.users, name) ? db.users[name] : null;
      if (action === 'signup') {
        if (user) fail('Username already taken');
        const salt = randomBytes(16).toString('hex');
        user = { salt, hash: scryptSync(password, salt, 64).toString('hex'), usd: 1000000, credits: 100000 };
        const next = structuredClone(db);
        next.users[name] = user;
        save(next);
      } else {
        const hash = scryptSync(password, user?.salt || dummySalt, 64);
        const matches = timingSafeEqual(user ? Buffer.from(user.hash, 'hex') : dummyHash, hash);
        if (!user || !matches) fail('Invalid username or password');
      }
      for (const [id, item] of sessions) {
        if (item.expires <= now) sessions.delete(id);
      }
      const newToken = randomBytes(32).toString('hex');
      sessions.set(newToken, { name, expires: now + sessionLifetime });
      if (session) sessions.delete(token);
      res.setHeader('Set-Cookie', 'coindeck_session=' + newToken + '; HttpOnly; SameSite=Strict; Path=/api/sandbox/; Max-Age=28800' + secureCookie);
      return send(res, 200, { signedIn: true });
    }
    const { name } = session;
    if (action === 'logout') {
      sessions.delete(token);
      res.setHeader('Set-Cookie', 'coindeck_session=; HttpOnly; SameSite=Strict; Path=/api/sandbox/; Max-Age=0' + secureCookie);
      return send(res, 200, {});
    }
    const next = structuredClone(db);
    const user = next.users[name];
    const amount = money(input.amount);
    if (action === 'deposit' || action === 'withdraw') {
      if (!valid(amount) || (action === 'withdraw' && amount > user.usd)) fail('Invalid amount or insufficient test funds');
      user.usd += action === 'deposit' ? amount : -amount;
      next.transfers.unshift({ name, action, amount, time: new Date().toISOString() });
    } else if (action === 'offer') {
      const price = money(input.price);
      if (!valid(amount) || !valid(price) || amount > user.credits) fail('Invalid amount or insufficient test credits');
      user.credits -= amount;
      next.offers.unshift({ id: randomBytes(12).toString('hex'), seller: name, amount, price, status: 'Open' });
    } else if (['take', 'paid', 'release', 'cancel'].includes(action)) {
      const offer = next.offers.find(item => item.id === input.id);
      if (!offer) fail('Offer missing');
      if (action === 'take' && offer.status === 'Open' && offer.seller !== name) {
        if (user.usd < offer.price) fail('Insufficient test USD');
        user.usd -= offer.price;
        offer.buyer = name;
        offer.status = 'Reserved';
      } else if (action === 'paid' && offer.status === 'Reserved' && offer.buyer === name) {
        offer.status = 'Paid';
      } else if (action === 'release' && offer.status === 'Paid' && offer.seller === name) {
        user.usd += offer.price;
        next.users[offer.buyer].credits += offer.amount;
        offer.status = 'Released';
      } else if (action === 'cancel' && offer.status === 'Open' && offer.seller === name) {
        user.credits += offer.amount;
        offer.status = 'Canceled';
      } else if (action === 'cancel' && offer.status === 'Reserved' && offer.buyer === name) {
        user.usd += offer.price;
        delete offer.buyer;
        offer.status = 'Open';
      } else fail('This action is unavailable');
    } else if (action !== 'state') fail('Unknown action');
    if (action !== 'state') save(next);
    send(res, 200, {
      name, usd: user.usd, credits: user.credits,
      offers: next.offers.filter(o => o.status === 'Open' || o.seller === name || o.buyer === name),
      transfers: next.transfers.filter(t => t.name === name),
    });
  } catch (error) {
    if (error instanceof RequestError) return send(res, 400, { error: error.message });
    console.error('Sandbox request failed:', error.code || error.name);
    send(res, 500, { error: 'Sandbox request failed' });
  }
}

