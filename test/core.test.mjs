import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBank,matchBank,validateAnswer,allowedCourseURL,clampSpeed} from '../src/core.mjs';
import {solveAI,completionURL} from '../src/ai.mjs';
const q={question:'创业资源包含什么？',type:'single',options:[{label:'A',text:'资金'},{label:'B',text:'设备'}]};
test('答案按内容匹配，选项顺序变化仍正确',()=>{
 const bank=parseBank(JSON.stringify([{question:q.question,options:{A:'设备',B:'资金'},answers:['B']}]));
 assert.deepEqual(matchBank(q,bank).answers,['A']);
});
test('冲突答案不能自动使用；孤立字母不能误匹配',()=>{
 const bank=parseBank(JSON.stringify([{question:q.question,answerTexts:['资金']},{question:q.question,answerTexts:['设备']}]));
 assert.equal(matchBank(q,bank).conflict,true);
 assert.equal(matchBank(q,parseBank(JSON.stringify([{question:q.question,answers:['A']}]))),null);
});
test('CSV 引号和判断题语义',()=>{
 const bank=parseBank('question,answer\n"创业资源包含什么？",正确','csv');
 assert.deepEqual(matchBank({...q,type:'boolean',options:[{label:'A',text:'错误'},{label:'B',text:'对'}]},bank).answers,['B']);
 assert.throws(()=>parseBank('question,answer\n"未闭合,A','csv'));
});
test('拒绝错误选项、多个单选答案和不可信地址',()=>{
 assert.throws(()=>validateAnswer(q,{answers:['C'],confidence:1}));
 assert.throws(()=>validateAnswer(q,{answers:['A','B'],confidence:1}));
 assert.throws(()=>allowedCourseURL('https://chaoxing.com.evil.test/'));
 assert.throws(()=>completionURL('http://example.com/v1'));
 assert.equal(clampSpeed(16),2);
});
test('AI 响应验证和最小题目数据请求',async()=>{
 let request;
 const result=await solveAI(q,{apiBase:'https://example.com/v1',model:'test'},{apiKey:'local-secret'},{fetcher:async(url,init)=>{
 request=JSON.parse(init.body);return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({answers:['B'],confidence:.8})}}]})};
 }});
 assert.equal(result.confidence,.8);assert.ok(!JSON.stringify(request).includes('local-secret'));
});
