function buildCandles(samples, minutes) {
  const interval = minutes * 60000;
  const candles = [];
  for (const { time, price } of samples) {
    if (!(price > 0) || !Number.isFinite(time)) continue;
    const start = Math.floor(time / interval) * interval;
    const last = candles.at(-1);
    if (last?.time === start) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
    } else {
      candles.push({ time: start, open: price, high: price, low: price, close: price });
    }
  }
  return candles;
}

function movingAverage(values, period) {
  let sum = 0;
  return values.map((value, i) => {
    sum += value;
    if (i >= period) sum -= values[i - period];
    return i >= period - 1 ? sum / period : null;
  });
}

function exponentialAverage(values, period) {
  let seed = 0;
  let average = null;
  const weight = 2 / (period + 1);
  return values.map((value, i) => {
    if (i < period) {
      seed += value;
      if (i === period - 1) average = seed / period;
    } else {
      average += (value - average) * weight;
    }
    return average;
  });
}

function macdSeries(values) {
  const fast = exponentialAverage(values, 12);
  const slow = exponentialAverage(values, 26);
  return slow.map((value, i) => value == null ? null : fast[i] - value);
}

function relativeStrength(values, period) {
  let gains = 0;
  let losses = 0;
  return values.map((value, i) => {
    if (!i) return null;
    const change = value - values[i - 1];
    const up = Math.max(change, 0);
    const down = Math.max(-change, 0);
    if (i <= period) {
      gains += up / period;
      losses += down / period;
    } else {
      gains = (gains * (period - 1) + up) / period;
      losses = (losses * (period - 1) + down) / period;
    }
    if (i < period) return null;
    return losses ? 100 - 100 / (1 + gains / losses) : gains ? 100 : 50;
  });
}

function drawIndicator(svg, series, color, bounds, guides) {
  svg.replaceChildren();
  const values = series.filter(value => value != null);
  if (values.length < 2) return;
  const [low, high] = bounds || [Math.min(0, ...values), Math.max(0, ...values)];
  const y = value => 55 - (value - low) * 50 / (high - low || 1);
  const add = (tag, attrs) => {
    const node = document.createElementNS(svg.namespaceURI, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    svg.append(node);
  };
  for (const value of guides) {
    add('line', { x1: 0, x2: 300, y1: y(value), y2: y(value), stroke: '#536074', 'stroke-dasharray': '4 4' });
  }
  const points = series.flatMap((value, i) => value == null ? [] : [i * 300 / (series.length - 1) + ',' + y(value)]);
  add('polyline', { points: points.join(' '), stroke: color, fill: 'none', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' });
}
