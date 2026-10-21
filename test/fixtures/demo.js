const stage=document.querySelector('#stage');
let step=0;
function render(){
 if(step===0){
  stage.innerHTML='<h1>测试视频</h1><video width="480" height="270" src="/demo/video.mp4" playsinline></video><p id="job">任务点未完成</p><button id="play">播放</button><button id="rate" aria-label="播放速度">1x</button><button id="next">下一节</button>';
  const video=stage.querySelector('video');
  document.querySelector('#play').onclick=()=>video.play();
  document.querySelector('#rate').onclick=()=>{video.playbackRate=video.playbackRate===1?2:1;document.querySelector('#rate').textContent=video.playbackRate+'x';};
  video.onended=()=>{document.querySelector('#job').textContent='任务点已完成';document.querySelector('#job').setAttribute('role','option');};
 }else if(step===1){
  stage.innerHTML='<h1>章节作业</h1><div class="TiMu"><div class="Zy_TItle">【单选题】测试题：一加一等于几？</div><ul><li role="radio" aria-checked="false" id="a"><span>A</span><a>二</a></li><li role="radio" aria-checked="false" id="b"><span>B</span><a>三</a></li></ul></div><button id="submit">提交</button><button id="next">下一节</button>';
  for(const item of stage.querySelectorAll('li'))item.onclick=()=>{for(const other of stage.querySelectorAll('li'))other.setAttribute('aria-checked',String(other===item));};
  document.querySelector('#submit').onclick=()=>{if(!confirm('确认提交？'))return;stage.innerHTML='<h1>本次成绩 '+(document.querySelector('#a').getAttribute('aria-checked')==='true'?100:0)+' 分 已完成</h1><button id="next">下一节</button>';document.querySelector('#next').onclick=next;};
 }else{stage.innerHTML='<h1>课程结束</h1><p>已完成任务点 2/2</p>';return;}
 document.querySelector('#next').onclick=next;
}
function next(){step++;render();}
render();
