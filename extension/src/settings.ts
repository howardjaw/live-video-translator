export const stages = ['speech','translation','tts'] as const;
export type Stage = typeof stages[number];
export type Selection = {provider:string; model:string; voice:string; base_url:string; confirmed_destination:string};
export type Config = {backend:string;localDevelopment:boolean;mock:boolean;speech:Selection;translation:Selection;tts:Selection;reuse:Record<Stage,string>};
export const defaults:Config={backend:'http://localhost:8000',localDevelopment:true,mock:false,speech:{provider:'openai',model:'whisper-1',voice:'',base_url:'',confirmed_destination:''},translation:{provider:'openai',model:'gpt-4o-mini',voice:'',base_url:'',confirmed_destination:''},tts:{provider:'fish',model:'s2.1-pro',voice:'',base_url:'',confirmed_destination:''},reuse:{speech:'',translation:'',tts:''}};
export function backendURL(config:Config){
 const u=new URL(config.backend);
 if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Backend must be an origin without a path, query, or credentials.');
 if(u.protocol!=='https:'&&!(config.localDevelopment&&u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('Remote backends require HTTPS. HTTP is allowed only for explicit local development.');
 return u.origin;
}
export function resolveKeys(config:Config,keys:Record<string,string>){
 const result:Record<string,string>={};
 for(const stage of stages){const from=config.reuse[stage]||stage;if(!stages.includes(from as Stage)||config[from as Stage].provider!==config[stage].provider)throw Error('Keys can only be reused for the same provider.');
 if(config[stage].provider==='custom'&&from!==stage)throw Error('Custom endpoint keys cannot be shared.');result[stage]=keys[from]||'';}
 return result;
}
export async function saveKeys(keys:Record<string,string>,remember:boolean){
 await chrome.storage.local.remove('keys');await chrome.storage.session.remove('keys');
 await (remember?chrome.storage.local:chrome.storage.session).set({keys});
}
export async function forgetKeys(){await chrome.storage.local.remove('keys');await chrome.storage.session.remove('keys');}
export async function loadKeys():Promise<Record<string,string>>{return ((await chrome.storage.session.get('keys')).keys||(await chrome.storage.local.get('keys')).keys||{}) as Record<string,string>;}
