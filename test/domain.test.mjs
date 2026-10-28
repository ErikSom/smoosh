import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationDomain } from '../src/index.mjs';
import { region, contains } from '../src/domain.mjs';

function distance(d, x, y) {
  d.compile(); const [gx, gy] = d.toGrid(x,y);
  return d.field[(Math.round(gy) * d.gridWidth + Math.round(gx)) * 4 + 2];
}
test('overlapping areas form one union without an internal wall', () => {
  const d = new SimulationDomain({ width: 10, height: 6, cellSize: 0.1 });
  d.addArea('a', { x: 1, y: 1, width: 5, height: 4 });
  d.addArea('b', { x: 4, y: 1, width: 5, height: 4 });
  assert(d.contains(5,3)); assert(distance(d, 5,3) > 15);
  assert(distance(d, 0,3) < 0);
});
test('touching areas have no zero-distance seam', () => {
  const d = new SimulationDomain({ width: 10, height: 6, cellSize: 0.1 });
  d.addArea('a', { x: 1, y: 1, width: 4, height: 4 });
  d.addArea('b', { x: 5, y: 1, width: 4, height: 4 });
  assert(distance(d, 5,3) > 15);
});
test('a channel is an ordinary editable area between separate basins', () => {
  const d = new SimulationDomain({ width: 12, height: 8, cellSize: 0.1 });
  d.addArea('a', { x: 1, y: 2, width: 3, height: 4 });
  d.addArea('b', { x: 8, y: 2, width: 3, height: 4 });
  assert(!d.contains(6,4)); assert(distance(d,6,4) < 0);
  const closed = d.compile();
  d.addArea('channel', { x: 3, y: 3.5, width: 6, height: 1 });
  assert(d.contains(6,4)); assert(distance(d,6,4) > 3);
  assert.notEqual(d.compile(),closed);
  d.updateArea('channel', { enabled: false });
  assert(!d.contains(6,4)); assert(distance(d,6,4) < 0);
  d.updateArea('channel', { enabled: true, y: 6 });
  assert(!d.contains(6,4)); assert(d.contains(6,6.5));
  d.updateArea('channel', { y: 3.5 });
  d.removeArea('a');
  assert(d.contains(6,4),'Removing one area changed another area');
  d.removeArea('channel');
  assert(!d.contains(6,4)); assert(distance(d,6,4) < 0);
  assert(d.contains(9,4)); assert.equal(d.areas.size,1);
});
test('circle geometry, coordinate conversion, cache invalidation and empty domains', () => {
  const d = new SimulationDomain({ width: 8,height: 8,cellSize: 0.1,origin:[100,-20] });
  assert(distance(d,104,-16)<0);
  d.addArea('circle',{type:'circle',x:104,y:-16,radius:2});
  assert(d.contains(104,-16)); assert(!d.contains(107,-16)); assert(distance(d,104,-16)>15);
  const p=d.toGrid(103.3,-14.7), q=d.toWorld(...p);
  assert(Math.abs(q[0]-103.3)<1e-10);assert(Math.abs(q[1]+14.7)<1e-10);
  const first=d.compile();assert.equal(d.compile(),first);
  d.updateArea('circle',{radius:1});assert.notEqual(d.compile(),first);
});
test('invalid domains and geometry fail before allocating GPU resources', () => {
  assert.throws(()=>new SimulationDomain({cellSize:0}),RangeError);
  assert.throws(()=>new SimulationDomain({cellSize:NaN}),TypeError);
  const d=new SimulationDomain();assert.throws(()=>d.addArea('x',{x:0,y:0,width:-1,height:2}),RangeError);
  d.addArea('a',{x:0,y:0,width:1,height:1});assert.throws(()=>d.addArea('a',{x:1,y:1,width:1,height:1}));
  assert.throws(()=>d.updateArea('missing',{enabled:false}));
});
test('concave polygons rasterize their actual outline and validate vertices',()=>{
  const shape=region({type:'polygon',points:[[1,1],[5,1],[5,2],[2,2],[2,5],[1,5]]});
  assert(contains(shape,1.5,4));assert(contains(shape,4,1.5));assert(!contains(shape,4,4));assert(contains(shape,1,2));
  const d=new SimulationDomain({width:8,height:8,cellSize:0.1});d.addArea('l',shape);
  assert(distance(d,1.5,4)>0);assert(distance(d,4,4)<0);
  assert.throws(()=>region({type:'polygon',points:[[0,0],[1,1],[2,2]]}));
  assert.throws(()=>region({type:'polygon',points:[[0,0],[1,1],[NaN,2]]}));
});
