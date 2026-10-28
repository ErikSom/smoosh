import test from 'node:test';
import assert from 'node:assert/strict';
import Factory from '../node_modules/box2d3-wasm/build/dist/es/compat/Box2D.compat.mjs';
import { SimulationDomain, DomainWalls } from '../dist/index.mjs';

const B = await Factory();
test('managed Box2D walls follow the area union and preserve caller-owned bodies', () => {
  const wd = B.b2DefaultWorldDef(), world = B.b2CreateWorld(wd); wd.delete();
  const bd = B.b2DefaultBodyDef(), other = B.b2CreateBody(world, bd); bd.delete();
  const domain = new SimulationDomain({width:12,height:8,cellSize:0.25});
  domain.addArea('a',{x:1,y:1,width:5,height:5});
  domain.addArea('b',{x:4,y:1,width:5,height:5});
  const walls = new DomainWalls(B, world, domain);
  try {
    assert.equal(B.b2Body_GetShapeCount(walls.body),4,'Overlap created an internal wall');
    const first = walls.body;
    assert.equal(walls.sync(),first,'Unchanged domain allocated a new body');
    domain.updateArea('b',{width:6}); walls.sync();
    assert(!B.b2Body_IsValid(first),'Old walls survived a domain edit');
    assert(B.b2Body_IsValid(walls.body));
    assert(B.b2Body_IsValid(other));
    const current = walls.body; walls.destroy(); walls.destroy();
    assert(!B.b2Body_IsValid(current));
    assert(B.b2Body_IsValid(other),'Wall cleanup destroyed a caller-owned body');
    assert.throws(()=>walls.sync(),/destroyed/);
  } finally { walls.destroy(); B.b2DestroyWorld(world); }
});

test('channel areas open and close shared Box2D walls', () => {
  const wd = B.b2DefaultWorldDef(), world = B.b2CreateWorld(wd); wd.delete();
  const domain = new SimulationDomain({width:12,height:8,cellSize:0.25});
  domain.addArea('left',{x:1,y:2,width:3,height:4});
  domain.addArea('right',{x:8,y:2,width:3,height:4});
  const walls = new DomainWalls(B, world, domain);
  const shapeCount = () => B.b2Body_GetShapeCount(walls.sync());
  try {
    assert.equal(shapeCount(),8);
    domain.addArea('channel',{x:4,y:2,width:4,height:4});
    assert.equal(shapeCount(),4,'Touching areas left an internal wall');
    domain.updateArea('channel',{enabled:false});
    assert.equal(shapeCount(),8,'Disabling the channel did not close the basins');
    domain.updateArea('channel',{enabled:true});
    assert.equal(shapeCount(),4);
    domain.removeArea('channel');
    assert.equal(shapeCount(),8,'Removing the channel did not close the basins');
  } finally { walls.destroy(); B.b2DestroyWorld(world); }
});
