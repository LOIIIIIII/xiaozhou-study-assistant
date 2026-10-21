import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('控制台跨站保护、密钥不回传、默认不落盘',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'study-server-'));const port=14318;
 const child=spawn(process.execPath,['src/server.mjs'],{env:{...process.env,STUDY_PORT:String(port),STUDY_DATA_DIR:dir},stdio:'pipe'});
 const url='http://127.0.0.1:'+port;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('服务启动超时')),7000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);});
  assert.equal((await fetch(url+'/api/state')).status,401);
  assert.equal((await fetch(url+'/api/session',{headers:{Origin:'https://evil.test'}})).status,403);
  const {token}=await fetch(url+'/api/session').then(r=>r.json());
  const res=await fetch(url+'/api/config',{method:'POST',headers:{'Content-Type':'application/json','X-Study-Token':token},body:JSON.stringify({apiKey:'test-only-key',apiBase:'https://example.com/v1',model:'test'})});
  assert.equal(res.status,200);assert.ok(!(await res.text()).includes('test-only-key'));
  const state=await fetch(url+'/api/state',{headers:{'X-Study-Token':token}}).then(r=>r.text());
  assert.ok(!state.includes('test-only-key'));assert.deepEqual(JSON.parse(await readFile(join(dir,'keys.json'),'utf8')),{});
  assert.equal((await stat(join(dir,'settings.json'))).mode&0o777,0o600);
  const threshold=await fetch(url+'/api/config',{method:'POST',headers:{'Content-Type':'application/json','X-Study-Token':token},body:JSON.stringify({minConfidence:.6,answerMode:'auto'})});
  assert.equal(threshold.status,200);assert.equal((await threshold.json()).config.minConfidence,.6);
 }finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true});}
});
