# Shiftloom methodology

## Demand forecast and validation

One observation is the number of orders demanded for a dated occurrence of a
single shift template. Demand should include unserved orders if measurable.
Observed sales can understate demand when staffing constrained historical
service. The CSV requires complete weeks for the template's scheduled days.
The alternative **SYNTHETIC** dataset represents a fictional café. It has
weekday effects, an annual cycle, a mild trend, noise shared within a week,
and occasional spikes. It demonstrates the workflow.

First subtract each week's mean from each observation. Averaging those
differences across weeks estimates the weekday offsets. The schedule has
the same weekdays in each input week, so all weeks are balanced. Fit the
weekly means with ordinary least squares using an intercept and a linear
trend. With 52 or more weeks, add one annual sine/cosine pair. Use QR to
solve least squares without squaring the design matrix's condition number.
This model is small, transparent, and separates weekly changes from
differences between days. It omits holidays and interactions, and even a full
year can be too little to establish a reliable annual pattern.

For the next week, add each historical fitted residual week to the predicted
weekday levels, round to integer orders, and floor at zero. The 5th, 50th,
and 95th percentiles are inverse empirical CDF quantiles of this pool. Whole
weeks preserve the observed dependence between days. This residual bootstrap
assumes historical forecast errors still represent future variability. It
omits explicit parameter and structural uncertainty.

Walk-forward validation starts after eight training weeks and refits on only
earlier data at each held-out week. It reports up to the last 52 held-out
weeks. The MAE is the average absolute error of the median forecast. The
coverage rate is the share of held-out observations inside the inclusive
5th-to-95th percentile interval. A nominal 90% interval can have different
empirical coverage, especially with few observations or discrete counts.

## Baseline and risk-constrained MILP

The scheduling tab retains the existing bounded assignment search. Its
current roster is the baseline. The original finance comparison also retains
the expanded plan that attempts one extra position per selected shift while
preserving assignments. The risk solve finds a separate proposal for the
entire week. Viewing the proposal does not apply it to the roster.

Use a binary variable for each employee and shift only if the employee is
qualified and available throughout the shift. Each shift must meet its
minimum. Overlapping shifts cannot share an employee. A weighted sum of
shift durations enforces each person's weekly hour cap. Working a shift
activates its day, and every window of one more than the allowed consecutive
days must contain a day off. These windows are within Monday–Sunday.

Orders a shift can serve equal its assigned headcount times hours times
assumed orders per staff-hour, rounded down. For each demand scenario for the
selected template, calculate the minimum staff required to serve all its
orders. One binary variable marks whether a scenario is allowed to miss
demand on any of its days. If that binary is zero, every day must satisfy its
required headcount. If it is one, each shift still has its hard staffing
minimum. Identical required-headcount vectors are grouped and weighted by
their original scenario frequency. Scenarios that exceed even the number of
eligible staff on a day consume risk budget automatically.

The chance constraint allows at most the user-entered fraction of the 1,000
scenarios to be marked. HiGHS minimizes paid minutes for the whole roster.
With one positive hourly wage, this is exactly equivalent to minimizing
weekly labor cost, which is fixed once a plan is chosen. At zero wage, paid
minutes break ties. Risk is measured only for the selected template. A plan
can be infeasible because of the risk cap or the hard rules. If HiGHS reaches
its four-second solve limit, a feasible incumbent is shown when available.
The reported gap is HiGHS' relative MIP gap. Without an incumbent a gap may
be unavailable. The benchmark doubles the current team with hypothetical
copies and times the solver at 100 and 1,000 scenarios. Counts can compress
to the same model when demand maps to the same staffing requirements.

## Risk measures and Monte Carlo

Unmet-demand probability is the share of sampled weeks with any unserved
orders for the selected template. Shortfall loss is the number of unserved
orders summed over those shifts. At 95%, CVaR is average loss in exactly the
worst 5% of probability mass, using fractional weight at the cutoff when
the empirical sample count does not divide evenly. The existing contribution
comparison also uses exact tail mass for the worst-5% contribution measure.
Contribution before fixed costs is served orders times contribution per
order, less scheduled labor cost for the selected template.

The UI exposes a 32-bit simulation seed. Baseline and candidate plans use
the same demand scenarios, so differences come from staffing on the same
simulated weeks. Antithetic pairing is optional. Sort whole demand weeks
by total orders, draw a uniform rank U, then also select the rank at 1−U.
Each member of the pair retains the same marginal distribution. The pairs
can reduce variability when loss responds monotonically to total demand.
They may yield little or no reduction when demand shifts between days.

The convergence plot holds the chosen plan fixed and estimates CVaR with
50, 100, 250, 500, and 1,000 scenarios per estimate. At each size, 32 seeded
replicates produce a mean estimate and a pointwise 95% Student t interval
for the mean of that finite-sample estimator. Replicates use separate
pseudorandom seeds and keep pairs intact. These intervals describe Monte
Carlo variation conditional on a fitted distribution and a fixed plan.
They do not measure forecast model error, uncertainty in the selected
plan, or finite-sample bias. The risk cap and displayed plan metrics are
in-sample over the scenarios used to optimize. They are not an out-of-sample
guarantee of service.

## Implementation and references

The MIT-licensed `highs@1.15.4` package supplies the vendored browser solver
and WebAssembly binary. It runs in a Web Worker with no remote solver service.
Its license is included in `vendor/HIGHS-LICENSE`.

- [Rolling-origin validation](https://otexts.com/fpp3/tscv.html)
- [Residual-bootstrap prediction intervals](https://otexts.com/fpp2/prediction-intervals.html)
- [HiGHS JavaScript documentation](https://lovasoa.github.io/highs-js/docs/)
