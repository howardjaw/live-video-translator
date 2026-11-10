import {defaults, backendURL,loadKeys,resolveKeys,Config} from './settings';
chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
async function config():Promise<Config>{return (await chrome.storage.local.get('config')).config as Config ||structuredClone(defaults);}
async function api(base:string,path:string,init?:RequestInit){
 const r=await fetch(base+path,{...init,redirect:'error'});
 if(!r.ok){let message='Backend request failed.';try{const j=await r.json();if(typeof j.detail==='string')message=j.detail;}catch{}throw Error(message);}
 return r;
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 // Only extension pages can access orchestration or credentials.
 if(sender.id!==chrome.runtime.id||!sender.url?.startsWith(chrome.runtime.getURL('')))return;
 (async()=>{
 const c=await config(),base=backendURL(c);
 const stateKey='job:'+message.tab;
 if(message.type==='detect'){
   await chrome.scripting.executeScript({target:{tabId:message.tab},files:['content.js']});
   return chrome.tabs.sendMessage(message.tab,{type:'detect'});
 }
 if(message.type==='test'){
   return (await api(base,'/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings:c,credentials:resolveKeys(c,await loadKeys()),stage:message.stage})})).json();
 }
 if(message.type==='start'){
   const payload={settings:c,credentials:resolveKeys(c,await loadKeys()),source:message.video.source,duration:message.video.duration,captions:message.video.captions,fixture:message.fixture&&c.mock,language:message.language,file_confirmed:message.fileConfirmed};
   const form=new FormData();form.append('payload',JSON.stringify(payload));
   if(message.file){const bytes=Uint8Array.from(atob(message.file),x=>x.charCodeAt(0));form.append('file',new Blob([bytes]),'source');}
   const job=await (await api(base,'/jobs',{method:'POST',body:form})).json();
   await chrome.storage.local.set({[stateKey]:{id:job.id,base,video:message.video.id,source:message.video.source}});return job;
 }
 const state=(await chrome.storage.local.get(stateKey))[stateKey] as {id:string;base:string;video:string;source:string}|undefined;
 if(message.type==='status')return state?(await api(state.base,'/jobs/'+state.id)).json():null;
 if(message.type==='cancel'){if(state)await api(state.base,'/jobs/'+state.id+'/cancel',{method:'POST'});return {};}
 if(message.type==='original')return chrome.tabs.sendMessage(message.tab,{type:'original'});
 if(message.type==='play'){
   if(!state)throw Error('No translation job.');
   const r=await api(state.base,'/jobs/'+state.id+'/audio');const bytes=new Uint8Array(await r.arrayBuffer());
   let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   return chrome.tabs.sendMessage(message.tab,{type:'attach',id:state.video,source:state.source,audio:btoa(binary)});
 }
 throw Error('Unknown request.');
 })().then(value=>reply({value})).catch(e=>reply({error:e instanceof Error?e.message:'Request failed.'}));
 return true;
});
