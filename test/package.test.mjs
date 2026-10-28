import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ShaderLibrary } from '../dist/gpu.mjs';

const root = fileURLToPath(new URL('../',import.meta.url));
test('packaged WGSL matches source expansion without fetching shader assets',async()=>{
  const packaged = new ShaderLibrary(), reference = new ShaderLibrary(new URL('../shaders/',import.meta.url));
  const names = (await readdir(new URL('../shaders/',import.meta.url))).filter(n=>n.endsWith('.wgsl'));
  for(const name of names) reference.sources.set(name.slice(0,-5),await readFile(new URL(`../shaders/${name}`,import.meta.url),'utf8'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ()=>{throw new Error('Packaged shaders must not fetch files');};
  try {
    for(const name of names){
      const key=name.slice(0,-5), source=await packaged.source(key);
      assert.equal(source,await reference.source(key),`Embedded ${key} is stale`);
      assert(!source.includes('//!include')&&!source.includes('//!insert'),`${key} was not expanded`);
    }
  } finally { globalThis.fetch=originalFetch; }
});
test('a packed package imports outside the repository without its demos or source tree',async()=>{
  const directory = await mkdtemp(path.join(tmpdir(),'smoosh-package-'));
  try {
    const output = execFileSync('npm',['pack','--ignore-scripts','--offline','--json','--pack-destination',directory,'--cache',path.join(directory,'cache')],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
    const [manifest] = JSON.parse(output), names=manifest.files.map(f=>f.path);
    for(const name of ['dist/index.mjs','dist/index.d.ts','dist/shader-sources.mjs','dist/box2d.mjs','dist/domain.mjs','LICENSE','LICENSE-PBMPM.md']) assert(names.includes(name),`Missing ${name}`);
    assert(!names.some(name=>/^(testbed|test|node_modules|src)\//.test(name)),'Runtime package includes development files');
    execFileSync('tar',['-xzf',path.join(directory,manifest.filename),'-C',directory]);
    const entry=pathToFileURL(path.join(directory,'package/dist/index.mjs')).href;
    const code=`const {Smoosh,SimulationDomain,DomainWalls}=await import(${JSON.stringify(entry)});const d=new SimulationDomain();d.addArea('a',{x:1,y:1,width:3,height:3});if(!d.contains(2,2)||typeof Smoosh.create!=='function'||typeof DomainWalls!=='function')process.exit(1);`;
    execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:directory});
  } finally { await rm(directory,{recursive:true,force:true}); }
});
