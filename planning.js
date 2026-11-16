import {cvar,capacity} from './risk.js?v=5';
import {days, minutes, solve} from './solver.js?v=3';

const duration = row => (minutes(row.end) - minutes(row.start)) / 60;
const rowKey = row => row.template + ':' + row.day;
const total = values => values.reduce((sum, value) => sum + value, 0);
const average = values => total(values) / values.length;

export function weeklyFacts(roster, team) {
  const dayRows = days.map((_, day) => roster.rows.filter(row => row.day === day));
  const hours = team.map((_, person) => total(roster.rows.filter(row => row.people.includes(person)).map(duration)));
  return {
    filled: roster.filled,
    required: roster.total,
    scheduledHours: total(hours),
    atHourLimit: hours.filter((h, i) => h > 0 && h === team[i].max).length,
    dayCoverage: dayRows.map(rows => [total(rows.map(row => row.people.length)), total(rows.map(row => row.count))]),
    unfilledWithNoEligibleStaff: total(roster.rows.filter(row => row.eligible.length === 0).map(row => row.count)),
    shiftsWithoutExtraEligibleStaff: roster.rows.filter(row => row.eligible.length > 0 && row.eligible.length <= row.people.length).length,
    limitedSearch: roster.timedOut
  };
}

export function finance(data, roster, template, inputs, scenarios) {
  const expanded = data.templates.map((row, i) => i === template ? {...row, count:row.count + 1} : {...row, days:[]});
  for (const row of roster.rows) {
    if (row.template === template) continue;
    expanded.push({...row, days:[row.day], count:row.people.length});
  }
  let index = expanded.length - (roster.rows.length - roster.rows.filter(row => row.template === template).length);
  const locked = roster.rows.map(row => row.template === template ? row : {...row, template:index++});
  const alternative = solve(data.team, expanded, data.streak, 180, locked);
  const currentRows = roster.rows.filter(row => row.template === template);
  const alternativeRows = alternative.rows.filter(row => row.template === template);
  const plans = [currentRows, alternativeRows].map(rows => ({
    capacities: rows.map(row => capacity({duration:minutes(row.end)-minutes(row.start)},row.people.length,inputs.productivity)),
    cost: total(rows.map(row => duration(row) * row.people.length)) * inputs.wage,
    hours: total(rows.map(row => duration(row) * row.people.length)),
    profits: [],
    shortageWeeks: 0
  }));
  // Use exactly the same fitted demand draws for both staffing plans.
  const samples = scenarios.length;
  for (const demand of scenarios) {
    for (const plan of plans) {
      const served = demand.map((orders, i) => Math.min(orders, plan.capacities[i]));
      if (served.some((count, i) => count < demand[i])) plan.shortageWeeks++;
      plan.profits.push(total(served) * inputs.margin - plan.cost);
    }
  }
  const improvement = plans[1].profits.map((profit, i) => profit - plans[0].profits[i]);
  return {
    plans: plans.map(plan => ({
      hours:plan.hours, cost:plan.cost,
      expected:average(plan.profits),
      worst:-cvar(plan.profits.map(profit => -profit)),
      risk:plan.shortageWeeks / samples
    })),
    chance:improvement.filter(value => value > 1e-8).length / samples,
    timedOut:alternative.timedOut,
    samples
  };
}

export function callout(data, roster, person, day, training) {
  const team = data.team.map((member, i) => ({
    ...member,
    roles: training?.person === i ? [...member.roles, training.role] : member.roles,
    availability: i === person ? member.availability.map((window, d) => day === -1 || day === d ? null : window) : member.availability
  }));
  const locked = roster.rows.map(row => ({
    ...row, people:row.people.filter(p => p !== person || (day !== -1 && day !== row.day))
  }));
  let recovered = solve(team,data.templates,data.streak,55,locked);
  if (recovered.filled < roster.total) {
    const rebuilt = solve(team,data.templates,data.streak,55);
    if (rebuilt.filled > recovered.filled) recovered = rebuilt;
    else recovered.timedOut ||= rebuilt.timedOut;
  }
  const before = new Map(locked.map(row => [rowKey(row), row.people]));
  const original = new Map(roster.rows.map(row => [rowKey(row), row.people]));
  return {
    person, day, filled:recovered.filled, total:roster.total, timedOut:recovered.timedOut,
    moved:total(recovered.rows.map(row => before.get(rowKey(row)).filter(p => !row.people.includes(p)).length)),
    changed: recovered.rows.filter(row => {
      const old = original.get(rowKey(row));
      return old.length !== row.people.length || old.some(p => !row.people.includes(p));
    }),
    gaps: recovered.rows.filter(row => row.people.length < row.count)
  };
}

export function trainingCandidates(data, cases) {
  const scores = new Map();
  for (const scenario of cases) {
    const counted = new Set();
    for (const gap of scenario.gaps) {
      data.team.forEach((member, person) => {
        const role = gap.role.toLowerCase();
        const window = member.availability[gap.day];
        if (person === scenario.person || member.roles.some(r => r.toLowerCase() === role) ||
            !window || window[0] > gap.start || window[1] < gap.end || member.max < duration(gap)) return;
        const key = person + ':' + role;
        if (counted.has(key)) return;
        counted.add(key);
        const score = scores.get(key) ?? {person, role:gap.role, cases:[]};
        score.cases.push(scenario);
        scores.set(key,score);
      });
    }
  }
  return [...scores.values()].sort((a,b) => b.cases.length-a.cases.length).slice(0,6);
}
