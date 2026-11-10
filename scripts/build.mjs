import {build} from 'esbuild';import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});for(const file of ['manifest.json','popup.html','settings.html','style.css'])await copyFile('extension/'+file,'dist/'+file);
await build({entryPoints:['extension/src/background.ts','extension/src/popup.ts','extension/src/settings-ui.ts'],outdir:'dist',bundle:true,format:'esm',target:'chrome120'});
await build({entryPoints:['extension/src/content.ts'],outdir:'dist',bundle:true,format:'iife',target:'chrome120'});
