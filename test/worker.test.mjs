import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StudyWorker} from '../src/worker.mjs';
import {parseBank} from '../src/core.mjs';
import {probeDocument} from '../src/probe.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function setup(bank){
 const dir=await mkdtemp(join(tmpdir(),'study-test-'));
 const server=http.createServer(async(req,res)=>{try{const name=req.url.endsWith('.js')?'demo.js':req.url.endsWith('.mp4')?'video.mp4':'demo.html';res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.mp4')?'video/mp4':'text/html; charset=utf-8');res.end(await readFile(new URL('./fixtures/'+name,import.meta.url)));}catch{res.writeHead(500);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const worker=new StudyWorker({dataDir:dir,config:{courseUrl:'http://127.0.0.1:'+server.address().port+'/demo/course',speed:2,answerMode:'auto',minConfidence:.95,pollMs:100},bank,keys:{},demo:true});
 await worker.open();
 return {worker,cleanup:async()=>{await worker.close();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}};
}
test('独立浏览器：原生2倍速、视频结束、作业提交、课程结束',async()=>{
 const {worker,cleanup}=await setup(parseBank(JSON.stringify([{question:'测试题：一加一等于几？',options:{A:'二',B:'三'},answers:['A']}] )));
 try{worker.start();let maxRate=1;const until=Date.now()+20000;while(Date.now()<until&&worker.state.running){maxRate=Math.max(maxRate,worker.state.video?.rate??1);await sleep(100);}
 assert.equal(worker.state.phase,'done',JSON.stringify(worker.state));assert.equal(worker.state.completedVideos,1);assert.equal(worker.state.completedQuizzes,1);assert.equal(maxRate,2);
 assert.ok(worker.state.logs.some(l=>l.message.includes('100 分')));
 }finally{await cleanup();}
});
test('没有答案时暂停，不填写、不提交；暂停后不会继续动作',async()=>{
 const {worker,cleanup}=await setup([]);
 try{await worker.page.locator('#next').click();worker.start();const until=Date.now()+7000;while(Date.now()<until&&worker.state.running)await sleep(100);
 assert.equal(worker.state.phase,'review');assert.equal(await worker.page.locator('[aria-checked=true]').count(),0);assert.equal(worker.state.completedQuizzes,0);
 worker.stop();await sleep(400);assert.equal(worker.state.running,false);
 }finally{await cleanup();}
});
test('重新打开浏览器不继承已关闭状态；新空白标签不抢占课程',async()=>{
 const {worker,cleanup}=await setup([]);
 try{await worker.open();assert.equal(worker.status().browserOpen,true);assert.equal(worker.state.phase,'ready');
 const course=worker.page;const other=await worker.context.newPage();await other.goto('about:blank');assert.equal(worker.page,course);
 await other.close();assert.equal(worker.status().browserOpen,true);
 await worker.page.close();assert.equal(worker.status().browserOpen,false);assert.equal(worker.state.running,false);
 }finally{await cleanup();}
});
test('隐藏登录 iframe 不干扰课程识别',async()=>{
 const {worker,cleanup}=await setup([]);
 try{
 await worker.page.setContent('<h1>已登录的课程列表</h1><iframe hidden srcdoc="<input type=password>"></iframe>');
 assert.equal((await worker.frames()).length,1);
 const data=await worker.page.evaluate(probeDocument);assert.equal(data.login,false);
 }finally{await cleanup();}
});
