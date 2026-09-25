import { fixture } from '../test/helpers.mjs';
import { run } from '../src/runner.mjs';
import path from 'node:path';
const { root } = await fixture();
const state = await run(root);
console.log(JSON.stringify({ note: 'Synthetic deterministic demo; proves orchestration, not UI quality.', project: root, status: state.status, report: path.join(path.dirname(state.workspace), 'report.html') }, null, 2));
if (state.status !== 'passed') process.exitCode = 1;
