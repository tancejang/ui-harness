// Ensure a crashed coordinator does not leave paid turns or device servers running.
import {pathToFileURL} from 'node:url';
import {killTree} from './util.mjs';
const supervisor=process.ppid;
const timer=setInterval(()=>{
  try{process.kill(supervisor,0);}catch(e){if(e.code==='ESRCH')killTree({pid:process.pid,kill:()=>process.exit(1)});}
},500);
timer.unref();
await import(pathToFileURL(process.argv[2]).href);
