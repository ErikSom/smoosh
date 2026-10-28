import test from 'node:test';
import assert from 'node:assert/strict';
import Factory from '../node_modules/box2d3-wasm/build/dist/es/compat/Box2D.compat.mjs';
import { Box2DAdapter, SimulationDomain } from '../src/index.mjs';
import { createBody } from '../testbed/scenes.mjs';
import { RIGID_SHAPES_OFFSET } from '../src/layout.mjs';

const B = await Factory();
function setup() {
  const wd=B.b2DefaultWorldDef(),world=B.b2CreateWorld(wd);wd.delete();
  const domain=new SimulationDomain();
  return {world,domain};
}
test('native and JS bridges pack the same geometry, poses and body buckets', {skip:typeof B.SmooshBox2DBridge!=='function'?'Optional native bridge is absent in the standard Box2D package':false}, () => {
  const {world,domain}=setup();
  const native=new Box2DAdapter(B,world,domain), js=new Box2DAdapter(B,world,domain,{native:false});
  try {
    const ids=[createBody(B,world,{x:4,y:5,width:2,height:1,angle:0.35}),createBody(B,world,{x:7,y:8,radius:0.7})];
    const capsuleBody=createBody(B,world,{x:10,y:8,width:1,height:1});
    const capsule=new B.b2Capsule(),sd=B.b2DefaultShapeDef();
    capsule.center1.Set(-0.8,0.5);capsule.center2.Set(0.6,0.7);capsule.radius=0.3;
    B.b2CreateCapsuleShape(capsuleBody,sd,capsule);capsule.delete();sd.delete();ids.push(capsuleBody);
    for(const id of ids){native.addBody(id);js.addBody(id);} native.refresh();js.refresh();
    for(let i=0;i<native.data.length;i++) assert(Math.abs(native.data[i]-js.data[i])<3e-5,`Packed word ${i} differs: ${native.data[i]} / ${js.data[i]}`);
    assert.deepEqual(native.bucketInfo,js.bucketInfo);
    assert.deepEqual(native.bucketIndices,js.bucketIndices);
    const geometry=native.data.slice(RIGID_SHAPES_OFFSET);
    B.b2World_Step(world,1/60,4);native.refresh();
    assert.deepEqual(native.data.slice(RIGID_SHAPES_OFFSET),geometry);
    native.addBody(ids[0]);assert.equal(native.bodyCount,3);
  } finally {native.destroy();js.destroy();B.b2DestroyWorld(world);}
});
test('native and fallback feedback use physical impulse units and discard stale identities', () => {
  for(const useNative of typeof B.SmooshBox2DBridge==='function'?[true,false]:[false]) {
    const {world,domain}=setup(),a=new Box2DAdapter(B,world,domain,{native:useNative});
    try {
      const body=createBody(B,world,{x:4,y:5,width:1,height:1,density:10});a.addBody(body);a.refresh();
      const values=new Int32Array(128*4);values[0]=100000;values[2]=10000;
      a.applyImpulses(values,a.version);const v=B.b2Body_GetLinearVelocity(body);
      assert(Math.abs(v.x-0.1)<1e-5);v.delete();
      const before=B.b2Body_GetAngularVelocity(body);assert(before>0);
      const old=a.version;a.invalidateGeometry();a.applyImpulses(values,old);
      const after=B.b2Body_GetLinearVelocity(body);assert(Math.abs(after.x-0.1)<1e-5);after.delete();
      a.removeBody(body);assert.equal(a.bodyCount,0);a.refresh();
    } finally {a.destroy();B.b2DestroyWorld(world);}
  }
});
test('GPU feedback inertia follows body mass and angular motion locks', () => {
  const {world,domain}=setup(),adapter=new Box2DAdapter(B,world,domain);
  try {
    const body=createBody(B,world,{x:4,y:5,width:2,height:1});adapter.addBody(body);adapter.refresh();
    assert(Math.abs(adapter.inertias[0]-B.b2Body_GetRotationalInertia(body))<1e-4);
    assert(adapter.inertias[0]>0);
    const locks=B.b2Body_GetMotionLocks(body);locks.angularZ=true;B.b2Body_SetMotionLocks(body,locks);locks.delete();
    adapter.refresh();assert.equal(adapter.inertias[0],0,'Locked rotation still reacts on the GPU');
  } finally {adapter.destroy();B.b2DestroyWorld(world);}
});
test('destroyed bodies are safely ignored, and cross-world registration fails', () => {
  const {world,domain}=setup(),other=setup(),a=new Box2DAdapter(B,world,domain);
  try {
    const id=createBody(B,world,{x:1,y:1,width:1,height:1});a.addBody(id);a.refresh();
    B.b2DestroyBody(id);a.refresh();assert.equal(a.data[14],0);
    assert.throws(()=>a.addBody(createBody(B,other.world,{x:1,y:1,width:1,height:1})),/another/);
  } finally {a.destroy();B.b2DestroyWorld(world);B.b2DestroyWorld(other.world);}
});
