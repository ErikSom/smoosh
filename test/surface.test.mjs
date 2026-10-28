import test from 'node:test';
import assert from 'node:assert/strict';
import { writeSurfaceScissor } from '../src/renderer.mjs';
import { Camera2D } from '../testbed/camera.mjs';
import { SimulationDomain } from '../src/domain.mjs';

test('surface shading bounds preserve the full world and splat margin while skipping letterbox pixels',()=>{
  const out=new Uint32Array(4),camera=new Camera2D(),domain=new SimulationDomain();
  camera.reset(domain);camera.resize(780,1688);
  writeSurfaceScissor(out,780,1688,256,160,camera.transform);
  assert(out[2]*out[3]<780*1688*0.4,'Portrait view still shades the empty screen');
  for(const [x,y]of [[0,0],[0,20],[32,0],[32,20]]){
    const p=camera.screen(x,y);assert(p.x>=out[0]&&p.x<=out[0]+out[2]&&p.y>=out[1]&&p.y<=out[1]+out[3],'Domain edge is clipped');
  }
  writeSurfaceScissor(out,780,1688,256,160,[1,1,0,0]);assert.deepEqual([...out],[0,0,780,1688]);
  writeSurfaceScissor(out,780,1688,256,160,[1,1,4,0]);assert.equal(out[2],0,'Offscreen world still draws a surface');
  writeSurfaceScissor(out,780,1688,256,160,[3,3,0,0]);assert.deepEqual([...out],[0,0,780,1688]);
});
