// Verify critic-4's central claim: the band sits on a HARD CLIFF at mag ~0.015, not a gradient.
//
// The critic says typography's score is a step function because `changedRows` jumps 12 -> 27
// across a 0.0005 magnitude step, crossing the rule's `changedRows >= 24` precondition. If true,
// EVAL 0.9167 is the fraction of the band above 0.015, not a measure of judge quality.
//
// Run: node bench/verify-cliff.mjs
import { cleanSpec, renderSpec, applyDefect, RENDER_SCALE } from './fixture.mjs';
import { measurePair, decide } from './judge.mjs';

const ref = await renderSpec(cleanSpec(), { scale: RENDER_SCALE });

console.log('typography across the contested region, 0.00025 steps\n');
console.log('mag        changedRows  geoEnergy  relText   ratio   verdict');
let prevRows = null, maxJump = 0, jumpAt = null;
const rows = [];
for (let i = 0; i <= 40; i++) {
  const mag = 0.0130 + i * 0.00025;
  const { spec } = applyDefect(cleanSpec(), 'typography', mag);
  const png = await renderSpec(spec, { scale: RENDER_SCALE });
  const m = await measurePair(ref, png);
  const d = decide(m);
  const rt = m.textA > 0 ? (m.textB - m.textA) / m.textA : 0;
  rows.push({ mag, cr: m.changedRows, geo: m.geoEnergy, label: d.label });
  if (prevRows !== null) {
    const jump = Math.abs(m.changedRows - prevRows);
    if (jump > maxJump) { maxJump = jump; jumpAt = mag; }
  }
  prevRows = m.changedRows;
  console.log(
    mag.toFixed(5).padEnd(11) + String(m.changedRows).padEnd(13) +
    m.geoEnergy.toFixed(3).padEnd(11) + rt.toFixed(4).padEnd(10) +
    (m.geoEnergy > 0 ? (m.changedRows / m.geoEnergy).toFixed(1) : 'inf').padEnd(8) +
    (d.label === 'typography' ? 'ok' : '->' + d.label)
  );
}

console.log(`\nlargest changedRows jump between adjacent 0.00025 steps: ${maxJump} at mag ${jumpAt?.toFixed(5)}`);

// Is the transition a step or a ramp? Measure the width of the transition region.
const correct = rows.filter(r => r.label === 'typography').length;
const firstOk = rows.find(r => r.label === 'typography');
const lastBad = [...rows].reverse().find(r => r.label !== 'typography');
console.log(`verdicts correct: ${correct}/${rows.length}`);
if (firstOk && lastBad) {
  const width = firstOk.mag - lastBad.mag;
  console.log(`transition width: ${width.toFixed(5)} magnitude units (from last failure ${lastBad.mag.toFixed(5)} to first success ${firstOk.mag.toFixed(5)})`);
  console.log(width <= 0.001
    ? 'CLIFF CONFIRMED: the transition is narrower than 0.001 magnitude units, so the score is a step function.'
    : `RAMPS: the transition spans ${width.toFixed(5)} units, so it is a genuine gradient.`);
}

// Consequence check: does a small band shift change the score dramatically?
console.log('\nconsequence: score vs band placement (typography-only, 4 cases per band)');
for (const [lo, hi] of [[0.010, 0.0148], [0.010, 0.0150], [0.010, 0.020], [0.0140, 0.0160], [0.015, 0.020]]) {
  let ok = 0, n = 0;
  for (let i = 0; i < 4; i++) {
    const mag = lo + (i / 3) * (hi - lo);
    const { spec } = applyDefect(cleanSpec(), 'typography', mag);
    const d = decide(await measurePair(ref, await renderSpec(spec, { scale: RENDER_SCALE })));
    n++; if (d.label === 'typography') ok++;
  }
  console.log(`  band [${lo}, ${hi}] -> typography ${ok}/${n}`);
}
