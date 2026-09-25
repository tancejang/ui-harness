import fs from 'node:fs/promises';
import path from 'node:path';
const args = process.argv.slice(2);
const mode = args.find(x => x.startsWith('--mode='))?.slice(7) ?? 'success';
if (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY || process.env.CODEX_ACCESS_TOKEN) throw new Error('Unexpected credential environment');
if (args.includes('login')) {
  process.stderr.write(mode === 'api-login' ? 'Logged in using an API key\n' : 'Logged in using ChatGPT\n');
  process.exit(0);
}
if (!args.includes('--ignore-user-config') || !args.includes('forced_login_method="chatgpt"') || !args.includes('model_provider="openai"')) throw new Error('OAuth/config isolation missing');
const get = key => args[args.indexOf(key) + 1];
const schema = JSON.parse(await fs.readFile(get('--output-schema'), 'utf8'));
const prompt = await new Promise(resolve => { let s=''; process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>resolve(s)); });
if (!prompt || args.at(-1) !== '-') throw new Error('Prompt must use stdin');
for (let i=0;i<args.length;i++) if (args[i] === '--image') if (!(await fs.readFile(args[i+1])).length) throw new Error('Missing image file');
if (mode === 'turn-failed') { console.log(JSON.stringify({ type:'turn.failed' })); process.exit(0); }
if (mode === 'incomplete') { console.log(JSON.stringify({ type:'thread.started' })); process.exit(0); }
let result = { visualQuality:90, fidelity:91, blocking:false, findings:[], rationale:'Fixture judgment' };
if (schema.properties.generated) {
  if (get('--sandbox') !== 'read-only' || !args.includes('image_generation')) throw new Error('Image generation setup missing');
  result = { generated: mode !== 'no-image', imagePath:path.resolve('generated.png'), explanation: mode === 'no-image' ? 'Tool unavailable' : 'Generated' };
  if (result.generated) {
    const png = args.find(x => x.startsWith('--png='))?.slice(6);
    await fs.writeFile('generated.png', Buffer.from(png, 'base64'));
    if (mode === 'stale-image') await fs.utimes('generated.png',new Date(0),new Date(0));
  }
} else if (get('--sandbox') !== 'read-only') throw new Error('Evaluation must be read-only');
if (mode !== 'missing-result') await fs.writeFile(get('--output-last-message'), JSON.stringify(result));
console.log(JSON.stringify({ type:'turn.completed', usage:{ input_tokens:100, output_tokens:20 } }));
