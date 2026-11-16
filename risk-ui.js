import {convergence,riskMetrics} from './risk.js?v=5';
import {rosterRows} from './risk-milp.js?v=5';

const $ = selector => document.querySelector(selector);
const money = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const decimal = number => number.toLocaleString('en-US',{maximumFractionDigits:2});
const percent = number => decimal(number*100)+'%';
const weekdays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
let active;

export function clearRiskAnalysis() {
  if (active) {
    active.worker.terminate();
    active.reject?.(new Error('Cancelled'));
    active = undefined;
  }
  $('#risk-output').textContent = '';
}

function request(job, payload) {
  return new Promise((resolve,reject) => {
    job.reject = reject;
    job.worker.onmessage = ({data}) => data.error ? reject(new Error(data.error)) : resolve(data.result);
    job.worker.onerror = () => reject(new Error('The browser could not load the HiGHS solver.'));
    job.worker.postMessage(payload);
  });
}

function table(headers,rows) {
  const node = document.createElement('table');
  node.className = 'analysis-table';
  const head = node.createTHead().insertRow();
  const body = node.createTBody();
  for (const label of headers) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    head.append(th);
  }
  for (const row of rows) {
    const tr = body.insertRow();
    row.forEach((value,index) => {
      const cell = document.createElement(index ? 'td' : 'th');
      if (!index) cell.scope = 'row';
      cell.textContent = value;
      tr.append(cell);
    });
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'table-wrap';
  wrapper.append(node);
  return wrapper;
}

function text(parent,tag,content) {
  const node = document.createElement(tag);
  node.textContent = content;
  parent.append(node);
  return node;
}

function summary(parent,title,tableNode) {
  const details = document.createElement('details');
  details.className = 'risk-details';
  text(details,'summary',title);
  details.append(tableNode);
  parent.append(details);
}

function drawPlot(parent, trend) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 280;
  canvas.className = 'risk-plot';
  canvas.setAttribute('role','img');
  canvas.setAttribute('aria-label','CVaR estimates and confidence intervals by scenario count. Exact values follow.');
  parent.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const margin = {left:65,right:25,top:25,bottom:55};
  const bottom = canvas.height-margin.bottom;
  const low = Math.min(...trend.map(point => point.low));
  const high = Math.max(...trend.map(point => point.high));
  const pad = Math.max((high-low)*0.2,0.5);
  const min = Math.max(0,low-pad);
  const max = high+pad;
  const x = index => margin.left + (trend[index].size-trend[0].size)*(canvas.width-margin.left-margin.right)/(trend.at(-1).size-trend[0].size);
  const y = value => bottom-(value-min)*(bottom-margin.top)/(max-min);
  ctx.fillStyle = '#526173';
  ctx.strokeStyle = '#dce3e9';
  ctx.font = '12px system-ui';
  for (let tick=0;tick<=4;tick++) {
    const value = min + tick*(max-min)/4;
    ctx.beginPath(); ctx.moveTo(x(0),y(value)); ctx.lineTo(x(trend.length-1),y(value)); ctx.stroke();
    ctx.fillText(decimal(value),8,y(value)+4);
  }
  trend.forEach((point,i) => ctx.fillText(point.size.toLocaleString(),x(i)-12,bottom+20));
  ctx.fillText('Scenarios per estimate',canvas.width/2-58,bottom+42);
  ctx.fillText('Unserved orders',8,14);
  ctx.strokeStyle = '#075746';
  ctx.fillStyle = '#075746';
  ctx.lineWidth = 2;
  ctx.beginPath();
  trend.forEach((point,i) => {
    if (i) ctx.lineTo(x(i),y(point.estimate));
    else ctx.moveTo(x(i),y(point.estimate));
  });
  ctx.stroke();
  trend.forEach((point,i) => {
    ctx.beginPath(); ctx.moveTo(x(i),y(point.high)); ctx.lineTo(x(i),y(point.low));
    for (const bound of [point.high,point.low]) { ctx.moveTo(x(i)-5,y(bound)); ctx.lineTo(x(i)+5,y(bound)); }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x(i),y(point.estimate),3,0,2*Math.PI); ctx.fill();
  });
}

function showConvergence(output, rows, forecast, inputs, draw, planLabel) {
  text(output,'h3','Shortfall CVaR convergence · '+planLabel);
  text(output,'p','The plot shows the mean estimate and pointwise 95% t intervals across 32 repeated simulations at each sample size. It measures Monte Carlo uncertainty conditional on the fitted model, with the staffing plan held fixed.');
  const trend = convergence(rows,forecast.pool,inputs,draw);
  drawPlot(output,trend);
  summary(output,'View convergence values',table(['Scenarios','Mean CVaR','95% lower','95% upper'],
    trend.map(p => [p.size,decimal(p.estimate),decimal(p.low),decimal(p.high)])));
}

export async function runRiskAnalysis({data,roster,forecast,inputs,sourceLabel,action,sampleScenarios}) {
  const output = $('#risk-output');
  const selected = rows => rows.filter(row => row.template === inputs.template);
  const baseline = rosterRows(roster);
  if (action !== 'optimize' && action !== 'benchmark') {
    text(output,'p',sourceLabel+' · Current roster 95% shortfall CVaR: '+decimal(riskMetrics(selected(baseline),forecast.scenarios,inputs.productivity).cvar)+' unserved orders.');
    showConvergence(output,selected(baseline),forecast,inputs,sampleScenarios,'current roster');
    return;
  }
  const job = {worker:new Worker(new URL('./risk-worker.js?v=5',import.meta.url),{type:'module'})};
  active = job;
  const payload = {data,roster,template:inputs.template,scenarios:forecast.scenarios,productivity:inputs.productivity,limit:inputs.riskLimit/100,seed:inputs.seed};
  const label = action === 'benchmark' ? 'Solver scaling benchmark' : 'Risk-constrained staffing plan';
  text(output,'h3',label+' · '+sourceLabel);
  const status = text(output,'p','Running HiGHS locally…');
  try {
    if (action === 'benchmark') {
      const expandedTeam = [...data.team,...data.team.map(member => ({...member,name:member.name+' (benchmark copy)'}))];
      const largerData = {...data,team:expandedTeam};
      const largerRoster = {...roster,rows:roster.rows.map(row => ({...row,eligible:[
        ...row.eligible,...row.eligible.map(index => index+data.team.length)
      ]}))};
      const rows = [];
      for (const [d,r] of [[data,roster],[largerData,largerRoster]]) {
        for (const count of [100,1000]) {
          const result = await request(job,{...payload,data:d,roster:r,scenarios:forecast.scenarios.slice(0,count)});
          rows.push([d.team.length,count,result.groups,decimal(result.millis)+' ms',result.status]);
        }
      }
      status.textContent = 'Measured in this browser. The larger case duplicates the current team for benchmarking. Times exclude model construction and solver loading. Repeated demand requirements are grouped.';
      output.append(table(['Staff','Scenarios','Unique requirements','Solve time','Status'],rows));
      return;
    }
    const optimized = await request(job,payload);
    const baseRisk = riskMetrics(selected(baseline),forecast.scenarios,inputs.productivity);
    const baseCost = baseline.reduce((sum,row) => sum+row.duration*row.people.length,0)*inputs.wage/60;
    const havePlan = Boolean(optimized.plan);
    const cost = havePlan ? optimized.paidMinutes*inputs.wage/60 : null;
    status.textContent = 'HiGHS status: '+optimized.status+' · '+decimal(optimized.millis)+' ms solve time · optimality gap '+(optimized.gap == null ? 'unavailable' : percent(optimized.gap))+'.';
    text(output,'p','Maximum modeled probability of any unmet demand: '+percent(payload.limit)+
      '. Risk covers the selected shift template. Labor cost covers the full weekly roster.');
    output.append(table(['Metric','Current baseline','Optimized'],[
      ['Weekly labor cost',money.format(baseCost),havePlan ? money.format(cost) : '—'],
      ['Labor cost change','—',havePlan ? money.format(cost-baseCost) : '—'],
      ['Weeks with unmet demand',percent(baseRisk.probability),havePlan ? percent(optimized.metrics.probability) : '—'],
      ['95% CVaR of shortfall, orders',decimal(baseRisk.cvar),havePlan ? decimal(optimized.metrics.cvar) : '—']
    ]));
    if (!havePlan) {
      text(output,'p',optimized.status === 'infeasible' ? 'No roster satisfies both the hard scheduling rules and this risk cap.' : 'The solver returned no feasible roster within its limits.');
      return;
    }
    summary(output,'View chosen weekly assignments',table(['Day','Shift','Assigned staff'],optimized.plan.map(row =>
      [weekdays[row.day],row.name,row.people.map(i => data.team[i].name).join(', ')])));
    showConvergence(output,selected(optimized.plan),forecast,inputs,sampleScenarios,'optimized roster');
  } catch (error) {
    if (active === job) status.textContent = error.message;
  } finally {
    job.worker.terminate();
    if (active === job) active = undefined;
  }
}
