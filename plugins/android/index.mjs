import { spawn } from 'node:child_process';
const request = JSON.parse(await new Promise(resolve => { let text = ''; process.stdin.on('data', b => text += b); process.stdin.on('end', () => resolve(text)); }));
function exec(argv, binary = false) {
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string')) throw new Error('Commands must be executable/argument arrays');
  return new Promise((resolve, reject) => {
    const p = spawn(argv[0], argv.slice(1), { cwd: request.workspace, env:{...process.env,UIH_EXPECTED_REVISION:request.expectedRevision??''}, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = []; let bytes = 0;
    p.stdout.on('data', b => { bytes += b.length; if (bytes > 24 * 1024 * 1024) p.kill(); else out.push(b); });
    p.stderr.on('data', b => { if (err.length < 100) err.push(b); });
    p.on('error', reject); p.on('close', code => code === 0 ? resolve(binary ? Buffer.concat(out) : Buffer.concat(out).toString()) : reject(new Error(`Command failed (${code}): ${argv[0]} ${Buffer.concat(err).toString().slice(-2000)}`)));
  });
}
try {
  const o = request.options;
  if (!o.serial) throw new Error('Android runtime requires explicit device serial');
  const adb = [o.adb ?? 'adb', '-s', o.serial];
  if (!Array.isArray(o.prepare) || !o.prepare.length) throw new Error('Configure prepare commands to establish this candidate revision');
  for (const command of o.prepare) await exec(command);
  if (o.deepLink) await exec([...adb, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', o.deepLink]);
  if (o.settleMs) await new Promise(resolve=>setTimeout(resolve,Math.min(o.settleMs,10000)));
  await exec([...adb,'shell','uiautomator','dump','/sdcard/uih-revision.xml']);
  const revisionTree=await exec([...adb,'exec-out','cat','/sdcard/uih-revision.xml']);
  const revisionLabel=(o.revisionLabel??'uih-revision-{revision}').replaceAll('{revision}',request.expectedRevision??'');
  if(!request.expectedRevision||!revisionTree.includes(revisionLabel))throw new Error('Rendered source revision marker missing; prepare must consume UIH_EXPECTED_REVISION');
  let result;
  if (request.operation === 'capture') {
    // Every capture must explicitly rebuild/reload from this workspace and establish state.
    if (!Array.isArray(o.prepare) || !o.prepare.length) throw new Error('Configure prepare commands to serve/build this isolated workspace and establish the scenario');
    await exec([...adb, 'shell', 'uiautomator', 'dump', '/sdcard/uih-hierarchy.xml']);
    const hierarchy = await exec([...adb, 'exec-out', 'cat', '/sdcard/uih-hierarchy.xml']);
    if (!Array.isArray(o.expectedTexts) || !o.expectedTexts.length || o.expectedTexts.some(t => !hierarchy.includes(`text="${t}"`) && !hierarchy.includes(`content-desc="${t}"`))) throw new Error('Expected screen text/accessibility labels were not found; configure expectedTexts');
    const screenshot = await exec([...adb, 'exec-out', 'screencap', '-p'], true);
    if(!hierarchy.includes(revisionLabel))throw new Error('Source revision changed during capture');
    result = { pngBase64: screenshot.toString('base64'), hierarchy, observedRevision:request.expectedRevision, stateEvidence: `Device ${o.serial}; preparation commands completed; observed labels: ${o.expectedTexts.join(', ')}` };
  } else if (request.operation === 'check') {
    if (!Array.isArray(o.checks) || !o.checks.length) throw new Error('Configure at least one functional check command');
    const checks = [];
    for (const item of o.checks) {
      if (!item.name || !item.command) throw new Error('Check needs name and command');
      try { await exec(item.command); checks.push({ name: item.name, passed: true }); }
      catch (error) { checks.push({ name: item.name, passed: false, detail: error.message }); }
    }
    result = { passed: checks.every(c => c.passed), checks, observedRevision:request.expectedRevision };
  } else throw new Error('Unsupported operation');
  process.stdout.write(JSON.stringify({ protocol: 1, result }));
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
