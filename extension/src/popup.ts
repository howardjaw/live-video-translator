const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const [tab]=await chrome.tabs.query({active:true,currentWindow:true});let videos:any[]=[];
async function send(type:string,data={}){const r=await chrome.runtime.sendMessage({type,tab:tab.id,...data});if(r.error)throw Error(r.error);return r.value;}
async function run(fn:()=>Promise<void>){try{await fn();}catch(e){el('status').textContent=e instanceof Error?e.message:'Request failed.';}}
el('settings').onclick=()=>chrome.runtime.openOptionsPage();
await run(async()=>{videos=await send('detect');for(const [i,v] of videos.entries()){const o=document.createElement('option');o.value=String(i);o.textContent=`${i+1}. ${v.title} (${Math.round(v.duration)}s)`;el('video').append(o);}el('status').textContent=videos.length?'Video selected':'No video detected.';describe();});
function selected(){return videos[Number(el<HTMLSelectElement>('video').value)];}
function describe(){el('source').textContent=selected()?.reason||'';}
el('video').onchange=describe;
el('start').onclick=()=>run(async()=>{
 const video=selected();if(!video)throw Error('No video detected.');const f=el<HTMLInputElement>('file').files?.[0];if(f&&f.size>50*1024*1024)throw Error('File exceeds 50 MB.');
 const config=(await chrome.storage.local.get('config')).config as {mock:boolean}|undefined;const fixture=config?.mock&&video.source==='http://localhost:8000/demo/sample.mp4';
 if(!video.supported&&!f&&!fixture)throw Error(video.reason);
 let file:string|undefined;if(f){const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));file=btoa(binary);}
 await send('start',{video,file,fileConfirmed:el<HTMLInputElement>('confirmed').checked,fixture,language:el<HTMLSelectElement>('language').value});await poll();
});
async function poll(){const j=await send('status');if(!j)return;el('status').textContent=(j.mock?'MOCK · ':'')+(j.status==='ready'?'Translation ready':j.status)+(j.error?' — '+j.error:'')+(j.total?` · ${j.completed}/${j.total} segments`:'');el('play').hidden=j.status!=='ready';el('start').textContent=j.status==='failed'?'Retry translation':'Translate video';}
el('play').onclick=()=>run(async()=>{const r=await send('play');if(r?.error)throw Error(r.error);el('status').textContent=r.message;});el('cancel').onclick=()=>run(async()=>{await send('cancel');await poll();});el('original').onclick=()=>run(async()=>{await send('original');});
setInterval(()=>run(poll),1200);await run(poll);
export {};
