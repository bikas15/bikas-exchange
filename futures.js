const futuresKey = 'coindeck-futures-v1';
const initialFutures = () => ({ cash: 10000, positions: [], history: [] });
function loadFutures() {
  try { return JSON.parse(localStorage.getItem(futuresKey)) || {}; }
  catch { return {}; }
}
function updateFutures(coin, mode, unavailable, coins) {
  window.dispatchEvent(new CustomEvent('coindeck:quotes', {
    detail: { coin, mode, unavailable, quotes: new Map(coins.map(item => [item.id, item.price])) },
  }));
}
function futuresPnl(position, price) {
  return (price - position.entry) * position.units * (position.side === 'Long' ? 1 : -1);
}
function settleFutures(book, position, price, status) {
  const pnl = Math.max(-position.margin, futuresPnl(position, price));
  return {
    cash: book.cash + Math.max(0, position.margin + pnl),
    positions: book.positions.filter(item => item.key !== position.key),
    history: [{ ...position, exit: price, pnl, status }, ...book.history].slice(0, 100),
  };
}
function FuturesTicket({ hidden }) {
  const [feed, setFeed] = React.useState(null);
  const [accounts, setAccounts] = React.useState(loadFutures);
  const [notice, setNotice] = React.useState('');
  const [margin, setMargin] = React.useState('');
  const [leverage, setLeverage] = React.useState('2');
  const usd = value => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  React.useEffect(() => {
    const update = event => setFeed(event.detail);
    window.addEventListener('coindeck:quotes', update);
    return () => window.removeEventListener('coindeck:quotes', update);
  }, []);
  React.useEffect(() => {
    try { localStorage.setItem(futuresKey, JSON.stringify(accounts)); }
    catch { setNotice('Browser storage unavailable. Positions last until reload.'); }
  }, [accounts]);
  React.useEffect(() => {
    if (!feed || feed.unavailable) return;
    setAccounts(previous => {
      const book = previous[feed.mode];
      if (!book) return previous;
      let next = book;
      for (const position of book.positions) {
        const price = feed.quotes.get(position.id);
        if (price > 0 && futuresPnl(position, price) <= -position.margin) {
          next = settleFutures(next, position, price, 'Liquidated');
        }
      }
      return next === book ? previous : { ...previous, [feed.mode]: next };
    });
  }, [feed]);
  const book = accounts[feed?.mode] || initialFutures();
  function open(event) {
    event.preventDefault();
    if (!feed || feed.unavailable) return;
    const amount = Number(margin);
    const multiplier = Number(leverage);
    const side = event.nativeEvent.submitter?.value || 'Long';
    if (!Number.isFinite(amount) || amount < 1 || amount > book.cash || book.positions.length >= 20) {
      setNotice('Enter $1 or more within your available margin. Maximum 20 open positions.');
      return;
    }
    const entry = feed.coin.price;
    const position = { key: Date.now().toString(36) + Math.random().toString(36).slice(2),
      id: feed.coin.id, symbol: feed.coin.symbol, entry, margin: amount, leverage: multiplier,
      units: amount * multiplier / entry, side };
    setAccounts(previous => {
      const current = previous[feed.mode] || initialFutures();
      if (amount > current.cash || current.positions.length >= 20) return previous;
      return { ...previous, [feed.mode]: { ...current, cash: current.cash - amount, positions: [position, ...current.positions] } };
    });
    setMargin('');
    setNotice(side + ' position opened.');
  }
  function close(key) {
    if (!feed || feed.unavailable) return;
    setAccounts(previous => {
      const current = previous[feed.mode];
      const position = current?.positions.find(item => item.key === key);
      const price = position && feed.quotes.get(position.id);
      if (!(price > 0)) return previous;
      return { ...previous, [feed.mode]: settleFutures(current, position, price, 'Closed') };
    });
  }
  return h('aside', { hidden, className: 'futures-ticket' },
    h('h2', null, 'Futures · ' + (feed?.coin.symbol || 'USD')),
    h('p', { className: 'muted' }, 'Isolated virtual margin · market entry'),
    h('p', null, 'Available margin ', h('strong', null, usd(book.cash))),
    h('form', { onSubmit: open },
      h('label', null, 'Margin (USD)', h('input', { type: 'number', min: 1, step: '.01',
        required: true, value: margin, onChange: event => setMargin(event.target.value) })),
      h('label', null, 'Leverage', h('select', { value: leverage, onChange: event => setLeverage(event.target.value) },
        ...[2, 3, 5, 10].map(value => h('option', { key: value, value }, value + '×')))),
      h('div', { className: 'futures-actions' },
        h('button', { value: 'Long', disabled: !feed || feed.unavailable }, 'Open long'),
        h('button', { value: 'Short', disabled: !feed || feed.unavailable }, 'Open short'))),
    h('p', { role: 'status' }, notice),
    h('h2', null, 'Open positions'),
    !book.positions.length && h('p', { className: 'muted' }, 'No open futures positions'),
    ...book.positions.map(position => {
      const price = feed?.quotes.get(position.id);
      return h('div', { key: position.key, className: 'entry' },
        h('strong', null, position.symbol + ' · ' + position.side + ' ' + position.leverage + '×'),
        h('div', null, 'Entry ' + usd(position.entry) + ' · Margin ' + usd(position.margin)),
        price > 0 && h('div', null, 'P/L ' + usd(Math.max(-position.margin, futuresPnl(position, price)))),
        h('button', { type: 'button', disabled: feed?.unavailable || !(price > 0), onClick: () => close(position.key) }, 'Close'));
    }),
    h('h2', null, 'Futures history'),
    !book.history.length && h('p', { className: 'muted' }, 'No closed positions'),
    ...book.history.slice(0, 10).map(position => h('p', { key: position.key, className: 'entry' },
      position.symbol + ' · ' + position.side + ' · ' + position.status + ' · P/L ' + usd(position.pnl))));
}
