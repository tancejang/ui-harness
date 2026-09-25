import { spawn } from 'node:child_process';

// Saved Codex ChatGPT login is the only auth source. Never read auth.json.
export function oauthEnvironment(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env)) if (/^(OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN|OPENAI_BASE_URL|OPENAI_ORG_ID|OPENAI_PROJECT_ID|OPENAI_FEDERATION_RULE_ID|OPENAI_IDENTITY_TOKEN_FILE|OPENAI_WORKLOAD_IDENTITY_CONTEXT)$/i.test(key)) delete env[key];
  return env;
}
export function execute(argv, { cwd, input, timeoutMs = 600000, env = oauthEnvironment() } = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string')) throw new Error('Codex command must be an executable/argument array');
  return new Promise((resolve, reject) => {
    const p = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let stdout = '', stderr = '', failure;
    const stop = message => {
      failure ??= new Error(message);
      if (process.platform === 'win32' && p.pid) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide:true, stdio:'ignore' });
      else p.kill('SIGKILL');
    };
    const timer = setTimeout(() => stop('Codex command timed out'), timeoutMs);
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.stdout.on('data', b => { stdout += b; if (stdout.length > 32 * 1024 * 1024) stop('Codex output limit exceeded'); });
    p.stderr.on('data', b => { stderr = (stderr + b).slice(-8000); });
    p.stdin.on('error', () => {}); p.stdin.end(input);
    p.on('close', code => { clearTimeout(timer); if (failure) reject(failure); else resolve({ code, stdout, stderr }); });
  });
}
export async function authStatus(command) {
  const result = await execute([...command, 'login', 'status'], { timeoutMs: 15000 });
  const status = `${result.stdout}\n${result.stderr}`;
  return { authenticated: result.code === 0 && /logged in using chatgpt/i.test(status), method: /logged in using chatgpt/i.test(status) ? 'chatgpt' : 'unavailable', guidance: 'Use codex login to sign in with ChatGPT. UIH does not accept API-key authentication.' };
}
