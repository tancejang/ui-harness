// Opt-in live test. Uses your saved ChatGPT login and consumes Codex usage.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { command, writeJSON } from '../src/util.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const plugin = path.join(root,'plugins/codex/index.mjs');
const dir = path.join(root,'.uih','smoke',new Date().toISOString().replace(/[:.]/g,'-'));
const generate = process.argv.includes('--generate');
await fs.mkdir(dir,{recursive:true});
const options = {};
let request;
if (generate) {
  request = { protocol:1,operation:'generate',options,scenario:{name:'smoke',description:'OAuth image generation verification',width:1024,height:1024},brief:'Create a square 1024x1024 polished mobile wardrobe app home-screen mockup. White background, black typography, one blue outfit card and a clear bottom navigation. No device frame. This is a small integration verification asset.' };
} else {
  const images = {};
  for (const [label,background] of [['reference','#0055ff'],['actual','#ff5500']]) images[label] = {mimeType:'image/png',base64:(await sharp({create:{width:64,height:64,channels:3,background}}).png().toBuffer()).toString('base64')};
  request = {protocol:1,operation:'critic',options,scenario:{name:'smoke',description:'Compare these simple color swatches only',width:64,height:64},images,scope:'screen'};
}
try {
  const response = JSON.parse(await command([process.execPath,plugin],{input:JSON.stringify(request),timeoutMs:600000})).result;
  if (response.pngBase64) {
    const bytes=Buffer.from(response.pngBase64,'base64');
    await fs.writeFile(path.join(dir,'generated.png'),bytes);
    const meta=await sharp(bytes).metadata(); response.image={width:meta.width,height:meta.height,format:meta.format};
    delete response.pngBase64;
  }
  await writeJSON(path.join(dir,'result.json'),{status:'passed',operation:request.operation,...response});
  console.log(JSON.stringify({status:'passed',operation:request.operation,authMethod:response.authMethod,usage:response.usage,artifactDirectory:dir},null,2));
} catch(error) {
  await writeJSON(path.join(dir,'result.json'),{status:'failed',operation:request.operation,error:error.message});
  console.error(error.message);process.exitCode=1;
}
