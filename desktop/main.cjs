const {app,BrowserWindow,utilityProcess,dialog,Menu,shell}=require('electron');
const path=require('node:path');
let service,window,origin,quitting=false;
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();
else{
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
app.whenReady().then(async()=>{
 const env={...process.env,STUDY_PORT:'0',STUDY_DATA_DIR:path.join(app.getPath('userData'),'study-data')};
 // Desktop uses its own clean settings; no personal web-service configuration is copied.
 delete env.STUDY_AI_API_KEY;delete env.STUDY_SEARCH_API_KEY;delete env.STUDY_DEMO;
 if(app.isPackaged){env.PLAYWRIGHT_BROWSERS_PATH=path.join(process.resourcesPath,'browsers');env.STUDY_OCR_PATH=path.join(process.resourcesPath,'native','ocr');}
 service=utilityProcess.fork(path.join(__dirname,'service.cjs'),[],{env,stdio:'pipe',serviceName:'小舟学习任务服务'});
 service.stderr.on('data',b=>console.error(String(b)));
 const ready=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('本机服务启动超时')),20000);
  service.once('message',message=>{clearTimeout(timer);resolve(message);});
  service.once('exit',code=>{clearTimeout(timer);reject(new Error('本机服务未能启动，退出码 '+code));});
 });
 origin='http://127.0.0.1:'+ready.port;
 window=new BrowserWindow({width:1340,height:960,minWidth:900,minHeight:650,title:'小舟 · 学习助手',backgroundColor:'#f5f4ed',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 window.webContents.session.setPermissionRequestHandler((_web,_permission,callback)=>callback(false));
 window.webContents.setWindowOpenHandler(({url})=>{try{const u=new URL(url);if(u.protocol==='https:'&&!u.username&&!u.password)shell.openExternal(url);}catch{}return {action:'deny'};});
 window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin)event.preventDefault();});
 Menu.setApplicationMenu(Menu.buildFromTemplate([
  ...(process.platform==='darwin'?[{label:'小舟',submenu:[{role:'about'},{type:'separator'},{role:'quit'}]}]:[]),
  {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
  {label:'视图',submenu:[{role:'reload'},{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
  {label:'窗口',submenu:[{role:'minimize'},{role:'close'}]}
 ]));
 await window.loadURL(origin);
 service.on('exit',()=>{if(!quitting){dialog.showErrorBox('本机服务停止','请重新打开小舟。');app.quit();}});
}).catch(error=>{dialog.showErrorBox('小舟启动失败',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{
 if(quitting)return;event.preventDefault();quitting=true;
 (async()=>{
  try{if(origin){const {token}=await fetch(origin+'/api/session').then(r=>r.json());await fetch(origin+'/api/shutdown',{method:'POST',headers:{'Content-Type':'application/json','X-Study-Token':token},body:'{}',signal:AbortSignal.timeout(7000)});}}catch{}
  service?.kill();app.quit();
 })();
});
}
