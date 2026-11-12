import { cp, mkdir, readdir } from 'node:fs/promises';
const pages = new Set(['index.html','ofertas.html','minha-conta.html','loja-revendedores-v2.html',
  'loja-revendedores.html','distribuidora.html','painel-vendedores.html','estoque-inteligente-v2.html',
  'estoque-inteligente-v3.html','apresentacao-maxdistrib.html','apresentacao-projeto-inteligente.html']);
await mkdir('dist',{recursive:true});
const present = await readdir('.');
for (const name of [...pages,'assets','Public']) {
  if (present.includes(name)) await cp(name,'dist/'+name,{recursive:true});
}
