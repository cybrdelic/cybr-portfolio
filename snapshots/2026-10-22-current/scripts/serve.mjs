import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {dirname,resolve,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.flac':'audio/flac','.mp4':'video/mp4','.md':'text/plain; charset=utf-8'};
export async function startServer(port=0){
 const server=http.createServer(async(req,res)=>{
  try{
   const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const target=resolve(root,'.'+(pathname==='/'?'/portfolio/directions.html':pathname));
   if(!target.startsWith(root+sep)){res.writeHead(403).end();return;}
   const info=await stat(target);if(!info.isFile())throw Error('not a file');
   res.writeHead(200,{'Content-Type':types[extname(target)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':'no-cache'});
   if(req.method==='HEAD')res.end();else createReadStream(target).pipe(res);
  }catch{res.writeHead(404).end('Not included in this snapshot');}
 });
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return {server,url:`http://127.0.0.1:${server.address().port}`};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const {url}=await startServer(Number(process.env.PORT||4187));console.log(`${url}/portfolio/directions.html?concept=11`);
}
