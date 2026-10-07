// Shared browser-independent preflight. API presence alone is not GPU readiness.
export async function probeGpuSession(canvas,{gpu=globalThis.navigator?.gpu,secure=globalThis.isSecureContext}={}){
 const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
 if(secure===false)fail('insecure','WebGPU requires HTTPS or localhost. Open this viewer over a secure connection.');
 if(!gpu?.requestAdapter)fail('unsupported','WebGPU is unavailable in this browser/device. Use a browser with WebGPU enabled and hardware acceleration. This renderer does not yet have a WebGL or CPU fallback.');
 let adapter;
 try{adapter=await gpu.requestAdapter({powerPreference:'high-performance'});}catch{}
 if(!adapter){try{adapter=await gpu.requestAdapter();}catch{}}
 if(!adapter)fail('adapter-unavailable','No usable WebGPU adapter is available. Check hardware acceleration and GPU drivers, then restart the browser.');
 let context;
 try{context=canvas.getContext('webgpu');}catch{}
 if(!context)fail('context-unavailable','A GPU adapter exists, but this tab cannot create a WebGPU canvas context. Reload the tab or restart the browser.');
 let format;
 try{format=gpu.getPreferredCanvasFormat();}catch{}
 if(!format)fail('format-unavailable','The browser cannot provide a WebGPU canvas format. Restart or update the browser.');
 return {adapter,context,format};
}
