import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import Factory from '../node_modules/box2d3-wasm/build/dist/es/compat/Box2D.compat.mjs';
import {Box2DAdapter} from '../src/box2d-adapter.mjs';
import {MAX_BODIES,MAX_BODY_SHAPES} from '../src/layout.mjs';
import {createScene,createBody,createDomainWalls,SCENE_NAMES} from '../testbed/scenes.mjs';
import {createMechanisms} from '../testbed/mechanisms.mjs';
import {randomPalette} from '../testbed/colors.mjs';

const B=await Factory();
test('every sample has its own source file and resets to independent setup data',async()=>{
  for(const name of SCENE_NAMES){
    const scene=createScene(name),fresh=createScene(name);
    assert.equal(scene.source,`testbed/samples/${name}.mjs`);
    await access(new URL('../'+scene.source,import.meta.url));
    const area=scene.domain.areas.keys().next().value;
    scene.domain.removeArea(area);
    assert(fresh.domain.areas.has(area),`${name}: area edits survived a reset`);
    const bodies=fresh.bodies.length,fills=fresh.fill.length;
    scene.bodies.push({x:0,y:0});scene.fill.length=0;
    assert.equal(fresh.bodies.length,bodies);assert.equal(fresh.fill.length,fills);
  }
  const initial=createScene();
  assert.equal(initial.name,'pistons');assert(initial.fill.length&&initial.joints.length);
  assert.equal(createScene('unknown').name,'pistons');
});
test('random clay palettes stay valid and provide distinct colours',()=>{
  for(const n of [2,3]){
    const palette=randomPalette(n,()=>0.5);
    assert.equal(palette.length,n);
    for(const color of palette)assert(color.length===3&&color.every(c=>Number.isFinite(c)&&c>=0&&c<=1));
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)assert(Math.hypot(...palette[i].map((c,k)=>c-palette[j][k]))>0.3);
    assert.notDeepEqual(palette,randomPalette(n,()=>0.1));
  }
});
for(const name of ['mixer','tumbler','many-tumblers','pyramids','pistons']){
  test(`${name}: full scene fits coupling limits and real motors move constrained bodies`,()=>{
    const scene=createScene(name),wd=B.b2DefaultWorldDef();wd.gravity.y=-9.81;
    const world=B.b2CreateWorld(wd);wd.delete();createDomainWalls(B,world,scene.domain);
    const adapter=new Box2DAdapter(B,world,scene.domain);
    let mechanisms;
    try{
      assert(SCENE_NAMES.includes(name));assert(scene.bodies.length>=75&&scene.bodies.length<MAX_BODIES);
      const bodies=scene.bodies.map(options=>{const body=createBody(B,world,options);adapter.addBody(body);return body;});
      mechanisms=createMechanisms(B,world,bodies,scene.joints);adapter.refresh();
      assert(adapter.words[1]<=MAX_BODY_SHAPES&&mechanisms.count===scene.joints.length);
      const starts=mechanisms.joints.map(joint=>joint.type==='prismatic'?B.b2PrismaticJoint_GetTranslation(joint.id):B.b2RevoluteJoint_GetAngle(joint.id));
      const ranges=starts.map(p=>({min:p,max:p}));
      for(let i=0;i<240;i++){
        mechanisms.beforeStep();B.b2World_Step(world,1/60,4);
        for(const [j,joint]of mechanisms.joints.entries())if(joint.type==='prismatic'){
          const p=B.b2PrismaticJoint_GetTranslation(joint.id);ranges[j].min=Math.min(ranges[j].min,p);ranges[j].max=Math.max(ranges[j].max,p);
        }
      }
      for(const body of bodies){const p=B.b2Body_GetPosition(body),v=B.b2Body_GetLinearVelocity(body);assert([p.x,p.y,v.x,v.y,B.b2Body_GetAngularVelocity(body)].every(Number.isFinite));p.delete();v.delete();}
      for(const [i,joint]of mechanisms.joints.entries()){
        if(joint.type==='prismatic'){
          const position=B.b2PrismaticJoint_GetTranslation(joint.id);
          assert(position>=joint.lower-0.03&&position<=joint.upper+0.03,'Piston escaped its travel limits');
          assert(ranges[i].max-ranges[i].min>(joint.upper-joint.lower)*0.8,'Prismatic motor did not traverse its stroke');
        }else{
          if(joint.drive!==false)assert(Math.abs(B.b2RevoluteJoint_GetAngle(joint.id)-starts[i])>0.5,'Revolute motor did not rotate');
          if(joint.limits){const angle=B.b2RevoluteJoint_GetAngle(joint.id);assert(angle>=joint.limits[0]-0.03&&angle<=joint.limits[1]+0.03,'Check flap escaped its angular stops');}
          const p=B.b2Body_GetPosition(joint.bodyId);assert(Math.hypot(p.x-joint.anchor[0],p.y-joint.anchor[1])<0.03,'Motor hinge drifted');p.delete();
        }
      }
      mechanisms.setControls({enabled:true,speed:-0.5});
      for(const joint of mechanisms.joints){
        const speed=joint.type==='prismatic'?B.b2PrismaticJoint_GetMotorSpeed(joint.id):B.b2RevoluteJoint_GetMotorSpeed(joint.id);
        assert(Math.abs(speed+(joint.drive===false?0:joint.speed*joint.direction*0.5))<1e-5,'Motor speed/reverse control was ignored');
        if(joint.drive===false)assert(!B.b2RevoluteJoint_IsMotorEnabled(joint.id),'Passive joint was motorized');
      }
      mechanisms.setControls({enabled:false});
      for(const joint of mechanisms.joints)assert(!(joint.type==='prismatic'?B.b2PrismaticJoint_IsMotorEnabled(joint.id):B.b2RevoluteJoint_IsMotorEnabled(joint.id)));
      // Removing a motor body destroys its joint; controls must safely skip it.
      const removed=mechanisms.joints[0].id;adapter.removeBody(mechanisms.joints[0].bodyId);B.b2DestroyBody(mechanisms.joints[0].bodyId);
      assert(!B.b2Joint_IsValid(removed));mechanisms.setControls({enabled:true,speed:1});mechanisms.beforeStep();
      const ids=mechanisms.joints.map(j=>j.id);mechanisms.destroy();assert(ids.every(id=>!B.b2Joint_IsValid(id)));
    }finally{mechanisms?.destroy();adapter.destroy();B.b2DestroyWorld(world);}
  });
}

test('extrusion feeders follow platen clearance and stop when the drive is disabled or removed',()=>{
  const scene=createScene('clay-press'),wd=B.b2DefaultWorldDef();wd.gravity.y=-9.81;
  const world=B.b2CreateWorld(wd);wd.delete();createDomainWalls(B,world,scene.domain);
  const bodies=scene.bodies.map(o=>createBody(B,world,o));
  const sources=scene.emitters.map(s=>({...s})),sim={shapes:sources,updateShape:(shape,change)=>Object.assign(shape,change)};
  const initialColors=sources.map(s=>JSON.stringify(s.color));
  const mechanism=createMechanisms(B,world,bodies,scene.joints,{sim,sources});
  try{
    mechanism.setControls({enabled:true,speed:1});assert(sources.every(s=>!s.enabled));
    let fed=false;
    for(let i=0;i<500;i++){
      mechanism.beforeStep();
      if(sources.some(s=>s.enabled)){
        const press=mechanism.joints[0],position=B.b2Body_GetPosition(press.bodyId);
        const top=sources[0].type==='circle'?sources[0].y+sources[0].radius:sources[0].y+sources[0].height;
        assert(position.y-scene.press.headHalfHeight>top,'Feeder opened before the platen cleared it');position.delete();
        assert(sources.every((s,i)=>JSON.stringify(s.color)!==initialColors[i]),'Refill kept its previous colour');
        fed=true;mechanism.setControls({enabled:false});assert(sources.every(s=>!s.enabled));
        mechanism.setControls({enabled:true});assert(sources.every(s=>s.enabled));
        B.b2DestroyBody(bodies[scene.joints[0].body]);mechanism.beforeStep();assert(sources.every(s=>!s.enabled));break;
      }
      B.b2World_Step(world,1/60,4);
    }
    assert(fed,'The retracted press never activated its refill');
  }finally{mechanism.destroy();B.b2DestroyWorld(world);}
});
