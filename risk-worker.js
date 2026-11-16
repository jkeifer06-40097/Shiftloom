import loadHighs from './vendor/highs.mjs';
import {optimize} from './risk-milp.js?v=5';

let engine;
self.onmessage = async ({data:job}) => {
  try {
    engine ??= loadHighs();
    const highs = await engine;
    const {data,roster,template,scenarios,productivity,limit,seed} = job;
    const result = optimize(highs,data,roster,template,scenarios,productivity,limit,seed);
    self.postMessage({result});
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
