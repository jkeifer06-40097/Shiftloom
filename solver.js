export const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
export const minutes = time => Number(time.slice(0,2))*60 + Number(time.slice(3));
export function solve(team, templates, streak, budget = 350, locked = []) {
  const shifts = templates.flatMap((t, template) => t.days.map(day => ({
    ...t, template, day, eligible: team.flatMap((person, i) => {
      const window = person.availability[day];
      return person.roles.some(role => role.toLowerCase() === t.role.toLowerCase()) && window && window[0] <= t.start && window[1] >= t.end ? [i] : [];
    })
  }))).sort((a,b) => a.eligible.length-b.eligible.length || a.day-b.day || a.start.localeCompare(b.start));
  const assigned = shifts.map(() => []);
  const workloads = team.map(() => []);
  const hours = team.map(() => 0);
  const duration = s => minutes(s.end)-minutes(s.start);
  function canWork(i, s) {
    if (hours[i]+duration(s) > team[i].max*60) return false;
    const work = workloads[i];
    if (work.some(other => other.day === s.day && other.start < s.end && s.start < other.end)) return false;
    const workingDays = new Set(work.map(other => other.day));
    if (workingDays.has(s.day)) return true;
    let count = 1;
    for (let d=s.day-1;workingDays.has(d);d--) count++;
    for (let d=s.day+1;workingDays.has(d);d++) count++;
    return count <= streak;
  }
  shifts.forEach((shift, index) => {
    const fixed = locked.find(row => row.template === shift.template && row.day === shift.day);
    for (const person of fixed?.people ?? []) {
      if (!shift.eligible.includes(person) || !canWork(person, shift)) continue;
      assigned[index].push(person);
      workloads[person].push(shift);
      hours[person] += duration(shift);
    }
  });
  const fixedCount = assigned.reduce((sum, row) => sum + row.length, 0);
  let best = assigned.map(list => [...list]), filled = fixedCount, timedOut = false, completed = false;
  const fixedByShift = assigned.map(row => row.length);
  const capacity = Array(shifts.length+1).fill(0);
  for (let i=shifts.length-1;i>=0;i--) {
    capacity[i] = capacity[i+1]+Math.min(shifts[i].count,shifts[i].eligible.length)-fixedByShift[i];
  }
  const total = shifts.reduce((n,s) => n+s.count,0);
  const end = performance.now()+budget;
  function search(index, covered, nextCandidate = 0) {
    if (covered > filled) {
      filled = covered;
      best = assigned.map(list => [...list]);
    }
    if (filled === total) { completed = true; return; }
    if (index === shifts.length) return;
    if (performance.now() > end) { timedOut = true; return; }
    const s = shifts[index], row = assigned[index];
    if (covered+capacity[index]-(row.length-fixedByShift[index]) <= filled) return;
    if (row.length < s.count) {
      const candidates = s.eligible.slice(nextCandidate).filter(i => !row.includes(i) && canWork(i,s))
        .sort((a,b) => hours[a]-hours[b] || a-b);
      for (const i of candidates) {
        row.push(i); workloads[i].push(s); hours[i]+=duration(s);
        search(index,covered+1,s.eligible.indexOf(i)+1);
        hours[i]-=duration(s); workloads[i].pop(); row.pop();
        if (completed || timedOut) return;
      }
    }
    search(index+1,covered);
  }
  search(0,fixedCount);
  return {total,filled,timedOut,rows:shifts.map((s,i) => ({...s,people:best[i]}))
    .sort((a,b) => a.day-b.day || a.start.localeCompare(b.start) || a.name.localeCompare(b.name))};
}
