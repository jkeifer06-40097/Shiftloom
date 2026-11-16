# Shiftloom

A browser-based workforce scheduler for small teams. Try the preloaded sample,
or edit team members, shifts and scheduling rules. Generate the roster and
export it as CSV. Inputs are stored in the current browser.

## Run locally

With Python 3 installed, run `python -m http.server 8000` in this directory and
open http://localhost:8000. The app has no package dependencies or API keys.
Serve the files on any static host to deploy your own copy. To retain the source
download link, package these files as shiftloom-source.zip alongside index.html.

## Deploy to Render

1. Extract the release ZIP into a folder called `dist` in a Git repository.
2. Copy the original release ZIP into `dist` as `shiftloom-source.zip` so the
   deployed source link works. Push the repository to a Git provider.
3. In Render, choose **New → Static Site** and connect that repository. Set
   **Publish Directory** to `dist` and **Build Command** to `true` (there is no build step).
4. Use the assigned `.onrender.com` URL, or add a domain you own in the site's
   **Settings → Custom Domains** and follow Render's DNS verification steps.

Local browser data is scoped to the website address. A new domain starts with
sample data. Export any roster you want to retain before switching addresses.

## Scheduling

The solver uses bounded branch-and-bound search to maximize filled positions.
It respects staff availability windows, required roles, weekly hour limits,
overlap rules, and the maximum number of consecutive Monday–Sunday workdays.
It checks lower-workload staff first and flags uncovered positions. If the
search reaches its time limit, it returns the best assignment found so far.
Availability supports one window per day. Shifts start and end on the same day.

Licensed under Apache 2.0. See LICENSE.

## Schedule analysis

- **Weekly manager brief** summarizes the roster using calculated metrics.
- **Labor simulator** compares the current and expanded rosters on 1,000 matched
  scenarios drawn from a fitted demand model. See [Stage 1 demand modeling](#stage-1-demand-modeling).
  Results cover the selected template only, use one wage and productivity estimate,
  and omit fixed costs. The expanded plan preserves current assignments.
- **Call-out test** first preserves remaining assignments. If coverage remains
  incomplete, it also tries a bounded rebuild and uses it if it fills more
  positions. The full-week scan tests every scheduled employee and reruns
  affected scenarios for up to six cross-training candidates.

## Enable live AI briefs

The static release includes the calculated brief. To enable AI generation,
run the optional Node.js 22+ server with `node dist/server.mjs` from the repository
root. On Render, use a **Web Service** with Node, build command `true`, and start
command `node dist/server.mjs`. If the files are at the repo root, use
`node server.mjs` instead.

Set these values as server-only environment variables in the hosting dashboard:

- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. If both exist, OpenAI is used.
- `BRIEF_ACCESS_TOKEN`, a separate randomly generated secret of at least 24
  characters. Enter this token in Shiftloom when selecting **Write AI brief**.
- `BRIEF_MODEL`, optional for OpenAI (defaults to `gpt-4.1-mini`), required
  for Anthropic. Use a model supported by your provider account.

The endpoint accepts only numeric roster metrics and flags. It does not send
employee names, shift names, or availability windows. The token is not stored
by the browser. The endpoint limits authorized requests per server instance.

## Stage 1 demand modeling

Import a UTF-8 CSV with columns `date,shift,demand` and dates in `YYYY-MM-DD`.
Use the exact, unique shift template name for `shift`. Include one nonnegative
integer count per scheduled day, with explicit zeroes. Supply at least nine
consecutive complete weeks. A file can contain multiple templates. Uploaded
data remains in memory until you reload or replace it. Without a CSV, the
app generates 80 weeks of **SYNTHETIC** café demand with weekday effects,
annual seasonality, a mild trend, random variation and occasional spikes.

The forecast uses an additive regression with weekday offsets and a linear
time trend. With at least 52 training weeks it also fits one annual sine/cosine
pair. With a balanced panel of scheduled weekdays, the weekday offsets are
each day's average deviation from its weekly mean. Then ordinary least
squares fits the common weekly mean. This separates weekday differences
from changes across weeks.

The next week's distribution adds each historical residual week to the fitted
next-week levels, rounding to whole orders and clipping at zero. Keeping
all residuals from a given week together preserves their observed within-week
dependence. The 5th, 50th and 95th percentiles come from that empirical
distribution. Both staffing plans use the same 1,000 draws with replacement
from the distribution. The default simulation seed is 327321 and can be changed in Analysis.

At each validation origin, the model is fit only on earlier weeks and scored
on the following week. The first fit uses at least eight weeks. For long
histories, the evaluation reports the most recent 52 held-out weeks using all
earlier weeks at each origin. MAE uses the forecast median. Calibration is the
fraction of actual orders inside the inclusive 5th–95th percentile interval.
The nominal target is 90%, with discreteness and sampling variation affecting
measured coverage.

The bootstrap assumes historical residual weeks are representative. It may
miss new demand patterns, holiday effects, and structural changes. Annual
seasonality can be unstable with only one cycle. The interval reports
predictive variation from historical errors around a fitted mean and omits
explicit parameter uncertainty. Feed demand counts, not sales already
constrained by staffing. Evaluating **SYNTHETIC** data is a demo of the
workflow and provides no evidence of real-world forecast accuracy.

Run all regression checks with Node.js 22+:
`node --test forecast.test.mjs risk.test.mjs` from the release directory.

## Risk optimization and numerical checks

Select **Optimize staffing risk** to minimize weekly labor cost subject to a
maximum modeled probability of unmet demand. **Benchmark solver** runs
measured comparisons at two team sizes and two scenario counts. **Run simulation**
also shows a shortfall CVaR convergence plot for the current plan.

See [METHODOLOGY.md](METHODOLOGY.md) for the formulation, risk definitions,
sampling controls, and limitations. The release bundles the MIT-licensed
HiGHS WebAssembly solver from `highs@1.15.4`. The optional Node server serves
the same assets. No solver API keys or server computation are required.
