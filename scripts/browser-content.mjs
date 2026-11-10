// Fallback functional harness: real content bundle and media clocks, Chrome messaging stubbed.
import {chromium} from 'playwright';import assert from 'node:assert/strict';
const base='http://localhost:8000';
const settings={mock:true,speech:{provider:'openai',model:'whisper-1'},translation:{provider:'openai',model:'gpt-4o-mini'},tts:{provider:'fish',model:'s2.1-pro',voice:'fixture'}};
const form=new FormData();form.append('payload',JSON.stringify({settings,fixture:true,duration:8}));
const created=await fetch(base+'/jobs',{method:'POST',body:form});assert.ok(created.ok);const job=await created.json();
let status;for(let i=0;i<90;i++){status=await (await fetch(base+'/jobs/'+job.id)).json();if(['ready','failed'].includes(status.status))break;await new Promise(r=>setTimeout(r,300));}assert.equal(status.status,'ready');
const audio=Buffer.from(await (await fetch(base+'/jobs/'+job.id+'/audio')).arrayBuffer()).toString('base64');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.goto(base+'/demo/');await page.waitForFunction(()=>document.querySelector('video').readyState>=3);
 await page.evaluate(()=>{window.__audio=[];const Native=Audio;window.Audio=function(...args){const a=new Native(...args);window.__audio.push(a);return a;};window.chrome={runtime:{id:'test',onMessage:{addListener(fn){window.__message=fn;}}}};});
 await page.addScriptTag({path:'dist/content.js'});
 const send=(message)=>page.evaluate(message=>new Promise(resolve=>window.__message(message,{id:'test'},resolve)),message);
 const [video]=await send({type:'detect'});assert.equal(video.duration,8);
 await send({type:'attach',id:video.id,source:video.source,audio});await page.waitForFunction(()=>window.__audio.at(-1).readyState>=2);await page.getByRole('button',{name:'Play translated · click to enable audio'}).click();
 const clocks=()=>page.evaluate(()=>{const v=document.querySelector('video'),a=window.__audio.at(-1);return {v:v.currentTime,a:a.currentTime,paused:a.paused,rate:a.playbackRate,muted:v.muted};});
 await page.waitForTimeout(300);assert.equal((await clocks()).muted,true);
 await page.evaluate(()=>document.querySelector('video').pause());await page.waitForTimeout(100);assert.equal((await clocks()).paused,true);
 await page.evaluate(()=>document.querySelector('video').play());
 const samples=[];
 for(const rate of [.75,1,1.5]){await page.evaluate(rate=>{const v=document.querySelector('video');v.currentTime=1;v.playbackRate=rate;},rate);await page.waitForTimeout(300);for(let i=0;i<10;i++){const c=await clocks();assert.equal(c.rate,rate);samples.push(Math.abs(c.v-c.a));await page.waitForTimeout(60);}}
 for(const time of [6,1]){await page.evaluate(time=>document.querySelector('video').currentTime=time,time);await page.waitForTimeout(300);const c=await clocks();assert.ok(Math.abs(c.v-c.a)<.15);}
 await page.evaluate(()=>document.querySelector('video').dispatchEvent(new Event('waiting')));assert.equal((await clocks()).paused,true);
 await send({type:'original'});assert.equal((await clocks()).muted,false);assert.equal((await clocks()).paused,true);
 await send({type:'attach',id:video.id,source:video.source,audio});await page.waitForFunction(()=>window.__audio.at(-1).readyState>=2);await page.getByRole('button',{name:'Play translated · click to enable audio'}).click();
 await page.getByRole('button',{name:'Replace source'}).click();await page.waitForTimeout(150);assert.equal((await clocks()).paused,true);assert.equal((await clocks()).muted,false);
 const stale=await send({type:'attach',id:video.id,source:video.source,audio});assert.ok(stale.error);
 assert.ok(Math.max(...samples)<.15);console.log(JSON.stringify({result:'passed',mode:'real Chromium media + built content script, mocked Chrome messaging',samples:samples.length,maxDriftSeconds:Math.max(...samples),mockPipeline:true,checks:['complete processing','play','pause/resume','forward/backward seek','0.75x/1x/1.5x','synthetic waiting event','original audio','source replacement','stale job rejection'],notValidated:['extension installation/UI lifecycle','real network buffering','paid providers']},null,2));
}finally{await browser.close();}
