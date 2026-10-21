import {homedir} from 'node:os';
import {join} from 'node:path';
export function defaultDataDir(platform=process.platform,env=process.env,home=homedir()){
  if(platform==='win32')return join(env.APPDATA||join(home,'AppData','Roaming'),'XiaozhouStudyAssistant');
  if(platform==='darwin')return join(home,'Library','Application Support','LocalStudyAssistant');
  return join(env.XDG_DATA_HOME||join(home,'.local','share'),'xiaozhou-study-assistant');
}
