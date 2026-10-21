import {spawn,execFile} from 'node:child_process';
import {open,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultDataDir} from '../src/platform.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const address='http://127.0.0.1:4318';
async function health(){try{const response=await fetch(address+'/api/health',{signal:AbortSignal.timeout(1500)});return response.ok&&/^1\./.test((await response.json()).version);}catch{return false;}}
if(process.argv.includes('--stop')){
 if(await health()){
  const {token}=await fetch(address+'/api/session').then(r=>r.json());
  await fetch(address+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json','X-Study-Token':token},body:'{}'});
  console.log('小舟已停止。');
 }else console.log('小舟当前没有运行。');
}else{
 if(!await health()){
  const dir=defaultDataDir();await mkdir(dir,{recursive:true,mode:0o700});
  const log=await open(join(dir,'service.log'),'a',0o600);
  const child=spawn(process.execPath,[join(root,'src/server.mjs')],{cwd:root,detached:true,stdio:['ignore',log.fd,log.fd]});child.unref();await log.close();
  for(let i=0;i<40&&!await health();i++)await new Promise(r=>setTimeout(r,250));
  if(!await health())throw new Error('启动失败，请查看 '+join(dir,'service.log'));
 }
 console.log('小舟已运行：'+address+'；关闭终端或控制台网页不会停止后台任务。');
 if(!process.argv.includes('--no-open')){
  if(process.platform==='darwin')execFile('/usr/bin/open',[address]);
  else if(process.platform==='win32')execFile('cmd',['/c','start','',address]);
  else execFile('xdg-open',[address]);
 }
}
