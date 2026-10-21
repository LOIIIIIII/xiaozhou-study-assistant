import {mkdir,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const browsers=resolve('.vendor/browsers');await mkdir('.vendor/native',{recursive:true});
await import('./icon.mjs');
function run(command,args,env=process.env){return new Promise((resolve,reject)=>{const p=spawn(command,args,{stdio:'inherit',env});p.once('error',reject);p.once('exit',code=>code===0?resolve():reject(new Error(command+' failed: '+code)));});}
await run(process.execPath,['node_modules/playwright/cli.js','install','chromium','--no-shell'],{...process.env,PLAYWRIGHT_BROWSERS_PATH:browsers});
if(process.platform==='darwin')await run('swiftc',['tools/ocr.swift','-O','-o','.vendor/native/ocr']);
await access(browsers);console.log('已准备桌面版浏览器资源；不含本机账号或配置。');
