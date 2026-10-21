import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultDataDir} from '../src/platform.mjs';
import {join} from 'node:path';
test('各平台使用自己的用户数据目录，不依赖开发机路径',()=>{
 assert.ok(defaultDataDir('darwin',{},'/user').includes('Library'));
 assert.equal(defaultDataDir('win32',{APPDATA:'/appdata'},'/user'),join('/appdata','XiaozhouStudyAssistant'));
 assert.equal(defaultDataDir('linux',{XDG_DATA_HOME:'/xdg'},'/user'),join('/xdg','xiaozhou-study-assistant'));
});
