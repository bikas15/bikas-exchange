function ExchangeSandbox({ page }) {
  const staticDemo = location.protocol === 'file:' || location.hostname.endsWith('.github.io');
  const [token, setToken] = React.useState(null);
  const [state, setState] = React.useState(null);
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const lock = React.useRef(false);
  const revision = React.useRef(0);
  async function request(action, input = {}) {
    const response = await fetch('/api/sandbox/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status });
    return data;
  }
  React.useEffect(() => {
    if (token === false || staticDemo) return;
    let active = true;
    async function poll() {
      if (lock.current) return;
      const version = revision.current;
      try {
        const data = await request('state');
        if (active && !lock.current && version === revision.current) { setState(data); setToken(true); }
      } catch (error) {
        if (active && !lock.current && version === revision.current) {
          if (error.status === 401) { setToken(false); setState(null); }
          else setNotice(error.message);
        }
      }
    }
    poll();
    const timer = setInterval(poll, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [token]);

  async function perform(action, input) {
    if (lock.current) return;
    lock.current = true;
    revision.current++;
    setBusy(true);
    setNotice('');
    try {
      const data = await request(action, input);
      if (data.signedIn) {
        setState(await request('state'));
        setToken(true);
      } else if (action === 'logout') {
        setToken(false);
        setState(null);
      } else {
        setState(data);
        setNotice('Test transaction recorded.');
      }
    } catch (error) {
      if (error.status === 401) { setToken(false); setState(null); }
      setNotice(error.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const form = (fields, buttons) => h('form', { onSubmit: event => {
    event.preventDefault();
    perform(event.nativeEvent.submitter?.value || buttons[0][0], Object.fromEntries(new FormData(event.currentTarget)));
  } },
    ...fields.map(([name, label, type]) => h('label', { key: name }, label,
      h('input', { name, type, required: true, ...(type === 'number' ? { min: '.01', step: '.01' } : {}) }))),
    ...buttons.map(([action, label]) => h('button', { key: action, value: action, disabled: busy }, label))
  );
  const amount = cents => (cents / 100).toFixed(2);
  const button = (action, label, id) => h('button', { disabled: busy, onClick: () => perform(action, { id }) }, label);

  if (staticDemo) return h('section', { className: 'exchange' },
    h('h2', null, 'Exchange sandbox'), 'Start the local server to use sign-in, test wallet and P2P.');

  return h('section', { className: 'exchange', 'aria-label': 'Exchange sandbox' },
    h('div', { className: 'section-bar' }, h('h2', null, page === 'p2p' ? 'P2P trading account' : 'Wallet account'),
      token && button('logout', 'Sign out')),
    h('p', { role: 'status' }, notice),
    token === null ? h('p', null, 'Checking session…') : !token ? form([['name', 'Username', 'text'], ['password', 'Password', 'password']], [['login', 'Sign in'], ['signup', 'Create account']])
      : !state ? h('p', null, 'Loading wallet…') : h(React.Fragment, null,
        h('p', null, 'Signed in as ', h('strong', null, state.name)),
        h('div', { className: 'portfolio-stats' },
          h('div', null, 'Test USD', h('strong', null, '$' + amount(state.usd))),
          h('div', null, 'Test credits', h('strong', null, amount(state.credits)))),
        h('div', { className: 'exchange-grid' },
          h('div', { hidden: page !== 'wallet' }, h('h2', null, 'Transfer test funds'),
            form([['amount', 'Amount in test USD', 'number']], [['deposit', 'Test deposit'], ['withdraw', 'Test withdrawal']]),
            h('h2', null, 'Wallet history'),
            ...state.transfers.map((t, i) => h('p', { key: i }, t.action + ' · $' + amount(t.amount) + ' · ' + new Date(t.time).toLocaleString()))),
          h('div', { hidden: page !== 'p2p' }, h('h2', null, 'Sell test credits'),
            form([['amount', 'Credits to lock in escrow', 'number'], ['price', 'Total price in test USD', 'number']], [['offer', 'Post offer']]))),
        page === 'p2p' && h('div', { className: 'offer-list' }, h('h2', null, 'P2P marketplace'),
        ...state.offers.map(o => h('div', { key: o.id, className: 'entry' },
          o.seller + ' · ' + amount(o.amount) + ' credits · $' + amount(o.price) + ' · ' + o.status,
          o.status === 'Open' && (o.seller === state.name ? button('cancel', 'Cancel', o.id) : button('take', 'Reserve', o.id)),
          o.status === 'Reserved' && o.buyer === state.name && button('paid', 'Confirm test payment', o.id),
          o.status === 'Reserved' && o.buyer === state.name && button('cancel', 'Cancel reservation', o.id),
          o.status === 'Paid' && o.seller === state.name && button('release', 'Release credits', o.id))),
        !state.offers.length && h('p', null, 'No offers yet. Post one or sign in to a second account to take an offer.'))));
}

