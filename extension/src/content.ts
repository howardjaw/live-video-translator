import {clockAction} from './sync';
(()=>{
 const global=window as typeof window & {__translatorInstalled?:boolean};if(global.__translatorInstalled)return;global.__translatorInstalled=true;
 const videos=new Map<string,HTMLVideoElement>();let cleanup=()=>{};
 function detect(){return [...document.querySelectorAll('video')].map(v=>{
 let id=[...videos].find(([,x])=>x===v)?.[0];if(!id){id=crypto.randomUUID();videos.set(id,v);}
 const source=v.currentSrc||v.src;const captions:any[]=[];
 for(const track of [...v.textTracks]){if(track.cues?.length){for(const cue of [...track.cues]){const x=cue as VTTCue;captions.push({id:String(captions.length),start:x.startTime,end:x.endTime,source:x.text});}break;}}
 const supported=/^https:\/\//.test(source)&&!v.mediaKeys&&!/\.(m3u8|mpd)(\?|$)/i.test(source)&&Number.isFinite(v.duration)&&v.duration>0;
 return {id,source,duration:Number.isFinite(v.duration)?v.duration:0,captions,supported,title:v.getAttribute('aria-label')||document.title,reason:supported?'Direct HTTPS media candidate; acquisition must still succeed.':'Unsupported stream, protected media, local URL, or unknown duration. Supply a matching media file.'};});}
 chrome.runtime.onMessage.addListener((m,s,reply)=>{
 if(s.id!==chrome.runtime.id)return;
 if(m.type==='detect'){reply(detect());return;}
 if(m.type==='original'){cleanup();reply({});return;}
 if(m.type==='attach'){
 cleanup();const v=videos.get(m.id);
 if(!v?.isConnected||(v.currentSrc||v.src)!==m.source){reply({error:'Selected video changed. Translate again.'});return;}
 const original={muted:v.muted,volume:v.volume};const bytes=Uint8Array.from(atob(m.audio),x=>x.charCodeAt(0));
 const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));const audio=new Audio(url);audio.preload='auto';let active=false,buffering=false,maxDrift=0;
 const button=document.createElement('button');button.textContent='Play translated · click to enable audio';
 Object.assign(button.style,{position:'fixed',bottom:'24px',right:'24px',zIndex:'2147483647',padding:'14px',background:'#183c42',color:'white',borderRadius:'10px'});document.documentElement.append(button);
 const source=m.source;const events=['play','pause','seeking','seeked','ratechange','waiting','stalled','playing','ended','timeupdate'];
 const sync=()=>{
 if(!v.isConnected||(v.currentSrc||v.src)!==source){cleanup();return;}
 if(!active)return;
 const a=clockAction(v,audio.currentTime);audio.playbackRate=a.rate;
 if(a.pause||buffering){audio.pause();return;}
 const drift=Math.abs(a.time-audio.currentTime);maxDrift=Math.max(maxDrift,drift);
 if(a.seek)audio.currentTime=a.time;
 if(audio.paused)audio.play().catch(()=>{active=false;v.pause();v.muted=original.muted;button.hidden=false;button.textContent='Click to resume translated audio';});
 };
 const wait=()=>{buffering=true;audio.pause();};const resume=()=>{buffering=false;sync();};const stalled=()=>{if(v.readyState<3)wait();};v.addEventListener('waiting',wait);v.addEventListener('stalled',stalled);v.addEventListener('playing',resume);
 const interval=setInterval(sync,50);for(const event of events)v.addEventListener(event,sync);
 const seek=()=>{audio.pause();if(audio.readyState>=1)audio.currentTime=v.currentTime;};v.addEventListener('seeking',seek);
 button.onclick=()=>{
 if(audio.readyState<2){button.textContent='Loading translated audio…';return;}
 audio.currentTime=v.currentTime;audio.playbackRate=v.playbackRate;v.muted=true;active=true;
 Promise.all([audio.play(),v.play()]).then(()=>{button.hidden=true;}).catch(()=>{active=false;audio.pause();v.pause();v.muted=original.muted;button.textContent='Playback blocked — click to retry';});
 };
 audio.onerror=()=>{cleanup();};
 cleanup=()=>{active=false;audio.pause();audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);clearInterval(interval);for(const event of events)v.removeEventListener(event,sync);v.removeEventListener('seeking',seek);v.removeEventListener('waiting',wait);v.removeEventListener('stalled',stalled);v.removeEventListener('playing',resume);v.muted=original.muted;v.volume=original.volume;button.remove();cleanup=()=>{};};
 reply({message:'Click Play translated on the page to grant browser playback permission.'});
 }
 });
 window.addEventListener('pagehide',()=>cleanup());
})();
