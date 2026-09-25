// Real Expo/Metro/ADB integration runner. Never uses Outfitory sources.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {install,loadExtensions,invoke} from '../src/extensions.mjs';
import {defaults} from '../src/config.mjs';
import {git,hash,writeJSON,exists} from '../src/util.mjs';
import {inspect} from '../src/project.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const project=path.join(root,'.uih','native-validation');
const template=path.join(root,'examples','react-native-home');
await fs.mkdir(project,{recursive:true});
for(const file of ['package.json','package-lock.json','app.json','index.js','metro.config.js','.gitignore'])await fs.copyFile(path.join(template,file),path.join(project,file));
await fs.mkdir(path.join(project,'src'),{recursive:true});
if(!await exists(path.join(project,'src/Home.jsx')))await fs.copyFile(path.join(template,'src/Home.jsx'),path.join(project,'src/Home.jsx'));
const config=structuredClone(defaults);
config.scenario={name:'home',description:'Wardrobe home screen. Save outfit must toggle saved state; Wardrobe tab must update content. Preserve the revision proof import and testIDs.',width:1080,height:1920};
config.runtime={plugin:'metro-android',options:{serial:process.env.UIH_ANDROID_SERIAL??'emulator-5580',dependenciesPath:path.join(template,'node_modules'),expectedTexts:['Good morning, Alex'],interactions:[{name:'Save outfit',tap:'save-outfit',expectText:'Saved to your wardrobe'},{name:'Wardrobe navigation',tap:'tab-wardrobe',expectText:'Your wardrobe is ready'}]}};
config.budgets={...config.budgets,maxIterations:2,localIterations:1,maxMinutes:30,maxCalls:30,callTimeoutSeconds:300};
config.reference='references/home.png';
// This fixture owns a disposable test client, never a user's development app.
Object.assign(config.runtime.options,{dedicatedDevice:true,resetAppData:true});
await writeJSON(path.join(project,'uih.json'),config);
for(const plugin of ['codex','metro-android'])await install(project,'plugin',path.join(root,'plugins',plugin));
await git(project,'init');await git(project,'config','user.name','UIH Validation');await git(project,'config','user.email','validation@localhost');
await git(project,'add','.');try{await git(project,'commit','-m','Native validation fixture');}catch(e){if(!(await git(project,'status','--porcelain')).trim()){}else throw e;}
const inventory=await inspect(project,config),revision=hash(JSON.stringify(inventory.files.map(f=>[f.path,f.sha256])));
const lock=await loadExtensions(project);
const operation=process.argv.includes('--check')?'check':'capture';
console.error(`[native-validation] ${operation} on ${config.runtime.options.serial}`);
try{
  const result=await invoke(project,lock,config.runtime,operation,{workspace:project,expectedRevision:revision,scenario:config.scenario},240000);
  if(result.observedRevision!==revision)throw new Error('Revision mismatch');
  if(result.pngBase64){await fs.writeFile(path.join(project,'.uih','native.png'),Buffer.from(result.pngBase64,'base64'));delete result.pngBase64;}
  await writeJSON(path.join(project,'.uih',`${operation}.json`),result);
  console.log(JSON.stringify({project,operation,passed:result.passed??true,revision,evidence:path.join(project,'.uih',`${operation}.json`)},null,2));
  if(result.passed===false)process.exitCode=1;
}catch(e){console.error(e.message);process.exitCode=1;}
