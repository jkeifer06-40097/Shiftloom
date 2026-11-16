import assert from 'node:assert/strict';
import {test} from 'node:test';
import load from './vendor/highs.mjs';
import {solve} from './solver.js';
import {optimize} from './risk-milp.js';
import {sampleScenarios} from './forecast.js';
import {cvar,convergence} from './risk.js';

const highs = await load();
const defaultWeek = Array.from({length:7},() => ['08:00','16:00']);
const worker = (name, options = {}) => ({name,max:40,roles:['crew'],availability:defaultWeek,...options});
const shift = (days, options = {}) => ({name:'AM',role:'crew',count:1,start:'08:00',end:'12:00',days,...options});
function optimizeCase(team,templates,streak,scenarios,limit=1) {
  return optimize(highs,{team,templates,streak},solve(team,templates,streak),0,scenarios,10,limit,9);
}

test('CVaR uses exact fractional mass at the tail boundary', () => {
  // At 70% and four observations, the tail is 1.2 observations.
  assert.ok(Math.abs(cvar([0,5,10,20],0.7) - (20+0.2*10)/1.2) < 1e-12);
  assert.ok(Math.abs(cvar([10,20,30,40],0.95)-40)<1e-12);
});

test('chance constraint forces the cheapest additional coverage and can be infeasible', () => {
  const team = [worker('A'),worker('B')];
  const scenarios = [[40],[60],[100]];
  const result = optimizeCase(team,[shift([0])],4,scenarios,1/3);
  assert.equal(result.status,'optimal');
  assert.equal(result.gap,0);
  assert.equal(result.paidMinutes,480);
  assert.equal(result.metrics.probability,1/3);
  assert.ok(Math.abs(result.metrics.cvar-20)<1e-12);
  assert.equal(optimizeCase(team,[shift([0])],4,scenarios,0).status,'infeasible');
});

test('hard minimums, role qualifications, and full-shift availability apply', () => {
  const team = [worker('Qualified'),worker('Wrong role',{roles:['lead']}),
    worker('Short window',{availability:[['08:00','11:59']]})];
  const result = optimizeCase(team,[shift([0])],4,[[0]]);
  assert.deepEqual(result.plan[0].people,[0]);
  assert.equal(optimizeCase(team,[shift([0],{count:2})],4,[[0]]).status,'infeasible');
});

test('hour caps, overlap, and consecutive workday limits apply', () => {
  assert.equal(optimizeCase([worker('A',{max:7})],[shift([0,1])],4,[[0,0]]).status,'infeasible');
  assert.equal(optimizeCase([worker('A')],[shift([0,1,2])],2,[[0,0,0]]).status,'infeasible');
  assert.equal(optimizeCase([worker('A')],[shift([0]),shift([0],{start:'10:00',end:'14:00'})],4,[[0]]).status,'infeasible');
  const result = optimizeCase([worker('A',{max:8})],[shift([0,2])],1,[[0,0]]);
  assert.equal(result.status,'optimal');
  assert.equal(result.paidMinutes,480);
});

test('antithetic draws keep complementary ranks and convergence is reproducible', () => {
  const pool = [[1],[2],[3],[4]];
  const draws = sampleScenarios(pool,10,327321,true);
  for (let i=0;i<draws.length;i+=2) assert.equal(draws[i][0]+draws[i+1][0],5);
  assert.deepEqual(draws,sampleScenarios(pool,10,327321,true));
  const rows = [{duration:60,people:[]}];
  const inputs = {seed:327321,antithetic:true,productivity:10};
  const trend = convergence(rows,pool,inputs,sampleScenarios);
  assert.deepEqual(trend,convergence(rows,pool,inputs,sampleScenarios));
  assert.ok(trend.every(p => p.low<=p.estimate && p.estimate<=p.high && p.low>=0));
});
