import {defaults,stages,Config,Stage,backendURL,saveKeys,forgetKeys,loadKeys} from './settings';
const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
let config:Config=(await chrome.storage.local.get('config')).config as Config ||structuredClone(defaults);const keys=await loadKeys();
const descriptions={speech:'Converts source audio into timestamped text. Skipped when usable captions are present.',translation:'Translates text with surrounding context. Custom endpoints support text only.',tts:'Generates the complete spoken translation with one stock voice. Enter a voice ID available in your provider account.'};
for(const stage of stages){
 const section=document.createElement('section');section.innerHTML=`<h2>${stage==='tts'?'Text-to-speech':stage==='speech'?'Speech recognition':'Translation'}</h2><p>${descriptions[stage]}</p><label>Provider<select id="${stage}-provider"></select></label><label>Model<input id="${stage}-model" autocomplete="off"></label>${stage==='tts'?'<label>Stock voice ID<input id="tts-voice" autocomplete="off"></label>':''}<label>API key<input id="${stage}-key" type="password" autocomplete="off" spellcheck="false"></label><button id="${stage}-reveal" class="secondary">Reveal key</button><label>Reuse key from<select id="${stage}-reuse"><option value="">Separate key</option>${stages.filter(x=>x!==stage).map(x=>`<option>${x}</option>`).join('')}</select></label>${stage==='translation'?'<label>Custom HTTPS base URL (include /v1 when required)<input id="base" type="url"></label><label><input id="confirm" type="checkbox"> I confirm sending my translation key and text to this exact custom destination.</label>':''}<button id="${stage}-test" class="secondary">Save & test connection (may incur charges)</button>`;
 el('stages').append(section);
 const providers=stage==='tts'?['fish','elevenlabs','openai']:stage==='translation'?['openai','custom']:['openai'];
 for(const p of providers){const o=document.createElement('option');o.value=p;o.textContent=p;el<HTMLSelectElement>(stage+'-provider').append(o);}
 el<HTMLSelectElement>(stage+'-provider').value=config[stage].provider;el<HTMLInputElement>(stage+'-model').value=config[stage].model;el<HTMLInputElement>(stage+'-key').value=keys[stage]||'';el<HTMLSelectElement>(stage+'-reuse').value=config.reuse[stage];
 el(stage+'-provider').onchange=()=>{el<HTMLInputElement>(stage+'-key').value='';el<HTMLSelectElement>(stage+'-reuse').value='';if(stage==='translation')el<HTMLInputElement>('confirm').checked=false;};
 el(stage+'-reveal').onclick=()=>{const input=el<HTMLInputElement>(stage+'-key');input.type=input.type==='password'?'text':'password';};
 el(stage+'-test').onclick=()=>run(async()=>{await save();const r=await chrome.runtime.sendMessage({type:'test',stage});if(r.error)throw Error(r.error);return r.value.message;});
}
el<HTMLInputElement>('tts-voice').value=config.tts.voice;el<HTMLInputElement>('base').value=config.translation.base_url;el<HTMLInputElement>('confirm').checked=!!config.translation.confirmed_destination;el('base').oninput=()=>el<HTMLInputElement>('confirm').checked=false;
el<HTMLInputElement>('backend').value=config.backend;el<HTMLInputElement>('local').checked=config.localDevelopment;el<HTMLInputElement>('mock').checked=config.mock;el<HTMLInputElement>('remember').checked=!!(await chrome.storage.local.get('keys')).keys;
async function save(){
 const next=structuredClone(config);next.backend=el<HTMLInputElement>('backend').value.trim();next.localDevelopment=el<HTMLInputElement>('local').checked;next.mock=el<HTMLInputElement>('mock').checked;
 const base=backendURL(next);const granted=await chrome.permissions.request({origins:[base+'/*']});if(!granted)throw Error('Backend host permission is required.');
 const values:Record<string,string>={};for(const stage of stages){next[stage].provider=el<HTMLSelectElement>(stage+'-provider').value;next[stage].model=el<HTMLInputElement>(stage+'-model').value.trim();next.reuse[stage]=el<HTMLSelectElement>(stage+'-reuse').value;values[stage]=el<HTMLInputElement>(stage+'-key').value;}
 next.tts.voice=el<HTMLInputElement>('tts-voice').value.trim();next.translation.base_url=next.translation.provider==='custom'?el<HTMLInputElement>('base').value.trim().replace(/\/$/,''):'';
 next.translation.confirmed_destination=next.translation.base_url&&el<HTMLInputElement>('confirm').checked?next.translation.base_url:'';
 if(next.translation.base_url&&!next.translation.confirmed_destination)throw Error('Confirm the exact custom destination first.');
 await saveKeys(values,el<HTMLInputElement>('remember').checked);await chrome.storage.local.set({config:next});config=next;
}
async function run(fn:()=>Promise<string>){el('status').textContent='Working…';try{el('status').textContent=await fn();}catch(e){el('status').textContent=e instanceof Error?e.message:'Request failed.';}}
el('save').onclick=()=>run(async()=>{await save();return 'Settings saved.';});el('forget').onclick=()=>run(async()=>{await forgetKeys();for(const s of stages)el<HTMLInputElement>(s+'-key').value='';return 'Saved keys forgotten. Keys already submitted remain in memory until their running job finishes or is cancelled.';});
