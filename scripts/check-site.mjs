import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root=new URL('../_site/',import.meta.url), failures=[];
async function check(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const file=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
    if(entry.isDirectory()){await check(file);continue;}
    if(!entry.name.endsWith('.html'))continue;
    const source=await readFile(file,'utf8');
    for(const [,value]of source.matchAll(/(?:href|src)="([^"]+)"/g)){
      if(/^(https?:|data:|#)/.test(value))continue;
      const target=new URL(value,file);target.search='';target.hash='';
      if(!target.href.startsWith(root.href)){failures.push(`${file.pathname}: outside site ${value}`);continue;}
      try{const info=await stat(target);if(info.isDirectory())await stat(new URL('index.html',target));}
      catch{failures.push(`${file.pathname}: missing ${value}`);}
    }
    if(!source.includes('name="viewport"'))failures.push(`${file.pathname}: missing mobile viewport`);
  }
}
await check(root);
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
else console.log(`Static links and mobile viewport tags checked in ${fileURLToPath(root)}`);
