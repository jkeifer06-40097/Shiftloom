const dayMs = 86400000;
const weekMs = 7 * dayMs;
const yearDays = 365.2425;
const minTrainingWeeks = 8;
export const scenarioSeed = 327321;

function iso(time) { return new Date(time).toISOString().slice(0,10); }
function monday(time) { return time - ((new Date(time).getUTCDay() + 6) % 7) * dayMs; }
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const dot = (a,b) => a.reduce((sum, value, i) => sum + value * b[i], 0);

export function parseDemandCsv(source) {
  const lines = source.replace(/^\uFEFF/,'').split(/\r\n|\n|\r/).filter(line => line.trim());
  function columns(line, number) {
    const match = /^\s*("(?:[^"]|"")*"|[^",]*?)\s*,\s*("(?:[^"]|"")*"|[^",]*?)\s*,\s*("(?:[^"]|"")*"|[^",]*?)\s*$/.exec(line);
    if (!match) throw new Error('Expected three CSV fields on record '+number+'.');
    return match.slice(1).map(field => field.startsWith('"') ? field.slice(1,-1).replaceAll('""','"') : field.trim());
  }
  if (!lines.length || columns(lines[0],1).join(',').toLowerCase() !== 'date,shift,demand') {
    throw new Error('CSV header must be date,shift,demand.');
  }
  if (lines.length < 2) throw new Error('The CSV contains no demand observations.');
  const keys = new Set();
  return lines.slice(1).map((line,i) => {
    const [date,shift,demandText] = columns(line,i+2);
    const time = Date.parse(date+'T00:00:00Z');
    const demand = Number(demandText);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time) || iso(time) !== date ||
        !shift.trim() || !/^\d+$/.test(demandText) || !Number.isSafeInteger(demand) || demand > 10000000) {
      throw new Error('Record '+(i+2)+' needs a valid date, shift name, and nonnegative integer demand up to 10 million.');
    }
    const key = date+'\u0000'+shift;
    if (keys.has(key)) throw new Error('Duplicate observation for '+shift+' on '+date+'.');
    keys.add(key);
    return {time,shift,demand};
  });
}

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525,state) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
}

export function syntheticHistory(shift, activeDays) {
  const next = rng(93827);
  const start = Date.UTC(2024,0,1);
  const noise = () => Math.sqrt(-2 * Math.log(next())) * Math.cos(2 * Math.PI * next());
  const rows = [];
  for (let week = 0; week < 80; week++) {
    const time = start + week * weekMs;
    const weeklyShock = 11 * noise();
    for (const day of activeDays) {
      const date = time + day * dayMs;
      const annual = 19 * Math.sin(2 * Math.PI * (date-start) / (dayMs*yearDays));
      const spike = next() < 0.05 ? 35 + 40 * next() : 0;
      const expected = [115,120,126,130,147,195,175][day] + week * 0.27 + annual;
      rows.push({time:date,shift,demand:Math.max(0,Math.round(expected + weeklyShock + 13 * noise() + spike))});
    }
  }
  return rows;
}

function weeklySeries(rows, shift, activeDays) {
  const weeks = new Map();
  for (const row of rows) {
    if (row.shift !== shift) continue;
    const start = monday(row.time);
    const day = (row.time-start)/dayMs;
    if (!activeDays.includes(day)) continue;
    if (!weeks.has(start)) weeks.set(start,new Map());
    weeks.get(start).set(day,row.demand);
  }
  const dates = [...weeks.keys()].sort((a,b) => a-b);
  if (!dates.length) throw new Error('The CSV has no observations for the selected shift and its scheduled weekdays.');
  const series = [];
  for (let time = dates[0]; time <= dates.at(-1); time += weekMs) {
    const observations = weeks.get(time);
    if (observations?.size !== activeDays.length) {
      throw new Error('Missing scheduled-day demand in the week of '+iso(time)+'. Include zero-demand days as 0.');
    }
    series.push({time,values:activeDays.map(day => observations.get(day))});
  }
  if (series.length < minTrainingWeeks+1) throw new Error('At least nine consecutive complete weeks are required for fitting and validation.');
  return series;
}

function fit(weeks) {
  const start = weeks[0].time;
  const middle = (weeks.length-1)/2;
  const annual = weeks.length >= 52;
  function features(time) {
    const elapsed = (time-start)/weekMs;
    const angle = 2 * Math.PI * elapsed * 7 / yearDays;
    return annual ? [1,(elapsed-middle)/52,Math.sin(angle),Math.cos(angle)] : [1,(elapsed-middle)/52];
  }
  const weeklyMeans = weeks.map(week => mean(week.values));
  const weekdayEffects = weeks[0].values.map((_,day) => mean(weeks.map((week,i) => week.values[day]-weeklyMeans[i])));
  const design = weeks.map(week => features(week.time));
  // Least squares via modified Gram-Schmidt QR. Balanced weeks let us
  // estimate weekday offsets separately from the common weekly level.
  const q = [], r = [];
  for (let j = 0; j < design[0].length; j++) {
    let column = design.map(row => row[j]);
    r[j] = [];
    for (let i = 0; i < j; i++) {
      r[i][j] = dot(q[i],column);
      column = column.map((value,k) => value-r[i][j]*q[i][k]);
    }
    r[j][j] = Math.sqrt(dot(column,column));
    q[j] = column.map(value => value/r[j][j]);
  }
  const beta = q.map(column => dot(column,weeklyMeans));
  for (let i = beta.length-1; i >= 0; i--) {
    for (let j = i+1; j < beta.length; j++) beta[i] -= r[i][j]*beta[j];
    beta[i] /= r[i][i];
  }
  const level = time => dot(features(time),beta);
  // Resample an entire residual week to retain observed within-week
  // dependence. Residuals are computed from training observations only.
  const residuals = weeks.map(week => week.values.map((value,day) => value-level(week.time)-weekdayEffects[day]));
  function forecast(time) {
    const baseline = level(time);
    return residuals.map(row => row.map((error,day) => Math.max(0,Math.round(baseline+weekdayEffects[day]+error))));
  }
  return {annual,forecast};
}

function quantile(sorted, probability) {
  // Use the inverse empirical CDF for integer demand counts.
  return sorted[Math.max(0,Math.ceil(sorted.length*probability)-1)];
}

function intervals(scenarios) {
  return scenarios[0].map((_,day) => {
    const sorted = scenarios.map(row => row[day]).sort((a,b) => a-b);
    return [0.05,0.5,0.95].map(probability => quantile(sorted,probability));
  });
}

export function sampleScenarios(pool, samples, seed, antithetic = false) {
  const next = rng(seed);
  // Sort whole residual-week outcomes by total demand. Pair U with 1-U
  // to balance aggregate demand ranks while preserving each marginal draw.
  const ordered = antithetic ? [...pool].sort((a,b) =>
    a.reduce((sum,value) => sum+value,0)-b.reduce((sum,value) => sum+value,0)) : pool;
  const draw = u => ordered[Math.min(ordered.length-1,Math.floor(u*ordered.length))];
  const scenarios = [];
  while (scenarios.length < samples) {
    const u = next();
    scenarios.push(draw(u));
    if (antithetic && scenarios.length < samples) scenarios.push(draw(1-u));
  }
  return scenarios;
}

export function evaluateDemand(rows, shift, days, samples = 1000, seed = scenarioSeed, antithetic = false) {
  const activeDays = [...days].sort((a,b) => a-b);
  const weeks = weeklySeries(rows,shift,activeDays);
  const firstTest = Math.max(minTrainingWeeks,weeks.length-52);
  let errors = 0, hits = 0, count = 0;
  // Fit only earlier weeks. Score the held-out week's actual shift demand
  // against the median forecast and inclusive 5th–95th percentile interval.
  for (let i = firstTest; i < weeks.length; i++) {
    const model = fit(weeks.slice(0,i));
    intervals(model.forecast(weeks[i].time)).forEach(([low,median,high], day) => {
      const actual = weeks[i].values[day];
      errors += Math.abs(actual-median);
      hits += Number(low <= actual && actual <= high);
      count++;
    });
  }
  const model = fit(weeks);
  const nextWeek = weeks.at(-1).time + weekMs;
  const pool = model.forecast(nextWeek);
  return {
    annual:model.annual, historyWeeks:weeks.length, heldOutWeeks:weeks.length-firstTest,
    mae:errors/count, coverage:hits/count, count, hits, nextWeek:iso(nextWeek),
    forecasts:intervals(pool).map(([p05,p50,p95],i) => ({date:iso(nextWeek+activeDays[i]*dayMs),p05,p50,p95})),
    pool, scenarios:sampleScenarios(pool,samples,seed,antithetic)
  };
}
