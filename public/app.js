const $=id=>document.getElementById(id);let token='',state=null,previewURL=null,busy=false,renderedQuestions='';
const phaseNames={idle:'等待配置',ready:'可以开始',running:'正在识别',watching:'视频播放中',solving:'题目分析中',submitting:'提交确认中',review:'待你核对',navigating:'切换任务中',paused:'已暂停',needs_attention:'需要你处理',done:'课程已完成'};
const time=seconds=>Number.isFinite(seconds)?Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0'):'—';
const qrButton=document.createElement('button');qrButton.className='button secondary';qrButton.textContent='放大登录二维码';$('refresh-preview').after(qrButton);
let qrURL;
const renewQR=document.createElement('button');renewQR.id='renew-qr';renewQR.className='button secondary';renewQR.textContent='刷新登录二维码';qrButton.after(renewQR);
renewQR.onclick=()=>action(async()=>{await api('browser',{headed:false});await refresh();await refreshPreview();toast('登录页已重新打开，请扫描新的二维码。右侧是静态预览，图片内的按钮不可直接点击。');});
qrButton.onclick=()=>action(async()=>{const response=await fetch('/api/qrcode',{headers:{'X-Study-Token':token}});if(!response.ok)throw new Error((await response.json()).error);if(qrURL)URL.revokeObjectURL(qrURL);qrURL=URL.createObjectURL(await response.blob());$('qr-large').src=qrURL;$('qr-dialog').showModal();});
$('qr-close').onclick=()=>$('qr-dialog').close();
async function api(path,body){
  const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{'X-Study-Token':token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw new Error(data.error??'请求失败');return data;
}
function toast(message,error=false){$('toast').textContent=message;$('toast').className='toast'+(error?' error':'');}
async function action(fn){if(busy)return;busy=true;try{await fn();await refresh();}catch(e){toast(e.message,true);}finally{busy=false;}}
function populate(config){
  for(const key of ['courseUrl','courseName','speed','answerMode','apiBase','model','minConfidence','reviewTimeoutSeconds'])$(key).value=config[key]??'';
  for(const key of ['aiEnabled','visionEnabled','searchEnabled','saveSecrets','reviewAutoSubmit'])$(key).checked=!!config[key];
}
function renderQuestions(questions){
  const serialized=JSON.stringify(questions);if(serialized===renderedQuestions)return;renderedQuestions=serialized;
  const container=$('questions');container.replaceChildren();
  questions.forEach((q,index)=>{
    const card=document.createElement('article');card.className='question-card';const heading=document.createElement('h3');
    heading.textContent=(index+1)+'. '+q.question;card.append(heading);
    q.options.forEach(o=>{const label=document.createElement('label');label.className='choice';const input=document.createElement('input');
      input.type=q.type==='multiple'?'checkbox':'radio';input.name='answer-'+index;input.value=o.label;input.checked=q.answer?.answers?.includes(o.label)??false;
      const text=document.createElement('span');text.textContent=o.label+' · '+o.text;label.append(input,text);card.append(label);});
    const meta=document.createElement('p');meta.className='answer-meta'+(q.error?' error':'');meta.textContent=q.error??[q.answer?.source,q.answer?'置信度 '+Math.round(q.answer.confidence*100)+'%':'',q.answer?.explanation].filter(Boolean).join(' · ');card.append(meta);
    for(const source of q.answer?.sources??[]){if(!/^https?:\/\//.test(source.url))continue;const link=document.createElement('a');link.className='answer-meta';link.textContent=source.title||source.url;link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
    container.append(card);
  });
}
async function refreshPreview(){
  if(!state?.browserOpen)return;
  const response=await fetch('/api/screenshot',{headers:{'X-Study-Token':token}});if(!response.ok)return;
  const blob=await response.blob();if(previewURL)URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(blob);
  $('preview').src=previewURL;$('preview').classList.remove('hidden');$('preview-empty').classList.add('hidden');
}
async function refresh(first=false){
  state=await api('state');if(first)populate(state.config);
  $('phase').textContent=phaseNames[state.phase]??state.phase;$('message').textContent=state.message;
  $('bank-count').textContent=state.bankCount;$('count-videos').textContent=state.completedVideos;$('count-quizzes').textContent=state.completedQuizzes;$('count-hits').textContent=state.bankHits;$('count-ai').textContent=state.aiCalls;
  $('api-status').textContent=state.config.apiKeyConfigured?'接口已配置':'未配置接口';$('speed-stamp').replaceChildren();
  $('speed-stamp').append(document.createTextNode(String(state.config.speed)));const x=document.createElement('span');x.textContent='×';$('speed-stamp').append(x);
  $('demo-banner').classList.toggle('hidden',!state.demo);$('start').disabled=state.running||!state.browserOpen;$('pause').disabled=!state.running;
  const v=state.video;$('video-label').textContent=v?(v.paused?'视频已暂停':'当前视频'):'尚未播放视频';$('video-time').textContent=v?time(v.currentTime)+' / '+time(v.duration):'— / —';
  $('progress').value=v?.duration?v.currentTime/v.duration:0;$('actual-speed').textContent=v?'实际速度 '+v.rate+' × · '+(v.paused?'已暂停':'播放中')+' · 本地OCR '+(state.ocrAvailable?'可用':'未安装'):'后台使用专用浏览器，不占用系统鼠标。';
  $('review-section').classList.toggle('hidden',state.phase!=='review');renderQuestions(state.questions??[]);
  $('logs').replaceChildren(...state.logs.slice(-15).reverse().map(log=>{const li=document.createElement('li');li.className=log.level;
    const t=document.createElement('time');t.textContent=new Date(log.time).toLocaleTimeString('zh-CN',{hour12:false});const text=document.createElement('span');text.textContent=log.message;li.append(t,text);return li;}));
  if(!state.logs.length){const li=document.createElement('li');li.className='empty-log';li.textContent='等待开始第一项任务。';$('logs').append(li);}
}
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>{
  for(const b of document.querySelectorAll('[data-tab]'))b.classList.toggle('active',b===button);
  for(const panel of document.querySelectorAll('.panel'))panel.classList.toggle('hidden',panel.id!=='panel-'+button.dataset.tab);
});
$('run-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{await api('config',{courseUrl:$('courseUrl').value,courseName:$('courseName').value,speed:Number($('speed').value),answerMode:$('answerMode').value,reviewAutoSubmit:$('reviewAutoSubmit').checked,reviewTimeoutSeconds:Number($('reviewTimeoutSeconds').value)});toast('运行配置已保存');});});
$('ai-form').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const data={};for(const k of ['apiBase','model','apiKey','searchKey'])data[k]=$(k).value;for(const k of ['aiEnabled','visionEnabled','searchEnabled','saveSecrets'])data[k]=$(k).checked;data.minConfidence=Number($('minConfidence').value);await api('config',data);$('apiKey').value='';$('searchKey').value='';toast('API 配置已保存；密钥不会返回页面或写入日志');});});
$('open-browser').addEventListener('click',()=>action(async()=>{await api('browser',{headed:false});await refresh();await refreshPreview();}));
$('headed').addEventListener('click',()=>action(async()=>{await api('browser',{headed:true});toast('已打开独立登录窗口。重新打开浏览器会暂停当前任务。');await refresh();await refreshPreview();}));
$('start').addEventListener('click',()=>action(()=>api('start',{})));$('pause').addEventListener('click',()=>action(()=>api('pause',{})));
$('refresh-preview').addEventListener('click',()=>action(refreshPreview));
$('bank-file').addEventListener('change',async()=>{const f=$('bank-file').files[0];if(f)$('bank-text').value=await f.text();});
$('import-bank').addEventListener('click',()=>action(async()=>{const data=await api('import',{text:$('bank-text').value});toast('已导入 '+data.imported+' 条答案，共 '+data.total+' 条');}));
$('export-bank').addEventListener('click',()=>action(async()=>{const data=await api('export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='study-answers.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
function review(submit){action(async()=>{const answers=state.questions.map((q,i)=>[...document.querySelectorAll('input[name="answer-'+i+'"]:checked')].map(e=>e.value));await api('review',{answers,submit});toast(submit?'正在提交，等待平台确认结果':'已填写到课程页面');});}
$('review-fill').addEventListener('click',()=>review(false));$('review-submit').addEventListener('click',()=>review(true));
try{const session=await fetch('/api/session').then(r=>r.json());token=session.token;await refresh(true);if(state.browserOpen)await refreshPreview();
setInterval(()=>{if(!busy)refresh().catch(e=>toast(e.message,true));},2500);setInterval(()=>{if(!busy&&state?.browserOpen&&!document.hidden)refreshPreview().catch(()=>{});},7000);
}catch(error){toast('无法连接本机服务：'+error.message,true);}

$('stop-ai').onclick=()=>action(async()=>{await api('ai/stop',{});$('aiEnabled').checked=false;toast('AI 调用已停止；已发送的请求可能仍计费。视频与本地题库可继续运行。');});
$('review-cancel').onclick=()=>action(()=>api('review-cancel',{}));
function selectedAnswers(){return (state?.questions??[]).map((q,i)=>[...document.querySelectorAll('input[name="answer-'+i+'"]:checked')].map(e=>e.value));}
$('questions').addEventListener('change',()=>{api('review-draft',{answers:selectedAnswers()}).catch(()=>api('review-cancel',{}).catch(()=>{}));});
setInterval(()=>{const deadline=state?.reviewDeadline;$('review-countdown').textContent=deadline?'无人操作 '+Math.max(0,Math.ceil((deadline-Date.now())/1000))+' 秒后自动提交当前推荐/所选答案；置信度不是正确率。':'本节不会超时自动提交。';$('stop-ai').disabled=!state?.config.aiEnabled;},500);
