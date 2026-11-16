import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseDemandCsv,syntheticHistory,evaluateDemand} from './forecast.js';
import {finance,callout} from './planning.js';
import {solve} from './solver.js';

test('CSV accepts quoted template names and rejects invalid dates and duplicates', () => {
  assert.equal(parseDemandCsv('date,shift,demand\r\n2025-01-06,"Cafe, early",23')[0].shift,'Cafe, early');
  assert.throws(() => parseDemandCsv('date,shift,demand\n2025-02-30,AM,4'),/valid date/);
  assert.throws(() => parseDemandCsv('date,shift,demand\n2025-01-06,AM,4\n2025-01-06,AM,5'),/Duplicate/);
});

test('held-out outcomes never enter training and interval bounds are inclusive', () => {
  const monday = Date.UTC(2025,0,6);
  const history = Array.from({length:9},(_,i) => ({time:monday+i*604800000,shift:'AM',demand:i===8 ? 100 : 20}));
  const scored = evaluateDemand(history,'AM',[0]);
  assert.equal(scored.mae,80);
  assert.equal(scored.hits,0);
  assert.equal(scored.count,1);
  history[8].demand = 20;
  const flat = evaluateDemand(history,'AM',[0]);
  assert.equal(flat.mae,0);
  assert.equal(flat.coverage,1);
  assert.deepEqual(flat.forecasts,[{date:'2025-03-10',p05:20,p50:20,p95:20}]);
  assert.throws(() => evaluateDemand(history.filter((_,i) => i!==3),'AM',[0]),/Missing/);
});

test('synthetic history fits annual seasonality with reproducible draws', () => {
  const rows = syntheticHistory('AM',[0,5]);
  const result = evaluateDemand(rows,'AM',[0,5]);
  assert.equal(result.heldOutWeeks,52);
  assert.equal(result.count,104);
  assert.equal(result.annual,true);
  assert.equal(result.scenarios.length,1000);
  assert.ok(result.forecasts.every(row => row.p05 <= row.p50 && row.p50 <= row.p95));
  assert.deepEqual(result.scenarios,evaluateDemand(rows,'AM',[0,5]).scenarios);
});

test('staffing analysis shares the supplied scenarios and existing call-outs still solve', () => {
  const team = ['A','B'].map(name => ({name,max:8,roles:['crew'],availability:[['08:00','12:00']]}));
  const templates = [{name:'AM',role:'crew',days:[0],count:1,start:'08:00',end:'12:00'}];
  const data = {team,templates,streak:4};
  const roster = solve(team,templates,4);
  const scenarios = [[40],[60],[100]];
  const result = finance(data,roster,0,{wage:18,margin:6,productivity:10},scenarios);
  assert.deepEqual(result.plans.map(plan => plan.worst),[168,96]);
  assert.deepEqual(result.plans.map(plan => plan.risk),[2/3,1/3]);
  assert.equal(result.chance,2/3);
  assert.equal(callout(data,roster,roster.rows[0].people[0],-1).filled,1);
});
