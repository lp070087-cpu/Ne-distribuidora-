import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import handler from '../api/portal.js';
const root=resolve('dist');
const origin='http://localhost:4176';
const rewrites=new Map([['/','/index.html'],['/minha-conta','/minha-conta.html'],['/ofertas','/ofertas.html'],['/estoque','/estoque-inteligente-v3.html'],['/vendedor','/painel-vendedores.html']]);
const media={html:'text/html; charset=utf-8',css:'text/css',js:'text/javascript',png:'image/png',webp:'image/webp',svg:'image/svg+xml'};
createServer(async (req,res)=>{
  try {
    const url=new URL(req.url,origin);
    if (url.pathname==='/api/portal') {
      const response=await handler(new Request(url,{method:req.method,headers:req.headers,
        ...(req.method==='POST'?{body:Readable.toWeb(req),duplex:'half'}:{})}));
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }
    const path=resolve(root,'.'+decodeURIComponent(rewrites.get(url.pathname)||url.pathname));
    if (!path.startsWith(root+sep) || !(await stat(path)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200,{'Content-Type':media[path.split('.').at(-1)]||'application/octet-stream'});
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
}).listen(4176);
