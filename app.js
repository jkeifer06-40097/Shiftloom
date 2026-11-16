import {runRiskAnalysis, clearRiskAnalysis} from './risk-ui.js?v=5';
import {parseDemandCsv, syntheticHistory, evaluateDemand, sampleScenarios} from './forecast.js?v=5';
import {days, solve} from './solver.js?v=3';
import {weeklyFacts, finance, callout, trainingCandidates} from './planning.js?v=5';
const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const week = [0,1,2,3,4,5,6];
const key = 'shiftloom-v1';
const dialog = $('#editor');
const form = $('#edit-form');
function sample() {
  return {
    streak: 4,
    team: [
      ['Avery Chen','Lead',[0,1,2,3,4]], ['Jordan Lee','Lead',[1,2,3,4,6]],
      ['Sam Rivera','Lead',[0,4,5,6]], ['Morgan Patel','Crew',[0,1,2,3,4]],
      ['Taylor Brooks','Crew',[1,2,3,4,5]], ['Casey Kim','Crew',[0,3,4,5,6]],
      ['Jamie Diaz','Crew',[0,1,2,5,6]], ['Riley Jones','Crew',[0,1,2,3,4,5,6]]
    ].map(([name, role, available]) => ({name, roles:[role], max:30,
      availability:week.map(d => available.includes(d) ? ['08:00','18:00'] : null)})),
    templates: [
      {name:'Opening lead', role:'Lead', start:'08:00', end:'13:00', days:week, count:1},
      {name:'Morning crew', role:'Crew', start:'08:00', end:'13:00', days:week, count:2},
      {name:'Afternoon crew', role:'Crew', start:'13:00', end:'18:00', days:week, count:1}
    ]
  };
}
let data = sample(), persistFailed = false;
try { data = JSON.parse(localStorage.getItem(key)) || data; } catch { /* Sample remains available. */ }
let result = solve(data.team,data.templates,data.streak);
function save() {
  result = null;
  try { localStorage.setItem(key,JSON.stringify(data)); persistFailed = false; } catch { persistFailed = true; }
  render();
  renderAnalysis();
}
function render() {
  const open = result ? result.total - result.filled : '—';
  const coverage = result?.total ? Math.round(100*result.filled/result.total)+'%' : '—';
  $('#metrics').innerHTML = [[coverage,'Coverage'],[result ? result.filled+' / '+result.total : '—','Staff slots filled'],[open,'Open positions']]
    .map(([value,label]) => `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
  $('#status').textContent = (result ? result.total ? result.filled === result.total ? 'All required positions are covered.' :
    result.timedOut ? 'Best schedule found within the search limit. Open positions are shown below.' :
      'Maximum available coverage reached. Open positions are shown below.' : 'Add shift templates to build a roster.' :
    'Inputs updated. Generate a schedule to apply changes.') + (persistFailed ? ' Changes could not be saved in this browser.' : '');
  $('#export').disabled = !result?.rows.length;
  $('#calendar').innerHTML = days.map((day,i) => {
    const rows = result?.rows.filter(row => row.day === i) || [];
    const required = rows.reduce((total, row) => total + row.count, 0);
    const filled = rows.reduce((total, row) => total + row.people.length, 0);
    return `<div class="day"><div class="day-head"><h3>${day}</h3>
      ${required ? `<span aria-label="${filled} of ${required} filled">${filled} / ${required}</span>` : ''}</div>
      <div class="day-body">${rows.length ? rows.map(row => {
        const missing = row.count-row.people.length;
        return `<div class="shift ${missing ? 'gap' : ''}">
          <strong>${esc(row.name)}</strong><small>${row.start}–${row.end} · ${esc(row.role)}</small>
          ${row.people.length ? `<ul class="assignees">${row.people.map(n => `<li>${esc(data.team[n].name)}</li>`).join('')}</ul>` : ''}
          ${missing ? `<span class="gap-text">${missing} open</span>` : ''}
        </div>`;
      }).join('') : '<div class="empty">'+(result ? 'No shifts' : 'Awaiting schedule')+'</div>'}</div></div>`;
  }).join('');
  $('#people').innerHTML = records(data.team, person => `${esc(person.roles.join(', '))} · ${person.max} h/week · ${person.availability.map((a,i) => a ? days[i] : null).filter(Boolean).join(', ') || 'Unavailable'}`);
  $('#templates').innerHTML = records(data.templates, s => `${esc(s.role)} · ${s.start}–${s.end} · ${s.count} needed · ${s.days.map(i => days[i]).join(', ')}`);
  $('#streak').value = data.streak;
  $('#add-person').disabled = data.team.length >= 40;
  $('#add-shift').disabled = data.templates.length >= 25;
}
function records(items, details) {
  return items.map((item,i) => `<div class="record"><div><strong>${esc(item.name)}</strong><p>${details(item)}</p></div>
    <div><button class="outline" data-edit="${i}">Edit</button><button class="outline" data-remove="${i}">Remove</button></div></div>`).join('') || '<p class="record">No entries yet.</p>';
}
function role(value) { return value.trim().toLowerCase(); }
function edit(kind,index) {
  const isPerson = kind === 'team';
  const item = data[kind][index] || (isPerson ?
    {name:'',roles:[],max:40,availability:week.map(() => null)} :
    {name:'',role:'',start:'09:00',end:'17:00',count:1,days:week});
  form.innerHTML = `<h2 id="editor-title">${index === undefined ? 'Add' : 'Edit'} ${isPerson ? 'team member' : 'shift'}</h2>
    <label>Name <input name="name" required maxlength="48" value="${esc(item.name)}"></label>
    ${isPerson ? `<label>Roles (comma separated) <input name="roles" required maxlength="150" value="${esc(item.roles.join(', '))}"></label>
      <label>Maximum hours per week <input type="number" name="max" required min="0" max="168" step="0.25" value="${item.max}"></label>
      <p>Set both times for each available day. Leave days off blank.</p>
      ${week.map(i => `<div class="availability"><b>${days[i]}</b><input aria-label="${days[i]} available from" type="time" name="from${i}" value="${item.availability[i]?.[0] || ''}"><input aria-label="${days[i]} available until" type="time" name="to${i}" value="${item.availability[i]?.[1] || ''}"></div>`).join('')}` :
    `<label>Required role <input name="role" required maxlength="48" value="${esc(item.role)}"></label>
      <div class="pair"><label>Start <input type="time" name="start" required value="${item.start}"></label><label>End <input type="time" name="end" required value="${item.end}"></label></div>
      <label>Minimum staff <input type="number" name="count" required min="1" max="20" value="${item.count}"></label>
      <p>Repeat on</p><div class="day-picker">${week.map(i => `<label><input type="checkbox" name="days" value="${i}" ${item.days.includes(i) ? 'checked' : ''}> ${days[i]}</label>`).join('')}</div>
      <p>Shifts start and end on the same day.</p>`}
    <p class="error" role="alert"></p>
    <div class="actions"><button class="outline" type="button" id="cancel">Cancel</button><button type="submit" class="primary">Save</button></div>`;
  $('#cancel').onclick = () => dialog.close();
  form.onsubmit = e => {
    e.preventDefault();
    const values = new FormData(form);
    const error = message => { form.querySelector('.error').textContent = message; };
    const name = values.get('name').trim();
    if (!name) return error('Enter a name.');
    let record;
    if (isPerson) {
      const roles = [...new Set(values.get('roles').split(',').map(role).filter(Boolean))];
      if (!roles.length) return error('Enter at least one role.');
      const availability = [];
      for (const i of week) {
        const from = values.get('from'+i), to = values.get('to'+i);
        if ((from || to) && (!from || !to || from >= to)) return error(days[i]+': enter an availability window with an end after its start.');
        availability.push(from ? [from,to] : null);
      }
      record = {name,roles,max:Number(values.get('max')),availability};
    } else {
      const start = values.get('start'), end = values.get('end');
      const requiredRole = role(values.get('role'));
      const selected = values.getAll('days').map(Number);
      if (!requiredRole) return error('Enter a role.');
      if (start >= end) return error('End time must be after start time.');
      if (!selected.length) return error('Select at least one day.');
      record = {name,role:requiredRole,start,end,count:Number(values.get('count')),days:selected};
    }
    if (index === undefined) data[kind].push(record);
    else data[kind][index] = record;
    dialog.close();
    save();
  };
  dialog.showModal();
}
for (const [selector,kind] of [['#people','team'],['#templates','templates']]) {
  $(selector).onclick = event => {
    const btn = event.target.closest('button');
    if (!btn) return;
    if (btn.dataset.edit !== undefined) edit(kind,Number(btn.dataset.edit));
    if (btn.dataset.remove !== undefined) {
      const index = Number(btn.dataset.remove);
      if (confirm('Remove '+data[kind][index].name+'?')) {
        data[kind].splice(index,1);
        save();
      }
    }
  };
}
$('#add-person').onclick = () => edit('team');
$('#add-shift').onclick = () => edit('templates');
$('#streak').onchange = event => {
  if (!event.target.reportValidity()) { event.target.value = data.streak; return; }
  data.streak = event.target.valueAsNumber;
  save();
};
for (const button of all('[data-view]')) button.onclick = () => {
  const view = button.dataset.view;
  all('[data-view]').forEach(b => {
    b.classList.toggle('selected', b === button);
    if (b === button) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
    document.getElementById(b.dataset.view).hidden = b.dataset.view !== view;
  });
};
$('[data-route]').onclick = () => $('[data-view="schedule"]').click();
$('#demo').onclick = () => {
  if (!confirm('Replace your current setup with sample data?')) return;
  data = sample();
  save();
  generate();
};
function generate() { result = solve(data.team,data.templates,data.streak); render(); renderAnalysis(); }
$('#generate').onclick = generate;
function csv(value) {
  let raw = String(value);
  if (/^[\s]*[=+@-]|^[\t\r\n]/u.test(raw)) raw = "'"+raw;
  return '"'+raw.replaceAll('"','""')+'"';
}
$('#export').onclick = () => {
  if (!result) return;
  const rows = [['Day','Shift','Role','Start','End','Assigned','Required','Open']];
  for (const s of result.rows) rows.push([days[s.day],s.name,s.role,s.start,s.end,
    s.people.map(i => data.team[i].name).join('; '),s.count,s.count-s.people.length]);
  const url = URL.createObjectURL(new Blob([rows.map(r => r.map(csv).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url; link.download = 'shiftloom-schedule.csv'; link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
};
render();

const dollar = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const pct = n => new Intl.NumberFormat('en-US',{style:'percent',maximumFractionDigits:1}).format(n);
const option = (value, label) => `<option value="${value}">${esc(label)}</option>`;
const waitForPaint = () => new Promise(resolve => setTimeout(resolve, 0));

function renderAnalysis() {
  const ready = Boolean(result?.total);
  $('#analysis-empty').hidden = ready;
  $('#analysis-tools').hidden = !ready;
  for (const id of ['labor-output','callout-output','ai-status','ai-copy']) document.getElementById(id).textContent = '';
  clearRiskAnalysis();
  if (!ready) return;
  const facts = weeklyFacts(result,data.team);
  const gaps = facts.dayCoverage.map(([filled,required], i) => ({day:days[i], open:required-filled})).filter(d => d.open)
    .sort((a,b) => b.open-a.open);
  const priorities = gaps.slice(0,3).map(g => `${g.day} (${g.open} open)`).join(', ');
  $('#brief-output').innerHTML = `<p><strong>${facts.filled} of ${facts.required} required positions filled</strong> across ${facts.scheduledHours} staff-hours.</p>
    <ul><li>${gaps.length ? 'Review staffing gaps first on '+priorities+'.' : 'All required positions are covered.'}</li>
    <li>${facts.unfilledWithNoEligibleStaff} open positions have no role-qualified employee available for the full shift.</li>
    <li>${facts.shiftsWithoutExtraEligibleStaff} shifts have no extra eligible employee based on role and availability. Run the call-out test to check coverage under all rules.</li>
    <li>${facts.atHourLimit} staff members are at their weekly hour limit.</li></ul>
    ${facts.limitedSearch ? '<p>The scheduler reached its search limit. Additional feasible coverage may exist.</p>' : ''}`;
  const templates = $('#labor-template');
  const prior = templates.value;
  templates.innerHTML = data.templates.map((shift,i) => option(i,shift.name)).join('');
  const sampleTemplate = data.templates.findIndex(shift => shift.name === 'Morning crew');
  if (prior !== '' && Number(prior) < data.templates.length) templates.value = prior;
  else if (sampleTemplate !== -1) templates.value = sampleTemplate;
  const people = [...new Set(result.rows.flatMap(row => row.people))].sort((a,b) => a-b);
  for (const id of ['callout-person','callout-day']) document.getElementById(id).disabled = !people.length;
  $('#callout-person').innerHTML = people.map(i => option(i,data.team[i].name)).join('');
  $('#callout-form button[type="submit"]').disabled = !people.length;
  $('#scan').disabled = !people.length;
  fillCalloutDays();
}

function fillCalloutDays() {
  const person = Number($('#callout-person').value);
  const worked = [...new Set(result?.rows.filter(row => row.people.includes(person)).map(row => row.day))].sort((a,b) => a-b);
  $('#callout-day').innerHTML = option(-1,'Full week') + worked.map(d => option(d,days[d])).join('');
}

$('#callout-person').onchange = fillCalloutDays;
let demandHistory = null;
let importRevision = 0;
const demandSource = $('#demand-source');
const resetDemand = $('#synthetic-demand');

function showDemandSource() {
  demandSource.textContent = demandHistory ? 'Imported CSV · '+demandHistory.length.toLocaleString()+' observations. Stored for this page session.' :
    'SYNTHETIC historical demand · fictional café.';
  resetDemand.hidden = !demandHistory;
}

$('#labor-form').oninput = event => {
  if (event.target.id === 'demand-file') return;
  $('#labor-output').textContent = '';
  clearRiskAnalysis();
};
$('#demand-file').onchange = async event => {
  const revision = ++importRevision;
  const file = event.target.files[0];
  clearRiskAnalysis();
  if (!file) return;
  $('#labor-output').textContent = '';
  try {
    if (file.size > 1000000) throw new Error('CSV must be 1 MB or smaller.');
    const rows = parseDemandCsv(await file.text());
    if (revision !== importRevision) return;
    demandHistory = rows;
    showDemandSource();
  } catch (error) {
    if (revision !== importRevision) return;
    event.target.value = '';
    showDemandSource();
    demandSource.textContent += ' Import failed: '+error.message;
  }
};
resetDemand.onclick = () => {
  clearRiskAnalysis();
  importRevision++;
  demandHistory = null;
  $('#demand-file').value = '';
  $('#labor-output').textContent = '';
  showDemandSource();
};

$('#labor-form').onsubmit = event => {
  event.preventDefault();
  if (!result?.total) return;
  clearRiskAnalysis();
  const fields = Object.fromEntries([...new FormData(event.currentTarget)].map(([key,value]) => [key,Number(value)]));
  fields.antithetic = event.currentTarget.elements.antithetic.checked;
  const template = data.templates[fields.template];
  let forecast;
  try {
    if (demandHistory && data.templates.filter(other => other.name === template.name).length > 1) {
      throw new Error('Use a unique shift template name before matching imported demand.');
    }
    const history = demandHistory ?? syntheticHistory(template.name,template.days);
    forecast = evaluateDemand(history,template.name,template.days,1000,fields.seed,fields.antithetic);
  } catch (error) {
    $('#labor-output').textContent = error.message;
    return;
  }
  const simulation = finance(data,result,fields.template,fields,forecast.scenarios);
  const sourceLabel = demandHistory ? 'Imported CSV' : 'SYNTHETIC historical demand';
  const forecastRows = forecast.forecasts.map(row =>
    `<tr><th scope="row">${row.date}</th><td>${row.p05}</td><td>${row.p50}</td><td>${row.p95}</td></tr>`).join('');
  const validation = `<h3>Demand forecast · ${sourceLabel}</h3>
    <p>${forecast.historyWeeks} weeks fitted. Weekday effects and a linear trend${forecast.annual ? ' with annual seasonality.' : '. Annual seasonality requires at least 52 training weeks.'}</p>
    <p><strong>Walk-forward validation</strong> · MAE ${forecast.mae.toFixed(1)} orders · 90% interval coverage ${pct(forecast.coverage)} (${forecast.hits}/${forecast.count} shifts over ${forecast.heldOutWeeks} held-out weeks).</p>
    <div class="table-wrap"><table class="analysis-table"><thead><tr><th scope="col">Date</th><th scope="col">5th percentile</th><th scope="col">Median</th><th scope="col">95th percentile</th></tr></thead><tbody>${forecastRows}</tbody></table></div>`;
  const [base,extra] = simulation.plans;
  const hours = extra.hours-base.hours;
  const cost = extra.cost-base.cost;
  const table = [
    ['Staff-hours',base.hours,extra.hours],
    ['Labor cost',dollar.format(base.cost),dollar.format(extra.cost)],
    ['Expected contribution after labor',dollar.format(base.expected),dollar.format(extra.expected)],
    ['Average contribution in worst 5% of weeks',dollar.format(base.worst),dollar.format(extra.worst)],
    ['Weeks with unmet demand',pct(base.risk),pct(extra.risk)]
  ].map(([label,a,b]) => `<tr><th scope="row">${label}</th><td>${a}</td><td>${b}</td></tr>`).join('');
  $('#labor-output').innerHTML = `${validation}<h3>Staffing comparison · ${sourceLabel}</h3><div class="table-wrap"><table class="analysis-table"><thead><tr><th scope="col">Weekly metric</th><th scope="col">Current</th><th scope="col">Expanded</th></tr></thead><tbody>${table}</tbody></table></div>
    <p><strong>${dollar.format(extra.expected-base.expected)}</strong> change in expected weekly contribution. The expanded plan beats the current plan in <strong>${pct(simulation.chance)}</strong> of ${simulation.samples.toLocaleString()} matched simulations.</p>
    <p>${hours ? `The solver placed ${hours} additional staff-hours at a cost of ${dollar.format(cost)}. ${fields.margin > 0 ? `${Math.ceil(cost / fields.margin - 1e-9)} additional orders cover that cost.` : cost > 0 ? 'Break-even requires positive contribution per order.' : ''}` : 'No additional staff-hours could be placed while keeping current assignments fixed.'}</p>
    <p class="model-note">Both plans use the same fitted demand scenarios, sampled from historical weeks of forecast errors. Orders above capacity are treated as unserved. Seed ${fields.seed}, ${fields.antithetic ? 'antithetic pairing' : 'independent draws'}. ${simulation.timedOut ? 'The expanded roster reached the search limit.' : ''}</p>`;
  runRiskAnalysis({data,roster:result,forecast,inputs:fields,sourceLabel,action:event.submitter?.value,sampleScenarios});
};

$('#callout-form').onsubmit = event => {
  event.preventDefault();
  if (!result?.total || $('#callout-person').value === '') return;
  const scenario = callout(data,result,Number($('#callout-person').value),Number($('#callout-day').value));
  const changes = scenario.changed.map(row => `<li>${days[row.day]} · ${esc(row.name)} (${row.start}–${row.end}) · ${row.people.length ? esc(row.people.map(i => data.team[i].name).join(', ')) : 'No assignments'}${row.count > row.people.length ? ' · '+(row.count-row.people.length)+' open' : ''}</li>`);
  $('#callout-output').innerHTML = `<p><strong>${esc(data.team[scenario.person].name)} · ${scenario.day < 0 ? 'Full week' : days[scenario.day]}</strong></p>
    <p>${scenario.filled} of ${scenario.total} required positions covered (${result.filled} before the call-out). ${scenario.moved} other assignments removed or moved.</p>
    ${changes.length ? '<ul>'+changes.join('')+'</ul>' : '<p>No assignments changed.</p>'}
    ${scenario.timedOut ? '<p>The search reached its time limit.</p>' : ''}`;
};

$('#scan').onclick = async () => {
  if (!result?.total) return;
  const startingRoster = result;
  const output = $('#callout-output');
  const button = $('#scan');
  const submit = $('#callout-form button[type="submit"]');
  button.disabled = submit.disabled = true;
  output.textContent = 'Testing full-week absences and potential cross-training…';
  const cases = [], candidates = [];
  try {
    for (const person of new Set(startingRoster.rows.flatMap(row => row.people))) {
      await waitForPaint();
      if (result !== startingRoster) return;
      cases.push(callout(data,startingRoster,person,-1));
    }
    const affected = cases.filter(s => s.filled < startingRoster.filled);
    for (const training of trainingCandidates(data,affected)) {
      let restored = 0, slots = 0;
      for (const scenario of training.cases) {
        await waitForPaint();
        if (result !== startingRoster) return;
        const rerun = callout(data,startingRoster,scenario.person,-1,training);
        restored += Number(rerun.filled >= startingRoster.filled);
        slots += Math.max(0,rerun.filled-scenario.filled);
      }
      if (slots) candidates.push({...training,restored,slots});
    }
    const best = candidates.sort((a,b) => b.restored-a.restored || b.slots-a.slots)[0];
    output.innerHTML = `<p><strong>${affected.length} of ${cases.length} absences</strong> reduced coverage below the current ${startingRoster.filled} filled positions.</p>
      ${affected.length ? '<ul>'+affected.map(s => `<li>${esc(data.team[s.person].name)} · ${s.filled} covered · ${s.gaps.length} shifts with gaps</li>`).join('')+'</ul>' : ''}
      ${best ? `<p><strong>Cross-training candidate</strong> · Train ${esc(data.team[best.person].name)} for ${esc(best.role)}. The tested scenarios restored the original coverage in ${best.restored} of ${affected.length} affected absences and recovered ${best.slots} positions across scenarios.</p>` : affected.length ? '<p>No single cross-training change improved the scenarios in the shortlist.</p>' : ''}
      ${affected.length ? '<p class="model-note">Tests up to six employee–role combinations shortlisted from the observed gaps. Results use bounded searches.</p>' : ''}`;
  } finally {
    if (result === startingRoster) button.disabled = submit.disabled = false;
  }
};

const aiRoute = '/api/weekly-brief';
fetch(aiRoute,{cache:'no-store'}).then(async response => {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
  $('#ai-controls').hidden = !(await response.json()).enabled;
}).catch(() => { /* The static site uses the rules-based brief. */ });

$('#ai-generate').onclick = async () => {
  const roster = result;
  if (!roster?.total) return;
  const token = prompt('Enter the summary access token set by your site administrator.');
  if (!token) return;
  $('#ai-generate').disabled = true;
  $('#ai-status').textContent = 'Writing brief…';
  $('#ai-copy').textContent = '';
  try {
    const response = await fetch(aiRoute,{
      method:'POST', headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
      body:JSON.stringify(weeklyFacts(roster,data.team))
    });
    if (!response.ok) throw new Error('Brief unavailable');
    const payload = await response.json();
    if (result !== roster) return;
    $('#ai-status').textContent = 'AI-generated from this roster’s aggregate metrics.';
    $('#ai-copy').textContent = payload.brief;
  } catch {
    if (result === roster) $('#ai-status').textContent = 'AI generation failed. Check the access token and hosting configuration, or use the brief above.';
  } finally { $('#ai-generate').disabled = false; }
};

renderAnalysis();
