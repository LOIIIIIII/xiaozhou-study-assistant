import http from 'node:http';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { StudyWorker } from './worker.mjs';
import { parseBank, allowedCourseURL, clampSpeed } from './core.mjs';
import { completionURL } from './ai.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const port=Number(process.env.STUDY_PORT??4318);
const demo=process.env.STUDY_DEMO==='1';
const dataDir=process.env.STUDY_DATA_DIR??join(homedir(),'Library','Application Support','LocalStudyAssistant');
await mkdir(dataDir,{recursive:true,mode:0o700});await chmod(dataDir,0o700);
async function load(name,fallback){try{return JSON.parse(await readFile(join(dataDir,name),'utf8'));}catch{return fallback;}}
async function save(name,data){await writeFile(join(dataDir,name),JSON.stringify(data,null,2),{mode:0o600});await chmod(join(dataDir,name),0o600);}
const defaults={courseName:'创新创业基础',courseUrl:'',speed:2,answerMode:'suggest',minConfidence:0.95,
  aiEnabled:false,visionEnabled:false,searchEnabled:false,apiBase:'',model:'',saveSecrets:false};
const config={...defaults,...await load('settings.json',{})};
const stored=await load('keys.json',{});
const keys={apiKey:process.env.STUDY_AI_API_KEY??stored.apiKey??'',searchKey:process.env.STUDY_SEARCH_API_KEY??stored.searchKey??''};
let bank=await load('answers.json',[]);
const worker=new StudyWorker({dataDir,config,bank,keys,demo});
const token=randomBytes(32).toString('hex');
const allowedOrigins=new Set(['http://127.0.0.1:'+port,'http://localhost:'+port]);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.mp4':'video/mp4'};
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
async function body(req){
  const chunks=[];let n=0;
  for await(const chunk of req){n+=chunk.length;if(n>8_500_000)throw new Error('请求超过8 MB');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new Error('请求必须是有效 JSON');}
}
function publicConfig(){return {...config,apiKeyConfigured:!!keys.apiKey,searchKeyConfigured:!!keys.searchKey};}
const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  const host=req.headers.host??'';
  if(!['127.0.0.1:'+port,'localhost:'+port].includes(host))return json(res,403,{error:'无效的本机地址'});
  if(req.headers.origin&&!allowedOrigins.has(req.headers.origin))return json(res,403,{error:'不接受其他网站发起的请求'});
  if(req.headers['sec-fetch-site']==='cross-site')return json(res,403,{error:'不接受跨站请求'});
  const path=new URL(req.url,'http://'+host).pathname;
  try{
    if(path==='/api/health')return json(res,200,{ok:true,version:'1.0.0',demo});
    if(path==='/api/session'&&req.method==='GET')return json(res,200,{token,demo});
    if(path.startsWith('/api/')){
      if(req.headers['x-study-token']!==token)return json(res,401,{error:'请从本机控制台操作'});
      if(path==='/api/state'&&req.method==='GET')return json(res,200,{...worker.status(),config:publicConfig(),demo});
      if(path==='/api/screenshot'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'image/png'});return res.end(await worker.screenshot());}
      if(path==='/api/qrcode'&&req.method==='GET'){const png=await worker.qrcode();res.writeHead(200,{'Content-Type':'image/png'});return res.end(png);}
      if(path==='/api/export'&&req.method==='GET')return json(res,200,{questions:bank});
      if(req.method!=='POST')return json(res,405,{error:'不支持此方法'});
      const value=await body(req);
      if(path==='/api/config'){
        if(worker.state.running)throw new Error('请先暂停任务，再修改运行配置');
        const next={...config};
        for(const k of Object.keys(defaults))if(k in value)next[k]=value[k];
        next.courseName=String(next.courseName).slice(0,120);
        next.courseUrl=String(next.courseUrl).trim();if(next.courseUrl)allowedCourseURL(next.courseUrl,demo);
        next.speed=clampSpeed(next.speed);
        if(!['suggest','fill','auto'].includes(next.answerMode))throw new Error('答题模式不正确');
        next.minConfidence=Number(next.minConfidence);if(!Number.isFinite(next.minConfidence)||next.minConfidence<0||next.minConfidence>1)throw new Error('置信度阈值需要在0到1之间');
        for(const k of ['aiEnabled','visionEnabled','searchEnabled','saveSecrets'])next[k]=!!next[k];
        next.apiBase=String(next.apiBase).trim();next.model=String(next.model).trim().slice(0,160);
        if(next.apiBase)completionURL(next.apiBase);
        if(value.apiKey)keys.apiKey=String(value.apiKey).trim();
        if(value.searchKey)keys.searchKey=String(value.searchKey).trim();
        if(value.clearApiKey)keys.apiKey='';
        if(value.clearSearchKey)keys.searchKey='';
        Object.assign(config,next);await save('settings.json',config);
        await save('keys.json',config.saveSecrets?keys:{});
        return json(res,200,{config:publicConfig()});
      }
      if(path==='/api/browser'){await worker.open({headed:!!value.headed});return json(res,200,{ok:true});}
      if(path==='/api/start'){await worker.startAtCourse();return json(res,200,{ok:true});}
      if(path==='/api/pause'){worker.stop();return json(res,200,{ok:true});}
      if(path==='/api/close'){await worker.close();return json(res,200,{ok:true});}
      if(path==='/api/shutdown'){await worker.close();json(res,200,{ok:true});server.close(()=>process.exit(0));return;}
      if(path==='/api/import'){
        if(worker.state.running)throw new Error('请先暂停，再导入题库');
        const entries=parseBank(value.text,value.format??'auto');if(entries.length+bank.length>30000)throw new Error('题库最多支持30000条');
        bank=[...bank,...entries];worker.bank=bank;await save('answers.json',bank);worker.log('已导入 '+entries.length+' 条题目答案');
        return json(res,200,{imported:entries.length,total:bank.length});
      }
      if(path==='/api/review'){await worker.review(value.answers,{submit:!!value.submit});return json(res,200,{ok:true});}
      return json(res,404,{error:'接口不存在'});
    }
    const staticFiles={'/':'public/index.html','/app.js':'public/app.js','/style.css':'public/style.css','/example.json':'examples/answers.json'};
    const demoFiles=demo?{'/demo/course':'test/fixtures/demo.html','/demo/demo.js':'test/fixtures/demo.js','/demo/video.mp4':'test/fixtures/video.mp4'}:{};
    const file=staticFiles[path]??demoFiles[path];
    if(!file)return json(res,404,{error:'页面不存在'});
    res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});res.end(await readFile(join(root,file)));
  }catch(error){if(!res.headersSent)json(res,400,{error:error.message});else res.end();}
});
server.listen(port,'127.0.0.1',()=>console.log('本机学习助手 http://127.0.0.1:'+port));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{await worker.close();server.close(()=>process.exit(0));});
process.on('uncaughtException',error=>{console.error(error.message);process.exitCode=1;});
