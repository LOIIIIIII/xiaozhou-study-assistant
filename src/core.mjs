import { createHash } from 'node:crypto';
export const normalize = (s) => String(s ?? '').normalize('NFKC')
  .replace(/【.*?题】|\[(?:单选|多选|判断)题\]/g, '')
  .replace(/^\s*\d+[.、．]\s*/, '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
export const fingerprint = (q) => createHash('sha256').update(JSON.stringify([
  normalize(q.question), q.type, q.options.map(o => normalize(o.text))
])).digest('hex');
export const canonicalBoolean = (s) => {
  const n = normalize(s);
  if (['对','正确','是','true','t'].includes(n) || String(s).trim() === '√') return 'TRUE';
  if (['错','错误','否','false','x','f'].includes(n) || String(s).trim() === '×') return 'FALSE';
  return null;
};
export function dice(a, b) {
  a = normalize(a); b = normalize(b);
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map();
  for (let i=0;i<a.length-1;i++) counts.set(a.slice(i,i+2),(counts.get(a.slice(i,i+2))??0)+1);
  let same=0;
  for (let i=0;i<b.length-1;i++) { const x=b.slice(i,i+2), n=counts.get(x)??0; if(n){same++;counts.set(x,n-1);} }
  return 2*same/(a.length+b.length-2);
}
function csvRows(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<=text.length;i++){
    const ch=text[i]??'\n';
    if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&(ch===','||ch==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(ch==='\n'){if(row.some(Boolean))rows.push(row);row=[];}}
    else cell+=ch;
  }
  if(quoted)throw new Error('CSV 的引号没有闭合');
  return rows;
}
function record(raw) {
  if(!raw || typeof raw!=='object' || typeof(raw.question??raw.题目)!=='string')throw new Error('每条答案都需要 question（题目）');
  let options=raw.options??raw.选项??{};
  if(typeof options==='string'){try{options=JSON.parse(options);}catch{options=Object.fromEntries(options.split('|').map((x,i)=>[String.fromCharCode(65+i),x.replace(/^[A-Z][.、]\s*/, '')]));}}
  if(Array.isArray(options))options=Object.fromEntries(options.map((x,i)=>[String.fromCharCode(65+i),typeof x==='string'?x:x.text]));
  const answers=raw.answers??raw.answer??raw.答案??[];
  const answerTexts=raw.answerTexts??[];
  return { question:raw.question??raw.题目,type:raw.type??raw.类型??'',options,
    answers:Array.isArray(answers)?answers:String(answers).trim().split(/[,\s，;；]+/).filter(Boolean),
    answerTexts:Array.isArray(answerTexts)?answerTexts:[String(answerTexts)],source:raw.source??'导入题库',
    explanation:String(raw.explanation??'') };
}
export function parseBank(text, format='auto') {
  if(typeof text!=='string'||text.length>8_000_000)throw new Error('题库不能超过 8 MB');
  text=text.replace(/^\uFEFF/,'').trim(); if(!text) return [];
  if(format==='json'||(format==='auto'&&/^[{[]/.test(text))){
    const data=JSON.parse(text);const items=Array.isArray(data)?data:data.questions??[data];
    return items.map(record);
  }
  if(format==='csv'||/^question,|^题目,/.test(text)){
    const [headers,...rows]=csvRows(text);return rows.map(row=>record(Object.fromEntries(headers.map((h,i)=>[h.trim(),row[i]??'']))));
  }
  const out=[];let q=null;
  for(const line of text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)){
    const opt=line.match(/^([A-H])[、.．:：]\s*(.+)$/);
    const ans=line.match(/^(?:正确)?答案\s*[:：]\s*(.+)$/);
    const stem=line.match(/^(?:\d+[、.．]|题目[:：])\s*(.+)$/);
    if(stem){
      if(q)out.push(record(q));
      let question=stem[1],inline=question.match(/([A-H]{1,8}|[√×])$/);
      q={question,options:{},answers:[]};
      if(inline){q.answers=[inline[1]];q.question=question.slice(0,-inline[1].length).trim();}
      else { const inside=question.match(/[（(]([A-H]{1,8})[）)]/);if(inside){q.answers=[inside[1]];q.question=question.replace(inside[0],'（）');} }
    }else if(q&&opt)q.options[opt[1]]=opt[2];
    else if(q&&ans)q.answers=[ans[1]];
  }
  if(q)out.push(record(q));
  if(!out.length)throw new Error('未识别题库。请导入 JSON、CSV，或“1、题目 / A、选项 / 答案：A”格式文本');
  return out;
}
function answerContent(entry) {
  if(entry.answerTexts.length)return entry.answerTexts;
  const joined=entry.answers.join('').replace(/^(?:答案[:：])?/,'').trim();
  const bool=canonicalBoolean(joined);if(bool)return [bool];
  if(/^[A-H]+$/i.test(joined)) {
    const letters=[...new Set(joined.toUpperCase())];
    if(!letters.every(l=>typeof entry.options[l]==='string'))return null;
    return letters.map(l=>entry.options[l]);
  }
  return entry.answers;
}
export function validateAnswer(question, result) {
  if(!result || !Array.isArray(result.answers))throw new Error('AI 没有返回 answers 数组');
  const values=[...new Set(result.answers.map(s=>String(s).toUpperCase().trim()))];
  if(!values.length||values.some(l=>!question.options.some(o=>o.label===l)))throw new Error('答案包含当前题目中不存在的选项');
  if(question.type!=='multiple'&&values.length!==1)throw new Error('单选或判断题必须且只能选择一项');
  const confidence=Number(result.confidence);
  if(!Number.isFinite(confidence)||confidence<0||confidence>1)throw new Error('答案置信度必须在 0～1 之间');
  return {...result,answers:values,confidence};
}
export function matchBank(question, entries) {
  const candidates=entries.map(e=>({e,similarity:dice(question.question,e.question)}))
    .filter(c=>c.similarity>=0.92).sort((a,b)=>b.similarity-a.similarity);
  const matches=[];
  for(const {e,similarity} of candidates){
    const texts=answerContent(e);if(!texts?.length)continue;
    const labels=[];let good=true;
    for(const text of texts){
      const found=question.options.filter(o=>canonicalBoolean(text)
        ? canonicalBoolean(o.text)===canonicalBoolean(text)
        : normalize(o.text)===normalize(text));
      if(found.length!==1){good=false;break;}labels.push(found[0].label);
    }
    if(good){try{matches.push(validateAnswer(question,{answers:labels,confidence:similarity===1?1:0.95,source:e.source,explanation:e.explanation}));}catch{}}
  }
  if(!matches.length)return null;
  if(new Set(matches.map(m=>[...m.answers].sort().join(''))).size!==1)return {conflict:true,source:'题库中存在冲突答案'};
  return matches[0];
}
export const allowedCourseURL = (value, demo=false) => {
  const url=new URL(value);
  if(demo&&['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname.startsWith('/demo/'))return url;
  if(url.protocol!=='https:'||!/(^|\.)(chaoxing\.com|xuexitong\.com)$/.test(url.hostname))
    throw new Error('课程地址仅支持学习通或超星官方 HTTPS 页面');
  if(url.username||url.password)throw new Error('地址不能包含账号密码');
  return url;
};
export const clampSpeed = (n) => Math.min(2,Math.max(1,Number(n)||2));
