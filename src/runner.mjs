import {sourceRevision,approvalStatus} from './provenance.mjs';
import {validateReview,reconcile,blockers} from './discrepancies.mjs';
import {validateMeasurements,measure,mergeMeasurements} from './evidence.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig, validateConfig } from './config.mjs';
import { loadExtensions, invoke, skillContext } from './extensions.mjs';
import { inspect, createWorkspace, restore, applyEdits, checkpoint, editable } from './project.mjs';
import { accepted, meets, validateEvaluation, validatePlan, validateImage, decodeImage, imageInput, crop, compare } from './visual.mjs';
import { exists, git, hash, inside, json, writeJSON } from './util.mjs';
import {nextScope} from './scheduling.mjs';
import {aggregateJudgments} from './evaluation.mjs';
import {designFindingsFor, scaleFromCapture} from '../bench/design-findings.mjs';

export class BudgetStop extends Error {}
export class Session {
  constructor(root, dir, state, lock, skills) { Object.assign(this, { root, dir, state, lock, skills }); }
  async save() {
    if (this.started) this.state.activeStartedAt = this.started;
    await writeJSON(path.join(this.dir, 'state.json'), this.state);
  }
  async event(type, data = {}) {
    await fs.appendFile(path.join(this.dir, 'events.jsonl'), JSON.stringify({ at: new Date().toISOString(), type, ...data }) + '\n');
  }
  remaining() { return this.state.config.budgets.maxMinutes * 60000 - this.state.elapsedMs - (Date.now() - this.started); }
  async call(role, operation, request) {
    const cfg = this.state.config;
    const provider = role === 'runtime' ? (request.diagnosticOnly===true && operation==='capture' && cfg.runtime.plugin==='metro-android' ? {...cfg.runtime,options:{...cfg.runtime.options,expectedTexts:[]}} : cfg.runtime) : cfg.roles[role];
    const reserve = role === 'runtime' ? (provider.reserveUSD ?? 0) : provider.reserveUSD;
    if (this.remaining() <= 0) throw new BudgetStop('Time budget reached');
    if (this.state.calls >= (cfg.budgets.maxCalls ?? 100)) throw new BudgetStop('Call budget reached');
    if (this.state.reservedUSD + reserve > cfg.budgets.maxUSD + 1e-9) throw new BudgetStop('Cost reservation budget reached');
    // Persist reservation BEFORE invoking: failed/ambiguous paid calls still consume budget.
    this.state.reservedUSD += reserve;
    const callId = this.state.calls++;
    await this.save();
    await this.event('call-start', { callId, role, operation, reservedUSD: reserve, ...(request.diagnosticOnly?{diagnosticOnly:true}:{}) });
    const before = await git(this.state.workspace, 'diff', '--binary', 'HEAD');
    const headBefore=await git(this.state.workspace,'rev-parse','HEAD');
    const untrackedBefore=await git(this.state.workspace,'ls-files','--others','--exclude-standard','-z');
    const expectedRevision = role === 'runtime' ? await sourceRevision(this.state.workspace) : undefined;
    let result;
    try {
      result = await invoke(this.root, this.lock, provider, operation, {
        runId: this.state.id, workspace: this.state.workspace, scenario: cfg.scenario,
        platform: cfg.platform, skills: this.skills, expectedRevision, ...request
      }, Math.max(1, Math.min(cfg.budgets.callTimeoutSeconds * 1000, this.remaining())));
    } catch (error) {
      if (this.remaining() <= 0) throw new BudgetStop('Time budget reached during plugin call');
      throw error;
    }
    if (await git(this.state.workspace, 'diff', '--binary', 'HEAD') !== before) throw new Error(`Plugin ${provider.plugin} modified tracked files directly; return proposed edits instead`);
    if(await git(this.state.workspace,'rev-parse','HEAD')!==headBefore || await git(this.state.workspace,'ls-files','--others','--exclude-standard','-z')!==untrackedBefore)throw new Error('Plugin changed Git history or created untracked source files');
    if (role === 'runtime' && (operation==='capture'||result.passed!==false) && result.observedRevision !== expectedRevision) throw new Error('Runtime revision evidence mismatch: the rendered app/checks may belong to stale source');
    await this.verifyFrozen();
    await this.event('call-finish', { callId, role, operation, usage: result.usage ?? null, authMethod: result.authMethod ?? null });
    return result;
  }
  async capture(name,diagnosticOnly=false) {
    const result = await this.call('runtime', 'capture', diagnosticOnly?{diagnosticOnly:true}:{});
    if (typeof result.stateEvidence !== 'string' || !result.stateEvidence.trim()) throw new Error('Capture must include scenario state evidence');
    const file = path.join(this.dir, name + '.png');
    await decodeImage(result.pngBase64, file, this.state.config.scenario);
    await writeJSON(path.join(this.dir, name + '.capture.json'), { stateEvidence: result.stateEvidence, observedRevision:result.observedRevision, hierarchy: result.hierarchy ?? null, elements:result.elements??null, pixelRatio:result.pixelRatio??null });
    return file;
  }
  async checks() {
    let result;
    try{result=await this.call('runtime','check',{});}
    catch(error){
      if(this.state.config.runtime.plugin==='metro-android'&&error.message.includes('\nExpected screen content missing'))return {passed:false,checks:[{name:'Required screen content visible',passed:false,detail:'Expected screen content missing; candidate render failed readiness.'}],captureDiagnostic:true};
      throw error;
    }
    if (typeof result.passed !== 'boolean' || !Array.isArray(result.checks) || !result.checks.length || result.checks.some(c => typeof c.name !== 'string' || typeof c.passed !== 'boolean')) throw new Error('Runtime must report at least one explicit functional check');
    this.lastChecks=result;
    return { ...result, passed: result.passed && result.checks.every(c => c.passed) };
  }
  async review(actual, component, role = 'judge', previous) {
    const images = { reference: await imageInput(path.join(this.dir, 'reference.png')), actual: await imageInput(actual) };
    if (component) {
      const refCrop = path.join(this.dir, `reference-${component.id}.png`);
      const actualCrop = actual.replace(/\.png$/, `-${component.id}.png`);
      await crop(actual, component.region, actualCrop);
      images.referenceCrop = await imageInput(refCrop); images.actualCrop = await imageInput(actualCrop);
    }
    if (previous) images.previous = await imageInput(previous);
    const capture=await json(actual.replace(/\.png$/,'.capture.json'));
    const measurements=measure(this.state.visualChecks??[],capture,this.state.config.scenario);
    // Sourced design rules measured from the rendered candidate.
    //
    // These ride along with every critic and judge call so the reviewer cites specific thresholds
    // (SP-2's spacing scale, CO-6's 4.5:1) instead of taste. The measurement is deterministic and
    // local: it reads the PNG we are already sending. It never throws into the run - a checker
    // failure degrades to a note, because a design measurement should not break refinement.
    //
    // The prompt tells the reviewer to treat these as evidence to investigate, not
    // unquestionable truth, so a wrong measurement cannot silently drive an acceptance decision.
    const designFindings = await designFindingsFor({
      imagePath: actual,
      scale: scaleFromCapture(capture, this.state.config.scenario),
      scenario: this.state.config.scenario
    });
    const request={project:await inspect(this.state.workspace,this.state.config),nativeEvidence:capture,measurements,visualChecks:this.state.visualChecks??[],issues:this.state.issues??[],functionalChecks:this.lastChecks??null, designFindings, images, component: component ?? null, scope: component ? 'component' : 'screen', requirements: this.state.config.scenario.description };
    const result = await this.call(role, role, request);
    if (role === 'critic') {
      if (!Array.isArray(result.findings) || result.findings.some(f => typeof f !== 'string')) throw new Error('Critic must return findings');
      return validateReview(result);
    }
    validateReview(result);
    const samples=[validateEvaluation(result)];
    for(let i=1;i<(this.state.config.acceptance.judgeSamples??2);i++)samples.push(validateReview(validateEvaluation(await this.call(role,role,request))));
    const evaluation=aggregateJudgments(samples,this.state.config.acceptance.maxJudgeSpread??12);
    evaluation.issues=mergeMeasurements(reconcile(this.state.issues,samples,capture.observedRevision,{component:component?.id??null}),measurements,capture.observedRevision);
    return evaluation;
  }
  async verifyFrozen() {
    if (hash(await fs.readFile(path.join(this.dir, 'reference.png'))) !== this.state.referenceHash) throw new Error('Frozen reference was modified');
    if (hash(JSON.stringify(this.lock)) !== this.state.extensionHash) throw new Error('Extensions changed since this run; restore the original lock/installations');
    if(this.state.bestImageHash && hash(await fs.readFile(this.state.bestImage))!==this.state.bestImageHash)throw new Error('Best screenshot evidence was modified');
  }
  async execute() {
    this.started = Date.now();
    this.state.status = 'running';
    delete this.state.attestation;this.state.deliveryReady=false;
    await this.save();
    try {
      await this.verifyFrozen();
      await restore(this.state.workspace, this.state.bestCommit);
      if (!this.state.plan) {
        const project = await inspect(this.state.workspace, this.state.config);
        const plan = validatePlan(await this.call('planner', 'plan', { project, images: { reference: await imageInput(path.join(this.dir, 'reference.png')) } }), project, this.state.config);
        for (const component of plan.components) await crop(path.join(this.dir, 'reference.png'), component.region, path.join(this.dir, `reference-${component.id}.png`));
        this.state.visualChecks=validateMeasurements([...(plan.visualChecks??[]).filter(c=>!(this.state.config.visualChecks??[]).some(x=>x.key===c.key)),...(this.state.config.visualChecks??[])]);this.state.issues??=[];
        this.state.plan = plan; await writeJSON(path.join(this.dir, 'plan.json'), plan); await this.save();
      }
      if (!this.state.bestEvaluation) {
        const image = await this.capture('baseline');
        const checks = await this.checks();
        if (!checks.passed) throw new Error('Baseline functional checks failed; fix the starting project before refinement');
        this.state.bestEvaluation = await this.review(image);
        this.state.issues=this.state.bestEvaluation.issues;
        this.state.bestImage = image;
        this.state.bestImageHash=hash(await fs.readFile(image));
        this.state.baselineEvaluation = this.state.bestEvaluation;
        await writeJSON(path.join(this.dir, 'baseline.json'), { evaluation: this.state.bestEvaluation, checks });
        await this.save();
      }
      const cfg = this.state.config;
      const reviewCycleComplete=()=>{
        if(!cfg.acceptance.requireComponentCycle)return true;
        const reviewed=this.state.plan.components.map(c=>this.state.history.find(h=>h.component===c.id&&h.localAfter&&h.evaluation));
        return reviewed.every(Boolean)&&this.state.history.some(h=>h.component==='screen'&&h.evaluation&&h.attempt>Math.max(...reviewed.filter(Boolean).map(h=>h.attempt)));
      };
      while (true) {
        if(meets(this.state.bestEvaluation,cfg.acceptance)&&reviewCycleComplete()&&!blockers(this.state.issues).length){
          const checks=await this.checks(),image=await this.capture(`final-${this.state.iterations}`),evaluation=await this.review(image);
          this.state.issues=evaluation.issues;this.state.finalReview={checks,evaluation,image};
          if(checks.passed&&meets(evaluation,cfg.acceptance)&&!blockers(this.state.issues).length){
            this.state.attestation={revision:await sourceRevision(this.state.workspace),referenceHash:this.state.referenceHash,contractHash:hash(JSON.stringify(this.state.visualChecks??[])),captureHash:hash(await fs.readFile(image.replace(/\.png$/,'.capture.json'))),configHash:hash(JSON.stringify(this.state.config)),imageHash:hash(await fs.readFile(image)),at:new Date().toISOString()};break;
          }
        }
        if(this.state.iterations>=cfg.budgets.maxIterations)break;
        // Each cycle contains local adversarial loops, followed by a shared/layout pass.
        const slots = this.state.plan.components.length * cfg.budgets.localIterations;
        const {cursor,component}=nextScope(this.state);
        this.state.activeScope=component?.id??'screen';
        const attempt = ++this.state.iterations;
        await this.save(); // A crashed attempt counts; budgets cannot be bypassed by restarting.
        const prefix = `attempt-${String(attempt).padStart(3, '0')}`;
        await this.event('attempt-start', { attempt, component: component?.id ?? 'screen' });
        await restore(this.state.workspace, this.state.bestCommit);
        const critique = await this.review(this.state.bestImage, component, 'critic');
        this.state.issues=reconcile(this.state.issues,[critique],await sourceRevision(this.state.workspace),{resolve:false,component:component?.id??null});
        const localBefore = component ? await this.review(this.state.bestImage, component) : null;
        const project = await inspect(this.state.workspace, cfg);
        const rejected=this.state.history.findLast(h=>!h.accepted&&h.image);
        const previousFailures=[];
        for(const h of this.state.history.slice(-3)){
          const proposal=path.join(this.dir,`attempt-${String(h.attempt).padStart(3,'0')}-proposal.json`);
          previousFailures.push(!h.accepted&&!h.rejectedProposal&&await exists(proposal)?{...h,rejectedProposal:await json(proposal)}:h);
        }
        const edit = await this.call('builder', 'build', {
          project, component, critique, previousFailures, issues:this.state.issues, visualChecks:this.state.visualChecks, nativeEvidence:await json(this.state.bestImage.replace(/\.png$/,'.capture.json')),
          images: { reference: await imageInput(path.join(this.dir, 'reference.png')), actual: await imageInput(this.state.bestImage), ...(rejected?{lastRejected:await imageInput(rejected.image)}:{}) },
          allowedFiles: component ? component.files : project.files.filter(f => f.editable).map(f => f.path)
        });
        await writeJSON(path.join(this.dir, prefix + '-proposal.json'), edit);
        await applyEdits(this.state.workspace, cfg, edit.edits, component?.files);
        const checks = await this.checks();
        let outcome = { attempt, component: component?.id ?? 'screen', accepted: false, checks, critique };
        if(checks.captureDiagnostic){outcome.image=await this.capture(prefix+'-rejected',true);outcome.rejectedProposal=edit;}
        if (checks.passed) {
          const image = await this.capture(prefix);
          const diagnostic = await compare(path.join(this.dir, 'reference.png'), image, path.join(this.dir, prefix + '-diff.png'));
          const localAfter = component ? await this.review(image, component, 'judge', this.state.bestImage) : null;
          const evaluation = await this.review(image, null, 'judge', this.state.bestImage);
          const localOK = !component || accepted(localBefore, localAfter, cfg.acceptance);
          if(localAfter)evaluation.issues=mergeMeasurements(reconcile(localAfter.issues,evaluation.samples,await sourceRevision(this.state.workspace)),evaluation.issues.filter(x=>x.key.startsWith('measurement:')),await sourceRevision(this.state.workspace));
          const issueImproved=blockers(evaluation.issues).length<blockers(this.state.issues).length&&!blockers(evaluation.issues).some(x=>!blockers(this.state.issues).some(y=>y.key===x.key));
          const nonregressing=!evaluation.blocking&&evaluation.visualQuality>=this.state.bestEvaluation.visualQuality&&evaluation.fidelity>=this.state.bestEvaluation.fidelity;
          const globalOK = accepted(this.state.bestEvaluation, evaluation, cfg.acceptance)||(issueImproved&&nonregressing);
          outcome = { ...outcome, image, diagnostic, localBefore, localAfter, evaluation, accepted: (localOK||(issueImproved&&(!localAfter||!localAfter.blocking&&localAfter.visualQuality>=localBefore.visualQuality&&localAfter.fidelity>=localBefore.fidelity))) && globalOK };
          if (outcome.accepted) {
            const commit = await checkpoint(this.state.workspace, cfg);
            this.state.issues=evaluation.issues;
            this.state.bestCommit = commit; this.state.bestEvaluation = evaluation; this.state.bestImage = image;
            this.state.bestImageHash=hash(await fs.readFile(image));
          }
        }
        if (!outcome.accepted) await restore(this.state.workspace, this.state.bestCommit);
        this.state.history.push(outcome);
        this.state.scopeCursor=this.state.bestEvaluation.blocking?0:(cursor+1)%(slots+1);
        delete this.state.activeScope;
        await writeJSON(path.join(this.dir, prefix + '.json'), outcome);
        await this.save(); await this.event('attempt-finish', { attempt, accepted: outcome.accepted });
        process.stderr.write(`[uih] ${attempt}/${cfg.budgets.maxIterations} ${component?.id ?? 'screen'}: ${outcome.accepted ? 'accepted' : 'rejected'}; best quality=${this.state.bestEvaluation.visualQuality}, fidelity=${this.state.bestEvaluation.fidelity}\n`);
      }
      this.state.status = this.state.attestation ? 'passed' : 'iteration-limit';
      this.state.deliveryReady=this.state.status==='passed';
      delete this.state.error;
    } catch (error) {
      this.state.status = error instanceof BudgetStop ? 'budget-limit' : 'failed';
      this.state.deliveryReady=false;
      this.state.error = error.message;
      await this.event('stopped', { status: this.state.status, error: error.message });
    } finally {
      this.state.elapsedMs += Date.now() - this.started;
      this.started = null;
      delete this.state.activeStartedAt;
      await restore(this.state.workspace, this.state.bestCommit);
      await this.save();
      await fs.writeFile(path.join(this.dir, 'changes.patch'), await git(this.state.workspace, 'diff', '--binary', this.state.baseCommit, this.state.bestCommit));
      await report(this.dir, this.state);
    }
    return this.state;
  }
}
export async function run(root, overrides = {}, resumeId) {
  const lockFile = path.join(root, '.uih', 'run.lock');
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  // One run per project/device. Recover a dead process lock automatically on this host.
  if (await exists(lockFile)) {
    const owner = await json(lockFile);
    try { process.kill(owner.pid, 0); throw new Error(`Project already running in PID ${owner.pid}`); }
    catch (error) { if (error.code !== 'ESRCH') throw error; await fs.unlink(lockFile); }
  }
  const handle = await fs.open(lockFile, 'wx');
  await handle.writeFile(JSON.stringify({ pid: process.pid })); await handle.close();
  try {
    const lock = await loadExtensions(root), skills = await skillContext(root, lock);
    let state, dir;
    if (resumeId) {
      dir = inside(path.join(root, '.uih', 'runs'), resumeId);
      state = await json(path.join(dir, 'state.json'));
      if (state.status === 'passed') return {...state,...await approvalStatus(state)};
      // Recover feedback for an interrupted attempt without replaying or refunding it.
      if(state.iterations>0&&!state.history.some(h=>h.attempt===state.iterations)){
        const slots=state.plan.components.length*state.config.budgets.localIterations;
        const slot=(state.iterations-1)%(slots+1);
        const component=state.activeScope??(slot===0?'screen':state.plan.components[Math.floor((slot-1)/state.config.budgets.localIterations)].id);
        const prefix=`attempt-${String(state.iterations).padStart(3,'0')}`;
        const proposal=path.join(dir,prefix+'-proposal.json'),image=path.join(dir,prefix+'-rejected.png');
        const outcome={attempt:state.iterations,component,accepted:false,recovered:true,checks:{passed:false,checks:[{name:'Interrupted attempt',passed:false,detail:state.error??'Coordinator stopped before acceptance; source restored to best checkpoint.'}]},...(await exists(proposal)?{rejectedProposal:await json(proposal)}:{}),...(await exists(image)?{image}:{})};
        state.history.push(outcome);await writeJSON(path.join(dir,prefix+'.json'),outcome);
      }
      if (state.activeStartedAt) {
        // Conservatively charge wall time since an unclean shutdown. Never reset a crashed run's budget.
        state.elapsedMs += Math.max(0, Date.now() - state.activeStartedAt);
        delete state.activeStartedAt;
      }
      state.config.budgets = { ...state.config.budgets, ...overrides };
      validateConfig(state.config);
    } else {
      const config = await loadConfig(root);
      config.budgets = { ...config.budgets, ...overrides }; validateConfig(config);
      const untracked = (await git(root, 'ls-files', '--others', '--exclude-standard', '-z')).split('\0').filter(Boolean);
      if (untracked.some(f => editable(config, f))) throw new Error('Untracked editable source files exist; commit them before running');
      const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
      dir = path.join(root, '.uih', 'runs', id); await fs.mkdir(dir, { recursive: true });
      const reference = inside(root, config.reference);
      await validateImage(reference, config.scenario);
      await fs.copyFile(reference, path.join(dir, 'reference.png'));
      for (const suffix of ['.reference.json', '.original.png']) if (await exists(reference + suffix)) await fs.copyFile(reference + suffix, path.join(dir, 'reference.png' + suffix));
      const workspace = path.join(dir, 'workspace');
      const baseCommit = await createWorkspace(root, workspace);
      state = { version: 1, id, workspace, config, baseCommit, bestCommit: baseCommit, referenceHash: hash(await fs.readFile(reference)), extensionHash: hash(JSON.stringify(lock)), createdAt: new Date().toISOString(), elapsedMs: 0, reservedUSD: 0, calls: 0, iterations: 0, history: [], status: 'created' };
      await writeJSON(path.join(dir, 'extensions.json'), lock);
    }
    const session = new Session(root, dir, state, lock, skills);
    return await session.execute();
  } finally { await fs.unlink(lockFile); }
}
const escape = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export async function report(dir, state) {
  const name = file => file ? path.basename(file) : '';
  const images = state.bestImage ? `<section><figure><img src="reference.png"><figcaption>Frozen reference</figcaption></figure><figure><img src="baseline.png"><figcaption>Baseline</figcaption></figure><figure><img src="${escape(name(state.bestImage))}"><figcaption>Best accepted implementation</figcaption></figure></section>` : '';
  const rows = state.history.map(h => `<tr><td>${h.attempt}</td><td>${escape(h.component)}</td><td>${h.accepted ? 'Accepted' : 'Rejected'}</td><td>${h.evaluation?.visualQuality ?? '—'}</td><td>${h.evaluation?.fidelity ?? '—'}</td><td>${h.image ? `<a href="${escape(name(h.image))}">Screenshot</a>` : 'Checks failed'}</td></tr>`).join('');
  await fs.writeFile(path.join(dir, 'report.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>UIH run ${escape(state.id)}</title><style>body{font:16px system-ui;margin:32px;background:#111827;color:#e5e7eb}section{display:flex;gap:24px;align-items:flex-start}figure{margin:0;flex:1;min-width:0}img{width:100%;border-radius:8px}figcaption{padding:12px 0}table{border-collapse:collapse;width:100%;margin-top:24px}td,th{text-align:left;padding:12px;border-bottom:1px solid #374151}a{color:#93c5fd}pre{white-space:pre-wrap}@media(max-width:700px){section{flex-direction:column}}</style><h1>UIH run review</h1><p>Status: <strong>${escape(state.status)}</strong> · ${state.iterations} attempts · ${state.calls} calls · ${state.reservedUSD.toFixed(2)} custom-provider reservations · ${(state.elapsedMs/60000).toFixed(1)} active minutes</p><p>Codex uses subscription limits. Zero dollar reservations do not mean unlimited usage; custom-provider reservations are accounting estimates. Scores are model judgments, not proof of superiority to Codex.</p><p>${escape(state.error ?? '')}</p><h2>Unresolved discrepancies</h2><pre>${escape(JSON.stringify(blockers(state.issues),null,2))}</pre><p>Delivery ready: ${state.deliveryReady===true}. Approval is revision-specific; use uih review to check freshness.</p>${images}<table><thead><tr><th>Attempt</th><th>Scope</th><th>Decision</th><th>Quality</th><th>Fidelity</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table><p><a href="changes.patch">Accepted patch</a> · <a href="state.json">Run state and evaluations</a> · <a href="events.jsonl">Event log</a></p></html>`);
}
// Verification never restores, edits or commits the target workspace.
export async function verify(root,id,workspace){
  const runDir=inside(path.join(root,'.uih','runs'),id),original=await json(path.join(runDir,'state.json'));
  if(!original.plan)throw new Error('Run has no approved component plan');
  const handle=await fs.open(path.join(root,'.uih','run.lock'),'wx');
  await handle.writeFile(JSON.stringify({pid:process.pid}));await handle.close();
  try{
    const lock=await loadExtensions(root),skills=await skillContext(root,lock);
    if(hash(JSON.stringify(lock))!==original.extensionHash)throw new Error('Restore the run extensions before verification');
    const dir=path.join(runDir,'verifications',crypto.randomUUID());await fs.mkdir(dir,{recursive:true});
    await fs.copyFile(path.join(runDir,'reference.png'),path.join(dir,'reference.png'));
    const state={...structuredClone(original),workspace:path.resolve(workspace??original.workspace),status:'verifying',calls:0,reservedUSD:0,elapsedMs:0,history:[],deliveryReady:false};
    delete state.attestation;delete state.bestImageHash;delete state.activeStartedAt;
    const session=new Session(root,dir,state,lock,skills);session.started=Date.now();
    try{
      await session.verifyFrozen();
      const checks=await session.checks(),image=await session.capture('verification'),evaluation=await session.review(image);
      state.issues=evaluation.issues;state.finalReview={checks,image,evaluation};state.bestImage=image;state.bestEvaluation=evaluation;
      state.status=checks.passed&&meets(evaluation,state.config.acceptance)&&!blockers(state.issues).length?'passed':'incomplete';
      state.deliveryReady=state.status==='passed';
      if(state.deliveryReady)state.attestation={revision:await sourceRevision(state.workspace),referenceHash:state.referenceHash,contractHash:hash(JSON.stringify(state.visualChecks??[])),captureHash:hash(await fs.readFile(image.replace(/\.png$/,'.capture.json'))),configHash:hash(JSON.stringify(state.config)),imageHash:hash(await fs.readFile(image)),at:new Date().toISOString()};
    }catch(e){state.status=e instanceof BudgetStop?'budget-limit':'failed';state.error=e.message;}
    state.elapsedMs=Date.now()-session.started;session.started=null;delete state.activeStartedAt;
    await session.save();await report(dir,state);return {...state,report:path.join(dir,'report.html')};
  }finally{await fs.unlink(path.join(root,'.uih','run.lock'));}
}
