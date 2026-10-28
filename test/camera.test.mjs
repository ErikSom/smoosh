import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera2D } from '../testbed/camera.mjs';
import { SimulationDomain } from '../src/index.mjs';

test('fullscreen camera preserves aspect ratio, pointer coordinates and pinch anchor',()=>{
  const domain=new SimulationDomain({width:32,height:20,origin:[-4,3]});
  const camera=new Camera2D();camera.reset(domain);camera.resize(780,1688);
  const center=camera.screen(12,13);assert.equal(center.x,390);assert.equal(center.y,844);
  const x=camera.screen(13,13),y=camera.screen(12,14);
  assert.equal(x.x-center.x,center.y-y.y,'World axes have different screen scales');
  const anchor=camera.world(210,960);camera.zoomAt(2,210,960);
  assert(Math.abs(camera.world(210,960).x-anchor.x)<1e-10);
  assert(Math.abs(camera.world(210,960).y-anchor.y)<1e-10);
  camera.pan(40,-20);const point=camera.screen(5,8),roundtrip=camera.world(point.x,point.y);
  assert(Math.abs(roundtrip.x-5)<1e-10&&Math.abs(roundtrip.y-8)<1e-10);
});

test('cached domain contour includes the channel area and updates when it is disabled',()=>{
  const d=new SimulationDomain();d.addArea('upper',{x:2,y:8,width:10,height:10});d.addArea('lower',{x:15,y:2,width:15,height:11});d.addArea('channel',{x:10.5,y:8,width:5.5,height:2});
  const edges=d.boundarySegments();assert.equal(d.boundarySegments(),edges);
  const crossesGap=()=>{const e=d.boundarySegments();for(let i=0;i<e.length;i+=4)if(e[i+1]===e[i+3]&&Math.min(e[i],e[i+2])<14&&Math.max(e[i],e[i+2])>13)return true;return false;};
  assert(crossesGap(),'The corridor edge is missing');
  d.updateArea('channel',{enabled:false});assert(!crossesGap(),'Closed corridor remains in the outline');assert.notEqual(d.boundarySegments(),edges);
});
