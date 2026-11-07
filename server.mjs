import { sandbox } from './sandbox.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const assetDirectory = process.env.RENDER ? './' : './dist/';
const assets = new Map(await Promise.all([
  ['/', 'index.html', 'text/html'],
  ['/style.css', 'style.css', 'text/css'],
  ['/app.js', 'app.js', 'text/javascript'],
  ['/indicators.js', 'indicators.js', 'text/javascript'],
  ['/futures.js', 'futures.js', 'text/javascript'],
  ['/exchange.js', 'exchange.js', 'text/javascript'],
  ['/react.js', 'react.js', 'text/javascript'],
  ['/react-dom.js', 'react-dom.js', 'text/javascript'],
].map(async ([route, filename, type]) => [
  route, { body: await readFile(new URL(assetDirectory + filename, import.meta.url)), type },
])));
const key = process.env.CMC_API_KEY;
const source = 'CoinMarketCap';
const refreshMs = 120000;
let cache;
let pending;
async function marketSnapshot() {
  const path = key ? '' : '/public-api';
  const url = 'https://pro-api.coinmarketcap.com' + path + '/v3/cryptocurrency/listings/latest?limit=4000';
  const response = await fetch(url, {
    headers: key ? { 'X-CMC_PRO_API_KEY': key } : {},
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(source + ' HTTP ' + response.status);
  const body = await response.json();
  const coins = body.data.map(coin => {
    const quote = Array.isArray(coin.quote) ? coin.quote.find(item => item.symbol === 'USD') : coin.quote?.USD;
    return { id: coin.id, name: coin.name, symbol: coin.symbol,
      price: quote?.price > 0 ? quote.price : null, change: quote?.percent_change_24h ?? null,
      volume: quote?.volume_24h ?? null };
  });
  if (!coins.some(coin => coin.price > 0)) throw new Error(source + ' returned no market quotes');
  return { time: Date.now(), coins, source, refreshMs };
}
const publicUrl = process.env.BIKAS_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
const publicOrigin = publicUrl ? new URL(publicUrl) : null;
if (publicOrigin && publicOrigin.protocol !== 'https:') throw new Error('BIKAS_PUBLIC_URL must use HTTPS');
const port = Number(process.env.PORT || 8787);
const localHosts = new Set(['127.0.0.1:' + port, 'localhost:' + port]);
http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  const allowedHost = publicOrigin ? req.headers.host === publicOrigin.host : localHosts.has(req.headers.host);
  const expectedOrigin = publicOrigin?.origin || 'http://' + req.headers.host;
  if (!allowedHost
      || (req.headers.origin && req.headers.origin !== expectedOrigin)
      || (req.method === 'POST' && req.headers['sec-fetch-site'] === 'cross-site')) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (req.url.startsWith('/api/sandbox/')) return sandbox(req, res);
  const asset = assets.get(req.url);
  if (asset) {
    res.writeHead(200, { 'Content-Type': asset.type + '; charset=utf-8' });
    return res.end(asset.body);
  }
  if (req.url !== '/api/markets') {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!cache || Date.now() - cache.time >= refreshMs) {
      pending ||= marketSnapshot().finally(() => { pending = null; });
      cache = await pending;
    }
    res.end(JSON.stringify(cache));
  } catch (error) {
    console.error('Market refresh failed:', error.message);
    if (cache) return res.end(JSON.stringify({ ...cache, stale: true, refreshMs: 15000 }));
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'Market feed temporarily unavailable' }));
  }
}).listen(port, publicOrigin ? '0.0.0.0' : '127.0.0.1', () => console.log('Bikas listening on port ' + port));







