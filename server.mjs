import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';

const files = new Map([
  ['/','index.html'], ['/index.html','index.html'], ['/style.css','style.css'],
  ['/app.js','app.js'], ['/solver.js','solver.js'], ['/planning.js','planning.js'], ['/forecast.js','forecast.js'], ['/risk.js','risk.js'], ['/risk-ui.js','risk-ui.js'],
  ['/risk-milp.js','risk-milp.js'], ['/risk-worker.js','risk-worker.js'],
  ['/vendor/highs.mjs','vendor/highs.mjs'], ['/vendor/highs.wasm','vendor/highs.wasm'],
  ['/shiftloom-source.zip','shiftloom-source.zip'], ['/README.md','README.md'], ['/LICENSE','LICENSE']
]);
const types = {html:'text/html',css:'text/css',js:'text/javascript',mjs:'text/javascript',wasm:'application/wasm',zip:'application/zip',md:'text/plain'};
const { OPENAI_API_KEY, ANTHROPIC_API_KEY, BRIEF_ACCESS_TOKEN, BRIEF_MODEL } = process.env;
const enabled = Boolean((OPENAI_API_KEY || ANTHROPIC_API_KEY) && BRIEF_ACCESS_TOKEN?.length >= 24);
const recent = [];

function send(res,status,body) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(body));
}

function authorized(header) {
  const expected = Buffer.from('Bearer '+BRIEF_ACCESS_TOKEN);
  const received = Buffer.from(header || '');
  return received.length === expected.length && timingSafeEqual(received,expected);
}

function validatedMetrics(input) {
  const keys = ['filled','required','scheduledHours','atHourLimit','unfilledWithNoEligibleStaff','shiftsWithoutExtraEligibleStaff'];
  const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100000;
  if (!input || !keys.every(k => valid(input[k])) || !Array.isArray(input.dayCoverage) || input.dayCoverage.length !== 7 ||
      !input.dayCoverage.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(valid) && pair[0] <= pair[1])) throw new Error('Invalid metrics');
  return {...Object.fromEntries(keys.map(key => [key,input[key]])),dayCoverage:input.dayCoverage,limitedSearch:input.limitedSearch === true};
}

async function writeBrief(metrics) {
  const system = 'Write a concise weekly staffing brief in plain text, maximum 110 words. Days in dayCoverage are Monday through Sunday, with [filled, required] pairs. Prioritize real coverage gaps and backup availability. Use only the supplied facts. Do not invent financial data, employee details, or causes. If the solver reached its search limit, state that more coverage may be feasible.';
  const useOpenAI = Boolean(OPENAI_API_KEY);
  const url = useOpenAI ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages';
  const headers = useOpenAI ? {Authorization:'Bearer '+OPENAI_API_KEY} :
    {'x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'};
  const body = useOpenAI ? {model:BRIEF_MODEL || 'gpt-4.1-mini',instructions:system,input:JSON.stringify(metrics),max_output_tokens:300,store:false} :
    {model:BRIEF_MODEL,system,max_tokens:300,messages:[{role:'user',content:JSON.stringify(metrics)}]};
  if (!body.model) throw new Error('Set BRIEF_MODEL');
  const res = await fetch(url,{
    method:'POST',headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error('Provider unavailable');
  const response = await res.json();
  const blocks = useOpenAI ? response.output?.flatMap(item => item.content ?? []).filter(item => item.type === 'output_text') :
    response.content?.filter(item => item.type === 'text');
  const brief = blocks?.map(item => item.text).join('\n').trim();
  if (!brief) throw new Error('Empty response');
  return brief;
}

async function api(req,res) {
  if (req.method === 'GET') return send(res,200,{enabled:enabled && Boolean(OPENAI_API_KEY || BRIEF_MODEL)});
  if (req.method !== 'POST') return send(res,405,{error:'Method not allowed'});
  if (!enabled) return send(res,503,{error:'AI is not configured'});
  if (!authorized(req.headers.authorization)) return send(res,401,{error:'Invalid access token'});
  const now = Date.now();
  while (recent.length && now - recent[0] > 60000) recent.shift();
  if (recent.length >= 6) return send(res,429,{error:'Try again in a minute'});
  recent.push(now);
  let metrics;
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) return send(res,413,{error:'Payload too large'});
      chunks.push(chunk);
    }
    metrics = validatedMetrics(JSON.parse(Buffer.concat(chunks).toString()));
  } catch {
    return send(res,400,{error:'Invalid metrics'});
  }
  try { return send(res,200,{brief:await writeBrief(metrics)}); }
  catch { return send(res,502,{error:'AI provider did not return a brief'}); }
}

const server = createServer(async (req,res) => {
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (path === '/api/weekly-brief') return await api(req,res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res,405,{error:'Method not allowed'});
    const file = files.get(path);
    if (!file) return send(res,404,{error:'Not found'});
    const bytes = await readFile(new URL(file,import.meta.url));
    const type = types[file.split('.').at(-1)] ?? 'text/plain';
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch {
    if (!res.headersSent) send(res,500,{error:'Service unavailable'});
    else res.end();
  }
});
server.listen(Number(process.env.PORT || 8000),'0.0.0.0',() => console.log('Shiftloom listening'));
