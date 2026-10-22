// Snapshot-only bootstrap: capability errors must not leave an endless loading screen.
const status=document.querySelector('#status');
export function unavailable(message){
 document.body.dataset.runtime='unavailable';document.body.dataset.ready='false';
 status.setAttribute('role','alert');status.textContent=message;
 for(const button of document.querySelectorAll('button'))button.disabled=true;
 const guide=document.createElement('a');guide.href='../README.md';guide.textContent='Read setup, source and recorded previews';status.append(document.createElement('br'),guide);
}
try{
 const concept=new URLSearchParams(location.search).get('concept');
 if(concept&&concept!=='11')throw Error('This source snapshot includes Concept 11 only. Open directions.html?concept=11.');
 if(typeof DecompressionStream==='undefined')throw Error('This browser cannot decode the included gzip source assets. Use a current browser with DecompressionStream.');
 if(!globalThis.crypto?.subtle)throw Error('Source integrity checks require WebCrypto. Serve this folder on localhost or HTTPS.');
 if(typeof WebGL2RenderingContext==='undefined')throw Error('WebGL2 is unavailable. Enable browser graphics acceleration or use a supported browser.');
 const canvas=document.querySelector('#scene');
 const gl=canvas.getContext('webgl2',{alpha:true,antialias:true,powerPreference:'high-performance'});
 if(!gl)throw Error('A WebGL2 context could not be created. Enable graphics acceleration and reload.');
 if(!gl.getExtension('EXT_color_buffer_float')||!gl.getExtension('OES_texture_float_linear'))throw Error('This GPU cannot provide the floating-point render targets and filtering required by the native source volumes.');
 document.body.dataset.runtime='starting';
 await import('./directions.mjs');
 document.body.dataset.runtime='loaded';
}catch(error){unavailable(error?.message||String(error));}
