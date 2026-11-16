// Expected shortfall averages exactly the worst (1-confidence) mass.
// The last observation gets fractional weight when the tail cuts a sample.
export function cvar(losses, confidence = 0.95) {
  const sorted = [...losses].sort((a,b) => b-a);
  const tail = sorted.length * (1-confidence);
  const whole = Math.floor(tail);
  const total = sorted.slice(0,whole).reduce((a,b) => a+b,0);
  return (total + (tail-whole)*(sorted[whole] ?? 0)) / tail;
}

export function capacity(row, headcount, productivity) {
  return Math.floor(row.duration * headcount * productivity / 60);
}

export function shortfallLosses(rows, scenarios, productivity) {
  const capacities = rows.map(row => capacity(row,row.people.length,productivity));
  return scenarios.map(demand => demand.reduce((loss, orders, i) => loss + Math.max(0,orders-capacities[i]),0));
}

export function riskMetrics(rows, scenarios, productivity) {
  const losses = shortfallLosses(rows,scenarios,productivity);
  return {cvar:cvar(losses), probability:losses.filter(loss => loss > 0).length / losses.length};
}

export function convergence(rows, pool, inputs, sampleScenarios) {
  const replicates = 32;
  return [50,100,250,500,1000].map(size => {
    const estimates = Array.from({length:replicates},(_,i) => {
      const seed = (inputs.seed + Math.imul(i+1,0x9e3779b9)) >>> 0;
      const scenarios = sampleScenarios(pool,size,seed,inputs.antithetic);
      return cvar(shortfallLosses(rows,scenarios,inputs.productivity));
    });
    const estimate = estimates.reduce((a,b) => a+b,0)/replicates;
    const variance = estimates.reduce((sum,value) => sum+(value-estimate)**2,0)/(replicates-1);
    // Two-sided 95% Student t critical value with 31 degrees of freedom.
    const halfWidth = 2.039513 * Math.sqrt(variance/replicates);
    return {size,estimate,low:Math.max(0,estimate-halfWidth),high:estimate+halfWidth};
  });
}
