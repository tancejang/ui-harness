// Attack B: is the eval band a genuine gradient, or does it sit on a discontinuity?
//
// The detection floors are close to the band [0.01, 0.02]. If accuracy is a step function of
// magnitude, the "gradient" is an illusion and the score would be unstable under any band
// change. This sweeps finely through and around the band and reports the accuracy curve.
//
// Run: node bench/verify-gradient.mjs
import { cleanSpec, renderSpec, applyDefect, RENDER_SCALE } from './fixture.mjs';
import { classify } from './judge.mjs';

const ref = await renderSpec(cleanSpec(), { scale: RENDER_SCALE });
const CLASSES = ['geometry', 'typography', 'spacing', 'color', 'imagery', 'clean'];

// Fine sweep spanning well below and above the band.
const MAGS = [];
for (let i = 6; i <= 40; i++) MAGS.push(+(i / 2000).toFixed(5));   // 0.003 .. 0.020
for (const m of [0.022, 0.025, 0.030, 0.040, 0.060]) MAGS.push(m);

console.log('magnitude sweep: per-class correctness (5 samples each)\n');
console.log('mag       ' + CLASSES.map(c => c.slice(0, 9).padEnd(11)).join('') + 'overall');
const curve = [];
for (const mag of MAGS) {
  const cells = [];
  let hits = 0, tot = 0;
  for (const cls of CLASSES) {
    let ok = 0, n = 0;
    for (let i = 0; i < 5; i++) {
      const m = mag * (0.96 + i * 0.02);
      const { spec } = applyDefect(cleanSpec(), cls, cls === 'clean' ? 0 : m);
      const d = await classify(ref, await renderSpec(spec, { scale: RENDER_SCALE }));
      n++; if (d.label === cls) ok++;
    }
    hits += ok; tot += n;
    cells.push(`${ok}/${n}`.padEnd(11));
  }
  const overall = hits / tot;
  curve.push({ mag, overall });
  console.log(String(mag).padEnd(10) + cells.join('') + overall.toFixed(2));
}

// Report where the curve steps.
console.log('\nsteps in the overall curve (>= 0.10 change between adjacent magnitudes):');
let steps = 0;
for (let i = 1; i < curve.length; i++) {
  const d = Math.abs(curve[i].overall - curve[i - 1].overall);
  if (d >= 0.10) {
    steps++;
    console.log(`  ${curve[i - 1].overall.toFixed(2)} -> ${curve[i].overall.toFixed(2)} at mag ${curve[i].mag}`);
  }
}
console.log(`\n${steps} large step(s) across ${curve.length} sampled magnitudes`);

// The band should contain a mix of saturated and unsaturated regions for the weak class.
console.log('\nband check: does [0.010, 0.020] contain genuine headroom?');
const inBand = curve.filter(c => c.mag >= 0.010 && c.mag <= 0.020);
const vals = inBand.map(c => c.overall);
console.log(`  overall accuracy inside the band ranges ${Math.min(...vals).toFixed(2)} .. ${Math.max(...vals).toFixed(2)} across ${inBand.length} sampled magnitudes`);
const distinct = new Set(vals.map(v => v.toFixed(2))).size;
console.log(`  ${distinct} distinct accuracy values -> ${distinct >= 3 ? 'a real gradient, not a cliff' : 'WARNING: band sits on a step'}`);
