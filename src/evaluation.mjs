import {validateEvaluation} from './visual.mjs';
export function aggregateJudgments(samples,maxSpread=12) {
  if(!samples.length)throw new Error('At least one judgment required');
  samples.forEach(validateEvaluation);
  const values=key=>samples.map(x=>x[key]);
  const spread=Object.fromEntries(['visualQuality','fidelity'].map(key=>[key,Math.max(...values(key))-Math.min(...values(key))]));
  const unstable=Object.values(spread).some(x=>x>maxSpread);
  return {visualQuality:Math.min(...values('visualQuality')),fidelity:Math.min(...values('fidelity')),blocking:unstable||samples.some(x=>x.blocking),findings:[...new Set(samples.flatMap(x=>x.findings))],rationale:unstable?'Judge disagreement exceeded tolerance; candidate cannot pass.':`Conservative minimum across ${samples.length} independent judgments.`,spread,samples};
}
