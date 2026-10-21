import { chromium } from 'playwright';
import { EventEmitter } from 'node:events';
import { readFile, writeFile, mkdir, unlink, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { probeDocument } from './probe.mjs';
import { fingerprint, matchBank, validateAnswer, allowedCourseURL, clampSpeed } from './core.mjs';
import { solveAI } from './ai.mjs';
import {createOfflineOCR} from './ocr.mjs';
const execFileAsync=promisify(execFile);
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const STOP=Symbol('stopped');

export class StudyWorker extends EventEmitter {
  constructor({dataDir,config,bank,keys,demo=false}){
    super();Object.assign(this,{dataDir,config,bank,keys,demo});
    this.state={phase:'idle',message:'先打开专用浏览器并扫码登录',running:false,
      video:null,questions:[],completedVideos:0,completedQuizzes:0,bankHits:0,aiCalls:0,logs:[]};
    this.epoch=0;this.cache=new Map();this.seen=new Set();this.pending=null;this.lastAdvance=null;this.pauseTimes=[];
  }
  status(){return {...this.state,browserOpen:!!this.context&&!!this.page&&!this.page.isClosed(),bankCount:this.bank.length,url:this.page?.url()??'',
    questions:this.state.questions.map(({question,options,type,answer,error})=>({question,type,options:options.map(({label,text})=>({label,text})),answer,error})),
    ocrAvailable:this.ocrAvailable??false};}
  log(message,level='info'){
    const event={time:new Date().toISOString(),level,message:String(message).slice(0,600)};
    this.state.logs=[...this.state.logs.slice(-199),event];this.emit('update');
  }
  update(phase,message,extra={}){Object.assign(this.state,{phase,message,...extra});this.emit('update');}
  guard(epoch){if(!this.state.running||epoch!==this.epoch)throw STOP;}
  async open({headed=false}={}){
    this.stop(false);
    await this.close();
    await mkdir(join(this.dataDir,'profile'),{recursive:true,mode:0o700});
    this.context=await chromium.launchPersistentContext(join(this.dataDir,'profile'),{
      channel:'chromium',headless:!headed,viewport:{width:1280,height:900},acceptDownloads:false});
    this.context.setDefaultTimeout(7000);
    const activeContext=this.context;
    this.context.on('close',()=>{if(this.context===activeContext){this.context=null;this.page=null;this.attention('专用浏览器已关闭，请重新打开');}});
    this.context.on('page',p=>{p.on('domcontentloaded',()=>{if(this.context===activeContext&&/(^|\.)(chaoxing\.com|xuexitong\.com)$/.test(new URL(p.url()).hostname))this.attach(p);});});
    this.page=this.context.pages()[0]??await this.context.newPage();this.attach(this.page);
    const initial=this.demo?this.config.courseUrl:'https://i.chaoxing.com/';
    allowedCourseURL(initial,this.demo);await this.page.goto(initial,{waitUntil:'domcontentloaded'});
    this.ocrPath=process.env.STUDY_OCR_PATH??join(root,'tools','ocr');
    this.nativeOCR=process.platform==='darwin'&&await access(this.ocrPath).then(()=>true,()=>false);
    this.ocrAvailable=true;
    this.update('ready','专用浏览器已打开。可从右侧预览扫码；二维码过期可点“刷新登录二维码”',{video:null,questions:[]});
    this.log(headed?'已打开独立登录窗口，不使用系统鼠标自动控制':'后台浏览器已启动');
  }
  attach(page){
    this.page=page;
    this.attached??=new WeakSet();if(this.attached.has(page))return;this.attached.add(page);
    page.on('dialog',async dialog=>{
      if(dialog.type()==='confirm'&&/^确认提交[？?]?$/.test(dialog.message().trim())&&this.state.running)await dialog.accept();
      else {await dialog.dismiss();this.attention('页面出现需本人处理的提示：'+dialog.message().slice(0,120));}
    });
    page.on('close',()=>{if(this.page===page){this.page=null;this.stop(false);this.update('needs_attention','专用浏览器页面已关闭，请点击扫码登录重新打开');}});
  }
  async frames(){
    if(!this.page||this.page.isClosed())throw new Error('请先打开专用浏览器');
    const snapshots=[];
    for(const frame of this.page.frames()){
      if(frame.parentFrame()){
        try{if(!await(await frame.frameElement()).isVisible())continue;}catch{continue;}
      }
      let url;try{url=new URL(frame.url());}catch{continue;}
      const official=/(^|\.)(chaoxing\.com|xuexitong\.com)$/.test(url.hostname);
      if(!official&&!(this.demo&&['localhost','127.0.0.1'].includes(url.hostname)))continue;
      try{snapshots.push({frame,data:await frame.evaluate(probeDocument)});}catch(error){this.log('页面读取失败：'+error.message.slice(0,200),'warn');}
    }
    return snapshots;
  }
  start(){
    if(!this.page)throw new Error('先打开专用浏览器并登录');
    if(!this.config.courseUrl)throw new Error('先填写课程或章节地址');
    allowedCourseURL(this.config.courseUrl,this.demo);
    if(this.state.running)return;
    this.epoch++;this.pending=null;this.lastAdvance=null;this.state.running=true;
    this.navigationGrace=Date.now()+15000;
    this.update('running','正在识别课程页面');this.log('开始运行；最高 '+clampSpeed(this.config.speed)+' 倍速');
    this.loop(this.epoch);
  }
  async startAtCourse(){
    if(!this.page)throw new Error('先打开专用浏览器并登录');
    const target=allowedCourseURL(this.config.courseUrl,this.demo);
    const current=new URL(this.page.url());
    const id=u=>u.searchParams.get('courseId')??u.searchParams.get('courseid');
    if(!this.demo&&!/studentstudy/.test(current.pathname)){
      // Start from the official course list so the site generates a fresh enc.
      if(target.searchParams.has('enc'))await this.page.goto(target.href,{waitUntil:'domcontentloaded'});
      else if(!/(^|\.)i\.(?:mooc\.)?chaoxing\.com$/.test(current.hostname))await this.page.goto('https://i.chaoxing.com/',{waitUntil:'domcontentloaded'});
    }else if(!/studentstudy/.test(current.pathname)&&!(this.demo&&current.pathname.startsWith('/demo/'))){
      await this.page.goto(target.href,{waitUntil:'domcontentloaded'});
    }else if(id(target)&&id(current)&&id(target)!==id(current)){
      await this.page.goto(target.href,{waitUntil:'domcontentloaded'});
    }
    this.start();
  }
  cancelReviewTimeout(){clearTimeout(this.reviewTimer);this.reviewTimer=null;this.state.reviewDeadline=null;}
  stopAI(){this.config.aiEnabled=false;this.aiAbort?.abort();this.log('AI 调用已停止；已发送请求可能仍由服务商计费，视频和本地题库可继续使用');}
  stop(log=true){
    this.cancelReviewTimeout();this.aiAbort?.abort();
    this.state.running=false;this.epoch++;clearTimeout(this.timer);
    if(log){this.update('paused','已暂停。浏览器和登录状态保留');this.log('用户暂停任务');}
  }
  attention(message){this.stop(false);this.update('needs_attention',message);this.log(message,'warn');}
  async close(){this.stop(false);const context=this.context;this.context=null;this.page=null;if(context)await context.close();await this.ocrWorker?.terminate();this.ocrWorker=null;}
  async screenshot(){if(!this.page)throw new Error('浏览器未打开');return this.page.screenshot({type:'png',timeout:10000});}
  async qrcode(){
    if(!this.page)throw new Error('请先打开专用浏览器');
    for(const frame of this.page.frames()){
      if(!/passport2\./.test(frame.url()))continue;
      const images=frame.locator('[id*="qr" i],[class*="qr" i],[id*="code" i],[class*="code" i],img,canvas');
      for(let i=0;i<await images.count();i++){
        const item=images.nth(i);const box=await item.boundingBox();
        if(box&&box.width>=70&&box.width<=500&&box.height>=70&&box.height<=500&&Math.abs(box.width-box.height)<40)return item.screenshot({type:'png'});
      }
      // Some login versions paint their QR into a background instead of an img.
      const viewport=this.page.viewportSize();
      if(viewport)return this.page.screenshot({type:'png',clip:{x:Math.floor(viewport.width*.56),y:Math.floor(viewport.height*.18),width:Math.floor(viewport.width*.4),height:Math.floor(viewport.height*.65)}});
    }
    throw new Error('当前页面未找到登录二维码，请刷新预览或显示登录窗口');
  }
  async loop(epoch){
    try{this.guard(epoch);await this.tick(epoch);}
    catch(error){
      if(error===STOP||epoch!==this.epoch)return;
      this.attention(error.message??'运行异常，请检查页面');
    }
    if(this.state.running&&epoch===this.epoch)this.timer=setTimeout(()=>this.loop(epoch),this.config.pollMs??2500);
  }
  async click(item,epoch){this.guard(epoch);await item.frame.locator(item.button.selector).click();this.guard(epoch);}
  button(frames,pattern){for(const {frame,data} of frames){const button=data.buttons.find(b=>!b.disabled&&pattern.test(b.text));if(button)return {frame,button};}return null;}
  async tick(epoch){
    const frames=await this.frames();this.guard(epoch);
    if(!frames.length)return this.attention('课程页面尚未就绪，请在预览中检查地址');
    if(frames.some(f=>/enc[\s校验]*失败|enc校验失败/i.test(f.data.body))){
      await this.page.goto('https://i.chaoxing.com/',{waitUntil:'domcontentloaded'});this.update('navigating','课程链接校验失效，正在从官方课程列表重新进入');return;
    }
    if(frames.some(f=>f.data.login)){if(Date.now()<(this.navigationGrace??0))return;return this.attention('登录状态失效。请重新扫码，再点击开始运行');}
    if(frames.some(f=>f.data.verification))return this.attention('页面要求验证码或身份验证，请在登录窗口中本人完成');
    if(frames.some(f=>f.data.exam))return this.attention('已进入考试页面，本工具的自动流程仅处理课程和章节作业');
    const signature=JSON.stringify(frames.map(f=>[f.data.url,f.data.heading,f.data.questions.length,f.data.videos.length,f.data.quizComplete]));
    if(this.lastAdvance){
      if(signature===this.lastAdvance.signature){
        if(Date.now()-this.lastAdvance.at>20000)return this.attention('点击下一任务后页面没有更新，请检查是否被课程锁定');
        return;
      }
      this.lastAdvance=null;
    }
    const quiz=frames.find(f=>f.data.questions.length||f.data.quizComplete);
    if(quiz?.data.quizComplete){
      const key='quiz:'+quiz.data.url;
      if(!this.seen.has(key)){this.seen.add(key);this.state.completedQuizzes++;this.log('测验已完成'+(quiz.data.score!==null?'，成绩 '+quiz.data.score+' 分':''));}
      this.state.questions=[];return this.advance(frames,signature,epoch);
    }
    if(quiz?.data.questions.length)return this.quiz(quiz,epoch);
    const videoFrame=frames.find(f=>f.data.videos.length);
    if(videoFrame){
      const video=videoFrame.data.videos[0];
      if(video.error)return this.attention('视频加载失败：'+video.error);
      this.update('watching','正在播放课程视频',{video});
      if(frames.some(f=>f.data.taskComplete)&&!video.ended)return this.advance(frames,signature,epoch);
      if(video.ended){
        if(!frames.some(f=>f.data.taskComplete)){
          this.endWait??=Date.now();if(Date.now()-this.endWait>45000)this.attention('视频已结束，但平台尚未确认任务点完成；未跳过任务');
          return;
        }
        this.endWait=null;
        const key='video:'+this.page.url()+':'+videoFrame.data.url;
        if(!this.seen.has(key)){this.seen.add(key);this.state.completedVideos++;this.log('视频任务点已由平台确认完成');}
        return this.advance(frames,signature,epoch);
      }
      const restricted=frames.some(f=>f.data.noSpeed);
      if(!restricted&&Math.abs(video.rate-clampSpeed(this.config.speed))>0.01){
        const speed=this.button([videoFrame],/^播放速度$|^Playback Rate$/i);
        if(speed){
          // Native player control; never seeks, fakes visibility or reports progress.
          for(let i=0;i<6;i++){
            this.guard(epoch);
            const current=(await videoFrame.frame.evaluate(probeDocument)).videos[0];
            if(!current||current.rate===clampSpeed(this.config.speed))break;
            if(current.rate>2)return this.attention('播放器提供了高于2倍速的档位，请手动选择不超过2倍速');
            await videoFrame.frame.locator(speed.button.selector).press('Enter');await delay(120);
          }
        }
      }
      if(restricted&&this.lastRestriction!==videoFrame.data.url){this.lastRestriction=videoFrame.data.url;this.log('本节禁止倍速，将按平台允许速度播放','warn');}
      if(video.paused){
        this.pauseTimes=this.pauseTimes.filter(t=>Date.now()-t<60000);
        if(this.pauseTimes.length>=5)return this.attention('页面在一分钟内反复暂停。请检查平台的前台观看要求或使用显示窗口模式');
        const play=this.button([videoFrame],/^(播放视频|播放|Play Video|Play)$/i);
        if(play){this.pauseTimes.push(Date.now());await this.click(play,epoch);}
      }
      return;
    }
    if(frames.some(f=>f.data.unhandledRequired))return this.attention('当前任务不是视频或选择题，请本人处理后继续');
    const body=frames.map(f=>f.data.body).join('\n');
    const progress=body.match(/(?:已完成任务点|任务点进度)\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/);
    if(progress&&+progress[2]>0&&progress[1]===progress[2]){this.stop(false);this.update('done','平台显示本课程全部任务点已完成');return;}
    const course=this.button(frames,new RegExp('^'+(this.config.courseName||'创新创业基础').replace(/[.*+?^$()|[\]\\]/g,'\\$&')+'$'));
    if(course){await this.click(course,epoch);this.update('navigating','进入指定课程');return;}
    for(const {frame} of frames){
      const label=frame.getByText(this.config.courseName||'创新创业基础',{exact:true});
      if(await label.count()===1&&await label.isVisible()){
        await label.click();this.guard(epoch);this.navigationGrace=Date.now()+12000;this.update('navigating','正在打开课程：'+this.config.courseName);return;
      }
    }
    const chapters=this.button(frames,/^章节$/);
    if(chapters){await this.click(chapters,epoch);await delay(500);const fresh=await this.frames();const picked=await this.pickChapter(fresh,epoch);if(picked)return;}
    if(await this.pickChapter(frames,epoch))return;
    const videoTab=this.button(frames,/^视频$/);
    if(videoTab){await this.click(videoTab,epoch);return;}
    if(Date.now()<(this.navigationGrace??0))return;
    this.log('页面识别信息：'+frames.map(f=>f.data.title+' '+f.data.body.slice(0,260).replace(/\s+/g,' ')).join(' | '),'warn');
    this.attention('没有识别到可执行的任务。请在专用窗口进入一个未完成章节，再继续运行');
  }
  async pickChapter(frames,epoch){
    for(const {frame} of frames){
      const catalog=frame.locator('.posCatalog_name');
      for(let i=0;i<await catalog.count();i++){
        const item=catalog.nth(i);
        const info=await item.evaluate(el=>({text:el.innerText,unfinished:!!el.closest('[id^="cur"]')?.querySelector('.catalog_points_yi'),active:!!el.closest('.posCatalog_active')}));
        if(info.unfinished&&!info.active&&/^\d+\.\d+\s/.test(info.text.trim())){
          await item.click();this.guard(epoch);this.update('navigating','进入未完成章节：'+info.text.trim().slice(0,70));await delay(600);return true;
        }
      }
      const links=frame.getByRole('link');const count=await links.count();
      for(let i=0;i<count;i++){
        const link=links.nth(i);const label=(await link.innerText().catch(()=>'' )).trim();
        if(!/^\d+\.\d+\s/.test(label))continue;
        const info=await link.evaluate(el=>({text:el.innerText,finished:!!el.closest('.finish,.finished,.completed')||!!el.querySelector('.icon_Completed,.catalog_finish'),title:el.getAttribute('title')??''}));
        if(info.finished)continue;
        await link.click();this.guard(epoch);this.update('navigating','进入章节：'+label.slice(0,70));await delay(600);return true;
      }
    }return false;
  }
  async advance(frames,signature,epoch){
    const next=this.button(frames,/^下一节$|^下一任务$/);
    if(next){await this.click(next,epoch);this.lastAdvance={signature,at:Date.now()};this.update('navigating','切换到下一节或章节作业');await delay(600);return;}
    if(await this.pickChapter(frames,epoch))return;
    return this.attention('当前任务已完成，但未找到下一节按钮；请检查是否已到课程末尾');
  }
  async ocr(frame,selector){
    if(!this.ocrAvailable)return null;
    const file=join(this.dataDir,'ocr-'+Date.now()+'-'+Math.random().toString(16).slice(2)+'.png');
    try{
      await frame.locator(selector).screenshot({path:file});
      if(this.nativeOCR){const {stdout}=await execFileAsync(this.ocrPath,[file],{timeout:20000,maxBuffer:2_000_000});return JSON.parse(stdout).map(x=>x.text).join('\n');}
      this.ocrWorker??=await createOfflineOCR(join(this.dataDir,'ocr-data'));
      const result=await this.ocrWorker.recognize(file);return result.data.text.trim();
    }
    finally{await unlink(file).catch(()=>{});}
  }
  async decode(question,frame){
    if(!question.obfuscated||!this.ocrAvailable)return question;
    const q={...question,options:question.options.map(o=>({...o}))};
    const stem=await this.ocr(frame,q.stemSelector);
    if(stem)q.question=stem.replace(/^【.*?题】\s*/,'').replace(/^\d+[.、]\s*/,'').replace(/\n/g,'');
    for(const option of q.options){const value=await this.ocr(frame,option.selector);if(value)option.text=value.replace(/^[A-H][.、\s]\s*/,'').replace(/\n/g,'');}
    q.ocr=true;return q;
  }
  async quiz({frame,data},epoch){
    this.update('solving','正在核对题库和题目',{video:null,questions:[]});
    const items=[];
    for(const raw of data.questions){
      this.guard(epoch);const question=await this.decode(raw,frame);this.guard(epoch);
      const key=fingerprint(question);let answer=matchBank(question,this.bank);
      if(answer?.conflict){items.push({question,rawKey:fingerprint(raw),answer:null,error:answer.source});continue;}
      if(answer)this.state.bankHits++;
      if(!answer)answer=this.cache.get(key)??null;
      if(!answer&&this.config.aiEnabled){
        if(question.obfuscated&&!question.ocr&&!this.config.visionEnabled){items.push({question,rawKey:fingerprint(raw),answer:null,error:'混淆字体未能本地识别，需要视觉模型或手动答案'});continue;}
        this.state.aiCalls++;this.update('solving','正在请求 AI 分析题目 '+(items.length+1));
        let image;if(this.config.visionEnabled&&question.obfuscated&&!question.ocr)image=(await frame.locator(raw.selector).screenshot()).toString('base64');
        this.aiAbort=new AbortController();
        try{answer=await solveAI(question,this.config,this.keys,{image,signal:this.aiAbort.signal});this.guard(epoch);this.cache.set(key,answer);}
        catch(error){this.guard(epoch);items.push({question,rawKey:fingerprint(raw),answer:null,error:this.aiAbort.signal.aborted?'AI 已停止，需手动选择答案':error.message});continue;}
        finally{this.aiAbort=null;}
      }
      items.push({question,rawKey:fingerprint(raw),answer,error:answer?null:'题库未命中，且未配置 AI 解题'});
    }
    this.guard(epoch);this.pending={frame,items};
    this.state.questions=items.map(i=>({...i.question,answer:i.answer,error:i.error}));
    const missing=items.some(i=>!i.answer||i.answer.confidence<=Number(this.config.minConfidence??0.95));
    if(missing||this.config.answerMode==='suggest'){
      this.stop(false);this.update('review',missing?'部分题目需要你核对，未自动填写或提交':'答案已准备好，等待你核对');this.armReviewTimeout();return;
    }
    await this.fill(items,frame,epoch);
    if(this.config.answerMode==='auto')return this.submit(frame,epoch);
    this.stop(false);this.update('review','本节已填写，等待你确认提交');this.armReviewTimeout();
  }
  armReviewTimeout(){
    this.cancelReviewTimeout();
    if(!this.config.reviewAutoSubmit||!this.pending||this.state.phase!=='review')return;
    const pending=this.pending;
    if(pending.items.some(item=>item.error||!item.answer?.answers?.length)){this.log('没有完整且无冲突的推荐答案，本节不会超时自动提交','warn');return;}
    const seconds=Number(this.config.reviewTimeoutSeconds??60);
    this.state.reviewDeadline=Date.now()+seconds*1000;
    this.reviewTimer=setTimeout(async()=>{
      if(this.pending!==pending||this.state.phase!=='review'||this.state.running)return;
      this.log('人工核对等待超时，采用当前推荐/所选答案自动提交（未经本人确认）','warn');
      const answers=pending.draft??pending.items.map(item=>item.answer.answers);
      try{await this.review(answers,{submit:true,source:'等待超时自动采用，未经本人确认'});}catch(error){this.attention(error.message);}
    },seconds*1000);
  }
  reviewDraft(answers){
    if(!this.pending||this.state.phase!=='review'||this.state.running)throw new Error('当前没有待核对的题目');
    if(!Array.isArray(answers)||answers.length!==this.pending.items.length)throw new Error('题目数量不符');
    answers.forEach((values,i)=>validateAnswer(this.pending.items[i].question,{answers:values,confidence:1}));
    this.pending.draft=answers;this.armReviewTimeout();
  }
  async fill(items,frame,epoch){
    const fresh=await frame.evaluate(probeDocument);
    if(fresh.questions.length!==items.length||items.some((x,i)=>fingerprint(fresh.questions[i])!==x.rawKey))throw new Error('题目内容已变化，请重新识别后再填写');
    for(let i=0;i<items.length;i++){
      for(const option of fresh.questions[i].options){
        this.guard(epoch);const desired=items[i].answer.answers.includes(option.label);
        if(option.selected!==desired){
          if(fresh.questions[i].type!=='multiple'&&!desired)continue;
          await frame.locator(option.selector).click();
        }
      }
      const actual=(await frame.evaluate(probeDocument)).questions[i]?.options.filter(o=>o.selected).map(o=>o.label).sort().join('');
      if(actual!==[...items[i].answer.answers].sort().join(''))throw new Error('选项没有正确选中；已停止，未提交');
    }
    this.log('本节答案已填写并核对');
  }
  async submit(frame,epoch){
    const frames=await this.frames();const submit=this.button(frames,/^提交$/);
    if(!submit)throw new Error('没有找到提交按钮');
    await this.click(submit,epoch);this.update('submitting','等待平台确认提交结果');
    for(let i=0;i<30;i++){
      await delay(500);this.guard(epoch);const snaps=await this.frames();
      if(snaps.some(s=>s.data.verification))return this.attention('提交时出现验证码，需本人处理');
      if(snaps.some(s=>s.data.quizComplete)){this.pending=null;return;}
      if(snaps.some(s=>/确认提交[？?]/.test(s.data.body))){const yes=this.button(snaps,/^确定$|^确认提交$/);if(yes)await this.click(yes,epoch);}
    }
    this.attention('提交结果尚未确认，为避免重复提交已暂停，请检查页面');
  }
  async review(answers,{submit=false,source='本人确认'}={}){
    if(this.state.running)throw new Error('本节正在处理，请勿重复提交');
    if(!this.pending)throw new Error('当前没有待核对的题目');
    const {frame,items}=this.pending;
    if(!Array.isArray(answers)||answers.length!==items.length)throw new Error('请核对每一道题的答案');
    this.cancelReviewTimeout();
    for(let i=0;i<items.length;i++)items[i].answer=validateAnswer(items[i].question,{answers:answers[i],confidence:source==='本人确认'?1:items[i].answer?.confidence??0,source});
    this.epoch++;const epoch=this.epoch;this.state.running=true;
    try{await this.fill(items,frame,epoch);if(submit){await this.submit(frame,epoch);this.loop(epoch);}
      else {this.stop(false);this.update('review','已填写，等待确认提交');}}
    catch(error){if(error!==STOP)this.attention(error.message);}
  }
}
