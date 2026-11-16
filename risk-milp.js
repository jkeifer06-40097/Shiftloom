import {minutes} from './solver.js?v=5';
import {capacity,riskMetrics} from './risk.js?v=5';

export function rosterRows(roster) {
  return roster.rows.map(row => ({...row,duration:minutes(row.end)-minutes(row.start)}));
}

export function optimize(highs, data, roster, template, scenarios, productivity, limit, seed) {
  const rows = rosterRows(roster);
  const selected = rows.map((row,i) => row.template === template ? i : -1).filter(i => i >= 0);
  const binaries = ['unused'];
  const constraints = ['unused = 0'];
  const obj = [];
  const assignment = rows.map((row,i) => row.eligible.map(person => {
    const variable = 'x'+i+'_'+person;
    binaries.push(variable);
    obj.push(row.duration+' '+variable);
    return {person,variable};
  }));
  const terms = items => items.length ? items.join(' + ') : 'unused';
  const expression = row => terms(assignment[row].map(item => item.variable));

  // Only qualified, available employees have assignment variables. Every
  // shift must meet its minimum, including those outside the modeled demand.
  rows.forEach((row,i) => constraints.push(expression(i)+' >= '+row.count));
  data.team.forEach((member,person) => {
    const work = rows.flatMap((row,i) => {
      const match = assignment[i].find(x => x.person === person);
      return match ? [{...row,variable:match.variable}] : [];
    });
    constraints.push(terms(work.map(row => row.duration+' '+row.variable))+' <= '+Math.floor(member.max*60));
    for (let i=0;i<work.length;i++) {
      for (let j=i+1;j<work.length;j++) {
        const a=work[i], b=work[j];
        if (a.day===b.day && a.start<b.end && b.start<a.end) constraints.push(a.variable+' + '+b.variable+' <= 1');
      }
    }
    if (data.streak === 7 || !work.length) return;
    const active = Array.from({length:7},(_,day) => 'd'+person+'_'+day);
    binaries.push(...active);
    for (const row of work) constraints.push(row.variable+' - '+active[row.day]+' <= 0');
    // At least one day off in each window of streak + 1 days.
    for (let start=0;start+data.streak<7;start++) {
      constraints.push(terms(active.slice(start,start+data.streak+1))+' <= '+data.streak);
    }
  });

  // Convert demand to the minimum required headcount. Group identical
  // requirements and keep their original scenario frequencies as weights.
  const groups = new Map();
  for (const demand of scenarios) {
    const requirements = selected.map((index,j) => {
      const row = rows[index];
      let required = Math.max(row.count,Math.floor(demand[j]*60/(row.duration*productivity)));
      while (capacity(row,required,productivity) < demand[j]) required++;
      while (required>row.count && capacity(row,required-1,productivity)>=demand[j]) required--;
      return Math.min(required,assignment[index].length+1);
    });
    const key = requirements.join(',');
    if (!groups.has(key)) groups.set(key,{requirements,frequency:0});
    groups.get(key).frequency++;
  }
  const tolerated = Math.floor(limit * scenarios.length + 1e-8);
  const risk = [];
  let unavoidable = 0;
  for (const {requirements,frequency} of groups.values()) {
    if (requirements.some((need,j) => need>assignment[selected[j]].length)) {
      unavoidable += frequency;
      continue;
    }
    const active = requirements.map((need,j) => ({need,index:selected[j]})).filter(({need,index}) => need>rows[index].count);
    if (!active.length) continue;
    const violated = 'z'+risk.length;
    binaries.push(violated);
    risk.push(frequency+' '+violated);
    // One common binary for the whole scenario. Switching it on relaxes
    // every shift constraint back to the hard minimum staffing level.
    for (const {need,index} of active) constraints.push(expression(index)+' + '+(need-rows[index].count)+' '+violated+' >= '+need);
  }
  constraints.push(terms(risk)+' <= '+(tolerated-unavoidable));
  const lp = 'Minimize\n cost: '+terms(obj)+'\nSubject To\n '+constraints.join('\n ')+'\nBinary\n '+binaries.join('\n ')+'\nEnd\n';
  return highs.withModel({format:'lp',data:lp}, model => {
    model.options.set({output_flag:false,time_limit:4,mip_rel_gap:0,mip_abs_gap:0,random_seed:seed % 2147483647});
    const start = performance.now();
    model.run();
    const millis = performance.now()-start;
    const statusCode = model.getModelStatus();
    const status = Object.entries(highs.constants.modelStatus).find(([,value]) => value === statusCode)?.[0] ?? String(statusCode);
    const feasible = model.info.get('primal_solution_status') === highs.constants.solutionStatus.feasible;
    const summary = {status,millis,groups:groups.size};
    if (!feasible) return summary;
    const values = model.getSolution().colValue;
    const plan = rows.map((row,i) => ({...row,people:assignment[i].filter(item =>
      values[model.getColByName(item.variable)] > 0.5).map(item => item.person)}));
    const paidMinutes = plan.reduce((sum,row) => sum+row.duration*row.people.length,0);
    const metrics = riskMetrics(selected.map(i => plan[i]),scenarios,productivity);
    const bound = Number(model.info.get('mip_dual_bound'));
    const gap = Number(model.info.get('mip_gap'));
    return {...summary,plan,paidMinutes,metrics,
      bound:Number.isFinite(bound) ? bound : null,
      gap:status === 'optimal' ? 0 : Number.isFinite(gap) ? gap : null};
  });
}
