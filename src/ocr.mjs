import {createWorker} from 'tesseract.js';
import {createRequire} from 'node:module';
import {copyFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
export async function createOfflineOCR(dataDir=join(tmpdir(),'xiaozhou-ocr')){
  await mkdir(dataDir,{recursive:true,mode:0o700});
  await Promise.all(['chi_sim','eng'].map(async code=>{
    const {langPath}=require('@tesseract.js-data/'+code);
    await copyFile(join(langPath,code+'.traineddata.gz'),join(dataDir,code+'.traineddata.gz'));
  }));
  return createWorker(['chi_sim','eng'],1,{langPath:dataDir,cacheMethod:'none',errorHandler:()=>{}});
}
