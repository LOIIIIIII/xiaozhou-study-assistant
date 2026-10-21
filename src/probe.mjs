// Read DOM only: no private endpoints, answer fields or playback-report manipulation.
export function probeDocument() {
  const visible=e=>!!e&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';
  const text=e=>(e?.innerText??e?.textContent??'').trim();
  const css=e=>{
    if(!e||e===document.documentElement)return 'html';
    if(e.id)return '#'+CSS.escape(e.id);
    const parts=[];while(e&&e!==document.documentElement){const tag=e.tagName.toLowerCase();const siblings=[...e.parentElement.children].filter(s=>s.tagName===e.tagName);parts.unshift(tag+':nth-of-type('+(siblings.indexOf(e)+1)+')');e=e.parentElement;if(e?.id){parts.unshift('#'+CSS.escape(e.id));break;}}
    return parts.join(' > ');
  };
  const body=document.body?.innerText??'';
  const questions=[...document.querySelectorAll('.TiMu,[data-study-question]')].filter(visible).map((el,index)=>{
    const title=el.querySelector('.Zy_TItle [role="option"]:not(i),.Zy_TItle .fontLabel,.Zy_TItle,[data-question-stem]')??el;
    const stem=text(title).replace(/^【.*?题】\s*/,'').replace(/^\d+[.、]\s*/,'');
    const choices=[...el.querySelectorAll('li[role="radio"],li[role="checkbox"],[data-option],label:has(input[type=radio]),label:has(input[type=checkbox])')].filter(visible);
    const options=choices.map((o,i)=>{
      const label=text(o.querySelector('span:first-child,i:first-child'))?.match(/^[A-H]$/)?.[0]??String.fromCharCode(65+i);
      return {label,text:text(o.querySelector('a,[data-option-text]')??o).replace(/^[A-H][.、\s]\s*/,''),selector:css(o),
        selected:o.getAttribute('aria-checked')==='true'||!!o.querySelector('input:checked')||o.classList.contains('check_answer')};
    });
    return {id:String(index),question:stem,type:/多选/.test(text(title))||choices.some(o=>o.getAttribute('role')==='checkbox'||o.querySelector('input[type=checkbox]'))?'multiple':/判断/.test(text(title))?'boolean':'single',
      options,selector:css(el),stemSelector:css(title),obfuscated:!!el.querySelector('.font-cxsecret')};
  }).filter(q=>q.options.length>0);
  const buttons=[...document.querySelectorAll('button,a,[role="button"],[role="option"]')].filter(visible)
    .map(e=>({text:(e.getAttribute('aria-label')||text(e)).trim(),selector:css(e),disabled:e.hasAttribute('disabled')||e.getAttribute('aria-disabled')==='true'}));
  const videos=[...document.querySelectorAll('video')].filter(visible).map(v=>({
    selector:css(v),currentTime:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,
    paused:v.paused,ended:v.ended,rate:v.playbackRate,readyState:v.readyState,error:v.error?.message??null
  }));
  const heading=text(document.querySelector('.ceyan_name h3,h3[data-quiz-title],h2,h1'));
  return {url:location.href,title:document.title,body:body.slice(0,22000),heading,questions,buttons,videos,
    quizComplete:/本次成绩|第\d+次作答/.test(body)&&/已完成/.test(body),
    taskComplete:!![...document.querySelectorAll('[role="option"],.ans-job-icon,.ans-job-finished')].find(e=>visible(e)&&(e.getAttribute('aria-label')==='任务点已完成'||e.getAttribute('title')==='任务点已完成'||text(e)==='任务点已完成'||e.classList.contains('ans-job-finished'))),
    login:/passport2\./.test(location.hostname)&&[...document.querySelectorAll('input[type=password]')].some(visible),
    verification:/请完成安全验证|请依次点击|拖动滑块|人脸识别|请进行身份验证/.test(body),
    exam:/\/exam(?:ination)?[\/?]|\/testPaper\//i.test(location.pathname),
    noSpeed:/当前视频不可倍速/.test(body),
    unhandledRequired:/任务点未完成/.test(body)&&!questions.length&&!videos.length&&!document.querySelector('iframe'),
    score:body.match(/本次成绩\s*(\d+(?:\.\d+)?)\s*分/)?.[1]??null};
}
