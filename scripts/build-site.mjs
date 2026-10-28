import { mkdir, cp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from './build.mjs';

const root = new URL('../', import.meta.url);
export async function buildSite() {
  await build();
  const output = new URL('_site/', root);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  for (const name of ['dist', 'testbed', 'examples', 'docs']) {
    await cp(new URL(`${name}/`, root), new URL(`${name}/`, output), { recursive: true });
  }
  await cp(new URL('site/', root), output, { recursive: true });
  await mkdir(new URL('test/', output));
  for (const name of ['browser.html', 'browser.mjs', 'particle-diagnostics.mjs']) {
    await cp(new URL(`test/${name}`, root), new URL(`test/${name}`, output));
  }
  await mkdir(new URL('vendor/box2d3-wasm/', output), { recursive: true });
  const box2d = new URL('node_modules/box2d3-wasm/', root);
  await cp(new URL('build/dist/es/', box2d), new URL('vendor/box2d3-wasm/build/dist/es/', output), { recursive: true });
  await cp(new URL('LICENSE', box2d), new URL('vendor/box2d3-wasm/LICENSE', output));
  await mkdir(new URL('vendor/tweakpane/',output),{recursive:true});
  await cp(new URL('node_modules/tweakpane/dist/tweakpane.min.js',root),new URL('vendor/tweakpane/tweakpane.min.js',output));
  for (const name of ['LICENSE', 'LICENSE-PBMPM.md', 'LICENSE-TWEAKPANE.md']) {
    await cp(new URL(name, root), new URL(name, output));
  }
  await writeFile(new URL('.nojekyll', output), '');
  // Keep module graphs and CSS coherent when an existing Pages visitor reloads
  // after a deployment, instead of mixing cached shaders with new bindings.
  const sources=[];
  const collect=async directory=>{
    for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
      const file=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
      if(entry.isDirectory()){if(entry.name!=='vendor')await collect(file);}
      else if(/\.(html|mjs|js|css)$/.test(entry.name))sources.push([file,await readFile(file,'utf8')]);
    }
  };
  await collect(output);
  const hash=createHash('sha256');for(const [file,source]of sources)hash.update(file.href.slice(output.href.length)).update(source);
  const revision=hash.digest('hex').slice(0,12);
  for(const [file,source]of sources){
    const versioned=source.replace(/(['"`])((?:\.\.?\/)[^'"`\s]+?\.(?:mjs|js|css))\1/g,(_,quote,url)=>`${quote}${url}?v=${revision}${quote}`);
    if(versioned!==source)await writeFile(file,versioned);
  }
  return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildSite(); console.log('Built GitHub Pages site in _site/.');
}
