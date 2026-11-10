import {chromium} from 'playwright';import {mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const temp=await mkdtemp(path.join(tmpdir(),'translator-'));const ext=path.join(temp,'extension');await cp('dist',ext,{recursive:true});
const manifest=JSON.parse(await readFile(ext+'/manifest.json','utf8'));manifest.host_permissions=['http://localhost/*'];await writeFile(ext+'/manifest.json',JSON.stringify(manifest));
const context=await chromium.launchPersistentContext(temp+'/profile',{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging','--no-sandbox','--disable-extensions-except='+ext,'--load-extension='+ext]});
try{
 if(!context.serviceWorkers().length){const session=await context.newCDPSession(context.pages()[0]);try{await session.send('Extensions.loadUnpacked',{path:ext});}catch(e){console.log('Extension load:',e.message);}}
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 const demo=await context.newPage();await demo.goto('http://localhost:8000/demo/');await demo.waitForFunction(()=>document.querySelector('video').readyState>=2);
 const ui=await context.newPage();await ui.goto(`chrome-extension://${id}/settings.html`);await ui.locator('#mock').check();await ui.locator('#speech-key').fill('browser-session-sentinel');await ui.locator('#save').click();await ui.waitForFunction(()=>document.querySelector('#status').textContent==='Settings saved.');
 assert.equal(await ui.evaluate(async()=>!!(await chrome.storage.session.get('keys')).keys),true);
 assert.equal(await ui.evaluate(async()=>!!(await chrome.storage.local.get('keys')).keys),false);
 await ui.locator('#forget').click();await ui.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Saved keys forgotten'));
 const tab=await ui.evaluate(async()=> (await chrome.tabs.query({url:'http://localhost:8000/demo/'}))[0].id);
 const send=async(type,data={})=>ui.evaluate(async({type,data,tab})=>{const r=await chrome.runtime.sendMessage({type,tab,...data});if(r.error)throw Error(r.error);return r.value;},{type,data,tab});
 const videos=await send('detect');assert.equal(videos.length,1);
 const job=await send('start',{video:videos[0],fixture:true,language:'Simplified Chinese'});
 // Closing the settings UI does not own or cancel the backend task.
 await ui.goto('about:blank');await ui.goto(`chrome-extension://${id}/settings.html`);
 let result;for(let i=0;i<90;i++){result=await send('status');if(['ready','failed'].includes(result.status))break;await new Promise(r=>setTimeout(r,500));}
 assert.equal(result.status,'ready',JSON.stringify(result));assert.equal(result.mock,true);
 // Capture the real Audio instance only in the test harness for drift measurement.
 await demo.evaluate(()=>{window.__audio=[];const Native=window.Audio;window.Audio=function(...args){const a=new Native(...args);window.__audio.push(a);return a;};});
 // Isolated content scripts have their own Audio constructor; instrument that world through scripting.
 await ui.evaluate(async tab=>{await chrome.scripting.executeScript({target:{tabId:tab},func:()=>{globalThis.__testAudio=[];const Native=Audio;globalThis.Audio=function(...args){const a=new Native(...args);globalThis.__testAudio.push(a);return a;};}});},tab);
 await send('play');await demo.waitForTimeout(300);await demo.getByRole('button',{name:'Play translated · click to enable audio'}).click();
 const clocks=()=>ui.evaluate(async tab=>(await chrome.scripting.executeScript({target:{tabId:tab},func:()=>{const v=document.querySelector('video'),a=globalThis.__testAudio.at(-1);return {v:v.currentTime,a:a.currentTime,paused:a.paused,muted:v.muted,rate:a.playbackRate};}}))[0].result,tab);
 await demo.waitForTimeout(400);assert.equal((await clocks()).muted,true);
 await demo.evaluate(()=>document.querySelector('video').pause());await demo.waitForTimeout(100);assert.equal((await clocks()).paused,true);
 await demo.evaluate(()=>document.querySelector('video').play());await demo.waitForTimeout(200);
 const samples=[];
 for(const rate of [.75,1,1.5]){
  await demo.evaluate(rate=>{const v=document.querySelector('video');v.currentTime=2;v.playbackRate=rate;},rate);await demo.waitForTimeout(300);
  for(let i=0;i<10;i++){const c=await clocks();samples.push(Math.abs(c.v-c.a));assert.equal(c.rate,rate);await demo.waitForTimeout(60);}
 }
 for(const time of [6,1]){await demo.evaluate(time=>document.querySelector('video').currentTime=time,time);await demo.waitForTimeout(250);const c=await clocks();assert.ok(Math.abs(c.v-c.a)<.15);}
 await send('original');assert.equal(await demo.evaluate(()=>document.querySelector('video').muted),false);
 await send('play');await demo.waitForTimeout(200);await demo.getByRole('button',{name:'Play translated · click to enable audio'}).click();
 await demo.getByRole('button',{name:'Replace source'}).click();await demo.waitForTimeout(200);assert.equal((await clocks()).paused,true);
 assert.ok(Math.max(...samples)<.15,'drift '+Math.max(...samples));
 console.log(JSON.stringify({result:'passed',mock:true,job:job.id,driftSamples:samples.length,maxDriftSeconds:Math.max(...samples),checks:['session storage','forget keys','processing','UI reopen','play','pause/resume','seek forward/backward','0.75x/1x/1.5x','original audio','source replacement'],unrun:['real providers','real network buffering']},null,2));
}finally{await context.close();await rm(temp,{recursive:true,force:true});}
