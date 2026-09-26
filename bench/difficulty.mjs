// Difficulty analysis: where does the judge actually break NOW?
//
// A benchmark at 1.0000 has no gradient, so no cycle can "strictly raise" it. Whenever the
// eval band becomes saturated, this script finds the new breakdown point, and that band
// becomes the held-out eval difficulty. It has been run twice: once to find [0.06, 0.11]
// (the original band) and once after that band was fully solved.
//
// It also uses the SHARED applyDefect, so it can never drift from what run.mjs measures —
// the earlier per-file copies were how the band silently stopped matching the task.

import { cleanSpec, renderSpec, applyDefect, RENDER_SCALE } from './fixture.mjs';
import { classify, measurePair } from './judge.mjs';

const CLASSES = ['geometry', 'typography', 'spacing', 'color', 'imagery'];
const ref = await renderSpec(cleanSpec(), { scale: RENDER_SCALE });

console.log(`per-class accuracy vs magnitude (scale ${RENDER_SCALE}), 5 samples per cell\n`);
const mags = [0.11, 0.09, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.015, 0.01, 0.005];
const head = 'mag     ' + CLASSES.map(c => c.slice(0, 9).padEnd(11)).join('') + 'clean';
console.log(head);
for (const mag of mags) {
  const cells = [];
  for (const cls of CLASSES) {
    let ok = 0, n = 0;
    for (let i = 0; i < 5; i++) {
      const m = mag * (0.92 + i * 0.04);
      const r = await classify(ref, await renderSpec(applyDefect(cleanSpec(), cls, m).spec, { scale: RENDER_SCALE }));
      n++; if (r.label === cls) ok++;
    }
    cells.push(`${ok}/${n}`.padEnd(11));
  }
  const rc = await classify(ref, await renderSpec(cleanSpec(), { scale: RENDER_SCALE }));
  cells.push(rc.label === 'clean' ? 'ok' : '->' + rc.label);
  console.log(String(mag).padEnd(8) + cells.join(''));
}

// Detail on the first band that is not perfect, so a builder knows exactly what to fix.
for (const probe of [0.03, 0.015]) {
  console.log(`\n--- failure detail at mag ${probe} ---`);
  for (const cls of CLASSES) {
    const spec = applyDefect(cleanSpec(), cls, probe).spec;
    const png = await renderSpec(spec, { scale: RENDER_SCALE });
    const m = await measurePair(ref, png);
    const d = await classify(ref, png);
    const rt = m.textA > 0 ? (m.textB - m.textA) / m.textA : 0;
    console.log(
      cls.padEnd(11) + (d.label === cls ? 'ok' : 'X->' + d.label).padEnd(15) +
      'geo=' + m.geoEnergy.toFixed(3).padEnd(8) +
      'cr=' + String(m.changedRows).padEnd(6) +
      'ratio=' + (m.changedRows / (m.geoEnergy || 1e-9)).toFixed(0).padEnd(7) +
      'fT/M/B=' + (m.fracTop.toFixed(2) + '/' + m.fracMid.toFixed(2) + '/' + m.fracBot.toFixed(2)).padEnd(18) +
      'relText=' + rt.toFixed(4)
    );
  }
}
