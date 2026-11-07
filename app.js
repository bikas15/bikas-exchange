function initializeTerminal() {
const el = id => document.getElementById(id);
const demo = [
  [1,'Bitcoin','BTC',68000,2.4], [1027,'Ethereum','ETH',3500,-1.1],
  [5426,'Solana','SOL',155,4.3], [1839,'BNB','BNB',590,.8],
  [52,'XRP','XRP',.58,-2], [74,'Dogecoin','DOGE',.14,3.6],
].map(([id,name,symbol,price,change]) => ({id,name,symbol,price,change}));
let coins = demo, selected = 1, mode = 'demo', feed = 'Simulated feed · updates every 5 seconds';
let simulationPaused = false;
let priceSource = '';
let marketPage = 0;
const marketPageSize = 20;
let marketSort = "rank";
let chartRange = 60;
let candleMinutes = 5;
const history = new Map();
const demoStart = Date.now();
const demoHistory = new Map(demo.map(c => [
  c.id,
  Array.from({ length: 480 }, (_, i) => ({
    time: demoStart - (479 - i) * 300000,
    price: c.price * (1 + (479 - i) / 479 * (Math.sin(i * .24) * .045 - c.change / 100)),
  })),
]));
const wallets = {};
let watchlist;
try { watchlist = new Set(JSON.parse(localStorage.getItem('coindeck-watchlist')) || []); }
catch { watchlist = new Set(); }
const fresh = () => ({ cash: 10000, positions: {}, orders: [] });
function wallet() {
  if (!wallets[mode]) {
    try { wallets[mode] = JSON.parse(localStorage.getItem('coindeck-' + mode)) || fresh(); }
    catch { wallets[mode] = fresh(); }
  }
  return wallets[mode];
}
function save() {
  try { localStorage.setItem('coindeck-' + mode, JSON.stringify(wallet())); }
  catch { el('message').textContent = 'Browser storage unavailable. Orders last until reload.'; }
}
const usd = n => n.toLocaleString('en-US', {style:'currency',currency:'USD',maximumFractionDigits: n < 1 ? 8 : 2});
const coin = () => coins.find(c => c.id === selected) || coins[0];
const available = (side, id) => {
  const w = wallet();
  const reserved = w.orders.filter(o => o.status === 'Open' && o.side === side && (side === 'buy' || o.id === id))
    .reduce((sum,o) => sum + (side === 'buy' ? o.quantity * o.limit : o.quantity), 0);
  return Math.max(0,(side === 'buy' ? w.cash : (w.positions[id]?.quantity || 0)) - reserved);
};
function fill(order, price) {
  const w = wallet();
  const position = w.positions[order.id] ||= {symbol:order.symbol,quantity:0,cost:0,realized:0};
  const cost = order.quantity * price;
  if (order.side === 'buy') {
    w.cash = Math.max(0, w.cash - cost);
    position.quantity += order.quantity;
    position.cost += cost;
  } else {
    const basis = position.cost * Math.min(1, order.quantity / position.quantity);
    w.cash += cost;
    position.quantity = Math.max(0, position.quantity - order.quantity);
    position.cost = Math.max(0, position.cost - basis);
    position.realized += cost - basis;
  }
  order.price = price;
  order.status = 'Filled';
  order.filledAt = new Date().toISOString();
}
function orderTriggered(order, price) {
  if (order.type === 'stop') return price <= order.stop;
  if (order.type === 'bracket') return price <= order.stop || price >= order.target;
  return order.side === 'buy' ? price <= order.limit : price >= order.limit;
}
function settle() {
  for (const order of wallet().orders) {
    const quote = coins.find(c => c.id === order.id);
    if (order.status === 'Open' && quote?.price > 0 && orderTriggered(order, quote.price)) {
      fill(order, quote.price);
    }
  }
  save();
}
function markets() {
  const query = el('search').value.trim().toLowerCase();
  el('market').replaceChildren();
  const watching = marketSort === 'favorites';
  const results = coins.filter(c => (!watching || watchlist.has(c.id))
    && (c.name + ' ' + c.symbol).toLowerCase().includes(query));
  if (marketSort === 'volume') results.sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1));
  if (marketSort === 'gainers' || marketSort === 'losers') {
    const sign = marketSort === 'gainers' ? 1 : -1;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i].change == null || results[i].change * sign <= 0) results.splice(i, 1);
    }
    results.sort((a, b) => sign * (b.change - a.change));
  }
  const pages = Math.max(1, Math.ceil(results.length / marketPageSize));
  marketPage = Math.max(0, Math.min(marketPage, pages - 1));
  el('market-count').textContent = results.length.toLocaleString() + ' coins';
  el('market-page').textContent = (marketPage + 1) + ' / ' + pages;
  el('market-prev').disabled = marketPage === 0;
  el('market-next').disabled = marketPage === pages - 1;
  if (!results.length) el('market').textContent = 'No matching coins';
  for (const c of results.slice(marketPage * marketPageSize, (marketPage + 1) * marketPageSize)) {
    const button = document.createElement('button');
    const label = document.createElement('strong');
    const price = document.createElement('span');
    const change = document.createElement('small');
    label.textContent = c.symbol + (watchlist.has(c.id) ? ' ★' : '');
    price.textContent = c.price > 0 ? usd(c.price) : '—';
    change.textContent = marketSort === 'volume' ? (c.volume == null ? '—' : usd(c.volume)) : (c.change == null ? '—' : c.change.toFixed(2) + '%');
    change.className = c.change >= 0 ? 'up' : 'down';
    button.append(label, price, document.createTextNode(c.name), change);
    button.setAttribute('aria-pressed', String(c.id === selected));
    button.onclick = () => {
      if (selected !== c.id) {
        el('quantity').value = '';
        el('limit').value = '';
        el('stop-price').value = '';
        el('target-price').value = '';
      }
      selected = c.id;
      el('message').textContent = '';
      render();
    };
    el('market').append(button);
  }
}
function draw(c) {
  const svg = el('chart');
  svg.replaceChildren();
  const samples = (mode === 'demo' ? demoHistory : history).get(c.id) || [];
  const allCandles = buildCandles(samples, candleMinutes);
  const candles = allCandles.slice(-chartRange);
  el('chart-samples').textContent = candles.length + ' candles';
  const values = allCandles.map(candle => candle.close);
  const sma = movingAverage(values, 20);
  const ema = exponentialAverage(values, 20);
  const macd = macdSeries(values);
  const rsi = relativeStrength(values, 14);
  const format = value => value == null ? 'Collecting candles' : value.toFixed(2);
  el('sma-value').textContent = format(sma.at(-1));
  el('ema-value').textContent = format(ema.at(-1));
  el('rsi-value').textContent = format(rsi.at(-1));
  el('macd-value').textContent = format(macd.at(-1));
  drawIndicator(el('rsi-chart'), rsi.slice(-chartRange), '#b49cff', [0, 100], [30, 70]);
  drawIndicator(el('macd-chart'), macd.slice(-chartRange), '#52dfb1', null, [0]);
  if (!candles.length) {
    const note = document.createElementNS(svg.namespaceURI,'text');
    note.setAttribute('x','20'); note.setAttribute('y','140'); note.setAttribute('fill','#a4a9b4');
    note.textContent = 'Collecting live market snapshots…';
    svg.append(note);
    return;
  }
  const low = Math.min(...candles.map(candle => candle.low));
  const high = Math.max(...candles.map(candle => candle.high));
  const padding = Math.max((high - low) * .12, c.price * .0005);
  const min = low - padding;
  const span = high + padding - min;
  const yFor = value => 250 - (value - min) / span * 230;
  const make = (tag, attrs) => {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  for (let i = 0; i < 5; i++) {
    const y = 20 + i * 57.5;
    svg.append(make('line', { x1: 12, x2: 508, y1: y, y2: y, stroke: '#2b313c' }));
    const label = make('text', { x: 596, y: y + 4, 'text-anchor': 'end', fill: '#98a4b7', 'font-size': 11 });
    label.textContent = usd(min + span * (1 - i / 4));
    svg.append(label);
  }
  const step = 490 / Math.max(candles.length, 12);
  const width = Math.min(22, step * .65);
  candles.forEach((candle, i) => {
    const x = 22 + i * step;
    const color = candle.close >= candle.open ? '#52dfb1' : '#ff7588';
    const open = yFor(candle.open);
    const close = yFor(candle.close);
    const body = make('rect', { x: x - width / 2, y: Math.min(open, close), width,
      height: Math.max(2, Math.abs(close - open)), fill: color });
    const title = make('title', {});
    title.textContent = [new Date(candle.time).toLocaleString(), 'Open ' + usd(candle.open), 'High ' + usd(candle.high),
      'Low ' + usd(candle.low), 'Close ' + usd(candle.close)].join(' · ');
    body.append(title);
    svg.append(make('line', { x1: x, x2: x, y1: yFor(candle.high), y2: yFor(candle.low), stroke: color }), body);
  });
  for (const [id, series, color] of [['show-sma', sma, '#ffba46'], ['show-ema', ema, '#77aaff']]) {
    if (!el(id).checked) continue;
    const coords = series.slice(-candles.length).flatMap((value, i) =>
      value == null ? [] : [[22 + i * step, Math.min(250, Math.max(20, yFor(value)))].join(',')]);
    if (coords.length > 1) svg.append(make('polyline', { points: coords.join(' '), fill: 'none', stroke: color, 'stroke-width': 2 }));
  }
}
function ledger() {
  const w = wallet();
  el('balance').textContent = usd(available('buy')) + ' available';
  let holdings = 0;
  let realized = 0;
  let unpriced = 0;
  for (const [id, position] of Object.entries(w.positions)) {
    const quote = coins.find(c => c.id === Number(id));
    realized += position.realized;
    if (quote) holdings += position.quantity * quote.price;
    else if (position.quantity > 0) unpriced++;
  }
  el('equity').textContent = usd(w.cash + holdings) + (unpriced ? ' (partial)' : '');
  el('cash').textContent = usd(w.cash);
  el('realized').textContent = usd(realized);
  el('export').disabled = !w.orders.length;
  el('positions').replaceChildren();
  for (const [id, p] of Object.entries(w.positions)) {
    const price = coins.find(c => c.id === Number(id))?.price;
    const row = document.createElement('div');
    row.className = 'entry';
    row.textContent = p.symbol + ' · ' + p.quantity.toPrecision(6) + ' units · Realized P/L ' + usd(p.realized)
      + (price ? ' · Unrealized P/L ' + usd(p.quantity * price - p.cost) : '');
    el('positions').append(row);
  }
  if (!el('positions').children.length) el('positions').textContent = 'No holdings yet';
  el('orders').replaceChildren();
  const status = el('order-status').value;
  const displayed = [...w.orders].reverse().filter(order => status === 'All' || order.status === status);
  for (const order of displayed) {
    const row = document.createElement('div');
    row.className = 'entry';
    row.textContent = order.status + ' · ' + order.side.toUpperCase() + ' ' + order.quantity + ' ' + order.symbol + (order.price != null ? ' @ ' + usd(order.price)
      : order.type === 'bracket' ? ' · TP ' + usd(order.target) + ' / SL ' + usd(order.stop)
      : ' @ ' + usd(order.stop ?? order.limit));
    if (order.status === 'Open') {
      const cancel = document.createElement('button');
      cancel.textContent = 'Cancel';
      cancel.onclick = () => { order.status = 'Canceled'; save(); ledger(); };
      row.append(cancel);
    }
    el('orders').append(row);
  }
  if (!displayed.length) el('orders').textContent = 'No matching orders';
}
function estimate() {
  const type = el('type');
  const sell = el('side').value === 'sell';
  for (const option of type.options) {
    if (['stop', 'bracket'].includes(option.value)) option.disabled = !sell;
  }
  if (!sell && type.selectedOptions[0].disabled) type.value = 'market';
  const limit = type.value === 'limit';
  const stop = ['stop', 'bracket'].includes(type.value);
  const bracket = type.value === 'bracket';
  el('stop-row').hidden = !stop;
  el('stop-price').required = stop;
  el('target-row').hidden = !bracket;
  el('target-price').required = bracket;
  el('limitRow').hidden = !limit;
  el('limit').required = limit;
  const cost = Number(el('quantity').value) * (limit ? Number(el('limit').value) : coin().price);
  el('estimate').textContent = Number.isFinite(cost) && cost > 0 ? usd(cost) : '—';
  el('trade').textContent = (sell ? 'Sell ' : 'Buy ') + coin().symbol;
  el('trade').dataset.side = sell ? 'sell' : 'buy';
  el('ticket-available').textContent = sell
    ? available('sell', coin().id).toPrecision(6) + ' ' + coin().symbol
    : usd(available('buy'));
}
function render() {
  const c = coin();
  el('pair').textContent = c.symbol + ' / USD';
  el('asset').textContent = c.symbol;
  el('watch').textContent = watchlist.has(c.id) ? '★ Watching' : '☆ Watch coin';
  el('watch').setAttribute('aria-pressed', String(watchlist.has(c.id)));
  el('price').textContent = c.price > 0 ? usd(c.price) : 'Quote unavailable';
  el('trade').disabled = !(c.price > 0) || (mode === 'cmc' && feed.includes('trading paused'));
  el('change').textContent = c.change == null ? '—' : c.change.toFixed(2) + (priceSource === 'Kraken' ? '% · UTC day' : '% · 24h');
  el('change').className = c.change >= 0 ? 'up' : 'down';
  el('volume').textContent = c.volume ? '24h volume ' + usd(c.volume) : '';
  el('feed').textContent = feed;
  el('advance').hidden = el('pause').hidden = mode !== 'demo';
  markets(); draw(c); ledger(); estimate();
  updateFutures(c, mode, el('trade').disabled, coins);
}
function showMarketPage(page) {
  marketPage = page;
  markets();
  el('market').scrollTop = 0;
}
el('search').oninput = () => showMarketPage(0);
el('market-prev').onclick = () => showMarketPage(marketPage - 1);
el('market-next').onclick = () => showMarketPage(marketPage + 1);
el('chart-range').onchange = event => {
  chartRange = Number(event.target.value);
  draw(coin());
};
el('candle-interval').onchange = event => {
  candleMinutes = Number(event.target.value);
  draw(coin());
};
for (const id of ['show-sma', 'show-ema']) el(id).onchange = () => draw(coin());
for (const button of document.querySelectorAll('[data-allocation]')) {
  button.onclick = () => {
    const side = el('side').value;
    const price = el('type').value === 'limit' ? Number(el('limit').value) : coin().price;
    if (!(price > 0)) {
      el('message').textContent = 'Enter a limit price first.';
      return;
    }
    const units = available(side, coin().id) * Number(button.dataset.allocation) / (side === 'buy' ? price : 1);
    el('quantity').value = String(Math.floor(units * 1e8) / 1e8);
    estimate();
  };
}
for (const tab of document.querySelectorAll('[data-market-sort]')) {
  tab.onclick = () => {
    marketSort = tab.dataset.marketSort;
    for (const item of document.querySelectorAll('[data-market-sort]')) {
      item.setAttribute('aria-pressed', String(item === tab));
    }
    showMarketPage(0);
  };
}
el('order-status').onchange = ledger;
el('watch').onclick = () => {
  const id = coin().id;
  if (watchlist.has(id)) watchlist.delete(id);
  else watchlist.add(id);
  try { localStorage.setItem('coindeck-watchlist', JSON.stringify([...watchlist])); }
  catch { el('message').textContent = 'Watchlist lasts until reload.'; }
  render();
};
el('export').onclick = () => {
  const rows = [['Placed UTC', 'Filled UTC', 'Coin ID', 'Symbol', 'Side', 'Quantity', 'Limit USD', 'Stop USD', 'Target USD', 'Fill USD', 'Status']];
  for (const o of wallet().orders) {
    rows.push([o.placedAt, o.filledAt, o.id, o.symbol, o.side, o.quantity, o.limit, o.stop, o.target, o.price, o.status]);
  }
  const csv = rows.map(row => row.map(value => {
    const text = String(value ?? '');
    const safe = typeof value === 'string' && /^[=+@-]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'coindeck-' + mode + '-orders.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function simulateTick() {
  if (mode !== 'demo') return;
  for (const c of demo) {
    c.price *= 1 + (Math.random() - .5) * .04;
    demoHistory.set(c.id, [...demoHistory.get(c.id), { time: Date.now(), price: c.price }].slice(-1000));
  }
  settle();
  render();
}
el('advance').onclick = simulateTick;
el('pause').onclick = () => {
  simulationPaused = !simulationPaused;
  el('pause').textContent = simulationPaused ? 'Resume simulation' : 'Pause simulation';
  feed = simulationPaused ? 'Simulated feed · paused' : 'Simulated feed · updates every 5 seconds';
  el('feed').textContent = feed;
};
el('ticket').oninput = estimate;
el('ticket').onsubmit = event => {
  event.preventDefault();
  if (el('trade').disabled) return;
  const c = coin();
  const side = el('side').value;
  const quantity = Number(el('quantity').value);
  const limit = el('type').value === 'limit' ? Number(el('limit').value) : null;
  const value = quantity * (limit ?? c.price);
  if (!(quantity > 0 && value > 0 && Number.isFinite(value))) {
    el('message').textContent = 'Enter a valid quantity and price.';
    return;
  }
  if ((side === 'buy' ? value : quantity) > available(side, c.id)) {
    el('message').textContent = 'Insufficient available balance.';
    return;
  }
  const type = el('type').value;
  const stop = Number(el('stop-price').value);
  const target = Number(el('target-price').value);
  if (['stop', 'bracket'].includes(type) && (side !== 'sell' || !(stop > 0 && stop < c.price)
      || (type === 'bracket' && !(target > c.price && Number.isFinite(target))))) {
    el('message').textContent = 'Sell stop must be below market. Take profit must be above market.';
    return;
  }
  const order = {id:c.id,symbol:c.symbol,side,quantity,limit,type,
    stop: ['stop', 'bracket'].includes(type) ? stop : null,
    target: type === 'bracket' ? target : null,status:'Open',placedAt:new Date().toISOString()};
  wallet().orders.push(order);
  if (type === 'market') fill(order,c.price);
  settle();
  el('message').textContent = order.status === 'Filled' ? 'Paper trade filled.' : 'Order placed.';
  el('quantity').value = '';
  ledger(); estimate();
};
let lastSnapshot;
let marketRefreshMs = 5000;
let refreshTimer;
let stopped = false;
async function refresh() {
  try {
    const response = await fetch('/api/markets', {signal:AbortSignal.timeout(12000)});
    const data = await response.json();
    if (!response.ok || !data.coins?.length) throw new Error(data.error || 'Feed unavailable');
    coins = data.coins;
    if (mode !== 'cmc') el('quantity').value = '';
    mode = 'cmc';
    selected = coin().id;
    priceSource = data.source;
    marketRefreshMs = data.refreshMs;
    feed = priceSource + ' · ' + new Date(data.time).toLocaleTimeString() + ' · updates every ' + marketRefreshMs / 1000 + 's';
    if (data.time !== lastSnapshot) {
      for (const c of coins) {
        if (!(c.price > 0)) continue;
        if (!history.has(c.id)) history.set(c.id, []);
        const samples = history.get(c.id);
        samples.push({ time: data.time, price: c.price });
        if (samples.length > 1200) samples.shift();
      }
      lastSnapshot = data.time;
    }
    if (data.stale) feed = priceSource + ' · cached prices · trading paused';
    else settle();
  } catch (error) {
    if (mode === 'cmc') feed = priceSource + ' refresh failed · trading paused';
    el('trade').disabled = mode === 'cmc';
  }
  if (stopped) return;
  render();
  refreshTimer = setTimeout(refresh, marketRefreshMs);
}
render();
const simulationTimer = setInterval(() => {
  if (!simulationPaused) simulateTick();
}, 5000);
if (location.protocol !== 'file:' && !location.hostname.endsWith('.github.io')) refresh();
return () => {
  clearInterval(simulationTimer);
  stopped = true;
  clearTimeout(refreshTimer);
};

}
const h = React.createElement;
const screens = [
  ["trade", "Spot trading"],
  ["futures", "Futures"],
  ["portfolio", "Portfolio"],
  ["wallet", "Wallet"],
  ["p2p", "P2P marketplace"],
];

function Header({ page, navigate }) {
  return h("header", {className: "site-header"},
    h("a", {className: "wordmark", href: "#trade"}, h("span", {className: "brand-icon", "aria-hidden": true}, "◈"), "Bikas Exchange"),
    h("nav", {"aria-label": "Exchange navigation"},
      ...screens.map(([id, label]) => h("button", {
        key: id, type: "button", onClick: () => navigate(id),
        "aria-current": page === id ? "page" : undefined,
      }, label))
    ),
    h("span", {className: "environment"}, h("span", {"aria-hidden": true}, "●"), " TESTNET")
  );
}

function Markets() {
  return h("section", null,
    h("h2", null,
      "Markets · USD"
    ),
    h("input", {"id":"search","type":"search","placeholder":"Search coins","aria-label":"Search coins","defaultValue":""}),
    h("div", {className: "market-tabs", role: "group", "aria-label": "Market lists"},
      ...[["rank","Top"],["volume","Volume"],["gainers","Gainers"],["losers","Losers"],["favorites","Favorites"]]
        .map(([id,label]) => h("button", {key:id, type:"button", "data-market-sort":id, "aria-pressed":id==="rank"}, label))
    ),
    h("p", {id: "market-count", className: "muted"}),
    h("div", {id: "market"}),
    h("div", {className: "market-pagination", "aria-label": "Market pages"},
      h("button", {id: "market-prev", type: "button"}, "Previous"),
      h("span", {id: "market-page"}),
      h("button", {id: "market-next", type: "button"}, "Next")
    )
  );
}

function MarketChart() {
  return h("section", null,
    h("div", {className: "section-bar"},
      h("h1", {id: "pair"}),
      h("button", {id: "watch", type: "button"}, "☆ Watch coin")
    ),
    h("div", {"className":"summary"},
      h("span", {"className":"price","id":"price"}),
      h("b", {"id":"change"}),
      h("small", {"id":"volume"})
    ),
    h("div", {className: "chart-toolbar"},
      h("span", null, "OHLC · SESSION SAMPLES"),
      h("span", {id: "chart-samples"}),
      h("select", {id: "candle-interval", "aria-label": "Candle timeframe", defaultValue: "5"},
        ...[[5,"5m"],[15,"15m"],[60,"1h"]].map(([value,label]) => h("option", {key:value,value},label))
      ),
      h("select", {id: "chart-range", "aria-label": "Chart observation range", defaultValue: "60"},
        h("option", {value: "12"}, "Last 12"),
        h("option", {value: "24"}, "Last 24"),
        h("option", {value: "60"}, "Last 60")
      )
    ),
    h("svg", {"id":"chart","viewBox":"0 0 600 280","preserveAspectRatio":"none","role":"img","aria-label":"Price chart"}),
    h("div", {className: "indicator-strip"},
      h("label", null, h("input", {id:"show-sma",type:"checkbox",defaultChecked:true}), " SMA 20", h("strong", {id:"sma-value"})),
      h("label", null, h("input", {id:"show-ema",type:"checkbox",defaultChecked:true}), " EMA 20", h("strong", {id:"ema-value"})),
      h("div", null, "RSI 14", h("strong", {id:"rsi-value"}), h("svg", {id:"rsi-chart",viewBox:"0 0 300 60",role:"img","aria-label":"RSI trend"})),
      h("div", null, "MACD 12/26", h("strong", {id:"macd-value"}), h("svg", {id:"macd-chart",viewBox:"0 0 300 60",role:"img","aria-label":"MACD trend"}))
    ),
    h("p", {"id":"feed","className":"muted"}),
    h("button", {"id":"advance","type":"button"},
      "Simulate next price tick"
    ),
    h("button", {id: "pause", type: "button"}, "Pause simulation")
  );
}

function OrderTicket({hidden}) {
  return h("aside", {hidden},
    h("h2", null,
      "Place order"
    ),
    h("p", {id: "balance", className: "muted"}),
    h("div", {className: "ticket-summary"}, h("span", null, "Available to trade"), h("strong", {id: "ticket-available"})),
    h("form", {"id":"ticket"},
      h("label", null,
        "Side",
        h("select", {"id":"side","defaultValue":"buy"},
          h("option", {"value":"buy"},
            "Buy"
          ),
          h("option", {"value":"sell"},
            "Sell"
          )
        )
      ),
      h("label", null,
        "Order type",
        h("select", {"id":"type","defaultValue":"market"},
          h("option", {"value":"market"},
            "Market"
          ),
          h("option", {"value":"limit"},
            "Limit"
          ),
          h("option", {value:"stop"}, "Stop-market sell"),
          h("option", {value:"bracket"}, "Take profit / stop loss")
        )
      ),
      h("label", {"id":"limitRow","hidden":true},
        "Limit price (USD)",
        h("input", {"id":"limit","type":"number","min":"0","step":"any","defaultValue":""})
      ),
      h("label", {id:"stop-row",hidden:true}, "Stop price (USD)",
        h("input", {id:"stop-price",type:"number",min:"0",step:"any"})),
      h("label", {id:"target-row",hidden:true}, "Take profit (USD)",
        h("input", {id:"target-price",type:"number",min:"0",step:"any"})),
      h("label", null,
        "Quantity (",
        h("span", {"id":"asset"}),
        ")",
        h("input", {"id":"quantity","type":"number","min":"0","step":"any","required":true,"placeholder":"0.00","defaultValue":""})
      ),
      h("div", {className: "allocation", "aria-label": "Size by available balance"},
        ...[.25, .5, .75, 1].map(part => h("button", {
          key: part, type: "button", "data-allocation": part,
        }, part * 100 + "%"))
      ),
      h("div", {className: "ticket-summary"}, h("span", null, "Estimated total"), h("strong", {id: "estimate"})),
      h("button", {"id":"trade"},
        "Place paper order"
      )
    ),
    h("p", {"id":"message","role":"status"})
  );
}

function Portfolio() {
  return h("section", {id: "ledger"},
    h("h2", null, "Portfolio overview"),
    h("div", {className: "portfolio-stats"},
      h("div", null, "Equity", h("strong", {id: "equity"})),
      h("div", null, "Cash", h("strong", {id: "cash"})),
      h("div", null, "Realized P/L", h("strong", {id: "realized"}))
    ),
    h("h2", null,
      "Holdings"
    ),
    h("div", {"id":"positions"}),
    h("h2", null,
      "Orders & fills"
    ),
    h("div", {className: "section-bar order-tools"},
      h("select", {id: "order-status", "aria-label": "Order status", defaultValue: "All"},
        ...["All", "Open", "Filled", "Canceled"].map(status => h("option", {key: status}, status))
      ),
      h("button", {id: "export", type: "button"}, "Export CSV")
    ),
    h("div", {id: "orders"})
  );
}
function currentScreen() {
  const route = location.hash.slice(1);
  return screens.some(([id]) => id === route) ? route : "trade";
}

function Bikas() {
  const [page, setPage] = React.useState(currentScreen);
  React.useEffect(initializeTerminal, []);
  React.useEffect(() => {
    const update = () => setPage(currentScreen());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const title = screens.find(([id]) => id === page)[1];
  return h(React.Fragment, null,
    h(Header, {page, navigate: id => { location.hash = id; }}),
    h("div", {className: "workspace-heading"},
      h("span", {className: "eyebrow"}, "BIKAS EXCHANGE / SANDBOX"),
      h("h1", null, title),
      h("p", null, page === "trade" ? "Explore market prices and place spot orders with virtual funds."
        : page === "futures" ? "Practice leveraged long and short positions with virtual margin."
        : page === "portfolio" ? "Review spot positions, account equity and order history."
        : page === "wallet" ? "Manage test USD and view your wallet activity."
        : "Trade test credits between accounts with escrow.")
    ),
    h("main", {className: "trading-grid", hidden: page !== "trade" && page !== "futures"}, h(Markets), h(MarketChart),
      h(OrderTicket, {hidden: page === "futures"}), h(FuturesTicket, {hidden: page !== "futures"})),
    h("main", {className: "account-grid", hidden: page !== "portfolio"}, h(Portfolio)),
    h("main", {className: "account-grid", hidden: page !== "wallet" && page !== "p2p"},
      h(ExchangeSandbox, {page})
    ),
    h("footer", {className: "site-footer"}, "Bikas Exchange Sandbox", h("span", null, "Virtual funds · USD reference prices"))
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(h(Bikas));





