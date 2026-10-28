// Testbed machinery uses Box2D constraints, not imposed body transforms.
import {randomPalette} from './colors.mjs';
export function createMechanisms(B,world,bodies,definitions=[],{sim,sources=[]}={}) {
  const joints=[];
  let ground=null;
  if(definitions.length){const def=B.b2DefaultBodyDef();ground=B.b2CreateBody(world,def);def.delete();}
  const valid=joint=>B.b2Joint_IsValid(joint.id);
  const speed=joint=>joint.speed*joint.direction*settings.speed;
  let settings={enabled:true,speed:1};
  const setSpeed=joint=>{
    if(joint.drive===false)return;
    if(joint.type==='prismatic')B.b2PrismaticJoint_SetMotorSpeed(joint.id,speed(joint));
    else B.b2RevoluteJoint_SetMotorSpeed(joint.id,speed(joint));
    B.b2Joint_WakeBodies(joint.id);
  };
  const destroy=()=>{for(const joint of joints)if(valid(joint))B.b2DestroyJoint(joint.id,true);joints.length=0;if(ground&&B.b2Body_IsValid(ground))B.b2DestroyBody(ground);ground=null;};
  try {
    for(const options of definitions){
      const body=bodies[options.body];
      if(!body)throw new Error('A motor references a missing body');
      const def=options.type==='prismatic'?B.b2DefaultPrismaticJointDef():B.b2DefaultRevoluteJointDef();
      try {
        def.base.bodyIdA=ground;def.base.bodyIdB=body;def.base.collideConnected=false;
        const anchor=new B.b2Vec2(...options.anchor),localA=B.b2Body_GetLocalPoint(ground,anchor),localB=B.b2Body_GetLocalPoint(body,anchor);
        def.base.localFrameA.p.Copy(localA);
        // A slider's anchor marks translation zero, independent of its phase.
        if(options.type==='prismatic'){
          def.base.localFrameB.p.Set(0,0);
          const angle=Math.atan2(options.axis[1],options.axis[0]);
          def.base.localFrameA.q.c=def.base.localFrameB.q.c=Math.cos(angle);
          def.base.localFrameA.q.s=def.base.localFrameB.q.s=Math.sin(angle);
          def.enableLimit=true;def.lowerTranslation=options.lower;def.upperTranslation=options.upper;
          def.maxMotorForce=options.maxForce;
        }else{
          def.base.localFrameB.p.Copy(localB);def.maxMotorTorque=options.maxTorque??0;
          if(options.limits){def.enableLimit=true;[def.lowerAngle,def.upperAngle]=options.limits;}
        }
        anchor.delete();localA.delete();localB.delete();
        def.enableMotor=options.drive!==false;def.motorSpeed=options.speed??0;
        const id=options.type==='prismatic'?B.b2CreatePrismaticJoint(world,def):B.b2CreateRevoluteJoint(world,def);
        joints.push({...options,id,direction:1,bodyId:body});
      }finally{def.delete();}
    }
  }catch(error){destroy();throw error;}
  const updateFeeds=()=>{
    if(!sim)return;
    for(const joint of joints)if(joint.feeds){
      const position=valid(joint)?B.b2PrismaticJoint_GetTranslation(joint.id):NaN;
      let colors;
      for(const [i,feed]of joint.feeds.entries()){
        const shape=sources[feed.source];if(!shape||!sim.shapes.includes(shape))continue;
        const enabled=settings.enabled&&speed(joint)>0&&position>=feed.above;
        if(shape.enabled!==enabled){
          const change={enabled};
          if(enabled&&feed.randomColor){colors??=randomPalette(joint.feeds.length);change.color=colors[i];}
          sim.updateShape(shape,change);
        }
      }
    }
  };
  return {
    joints,
    get count(){let n=0;for(const joint of joints)if(valid(joint))n++;return n;},
    get motorCount(){let n=0;for(const joint of joints)if(joint.drive!==false&&valid(joint))n++;return n;},
    setControls({enabled=settings.enabled,speed:multiplier=settings.speed}={}){
      if(!Number.isFinite(multiplier)||Math.abs(multiplier)>3)throw new RangeError('Motor speed multiplier must be between -3 and 3');
      settings={enabled:!!enabled,speed:multiplier};
      for(const joint of joints)if(valid(joint)){
        const enabled=settings.enabled&&joint.drive!==false;
        if(joint.type==='prismatic')B.b2PrismaticJoint_EnableMotor(joint.id,enabled);
        else B.b2RevoluteJoint_EnableMotor(joint.id,enabled);
        setSpeed(joint);
      }
      updateFeeds();
    },
    beforeStep(){
      if(!settings.enabled||!settings.speed){updateFeeds();return;}
      for(const joint of joints)if(joint.type==='prismatic'&&joint.drive!==false&&joint.autoReverse!==false&&valid(joint)){
        const position=B.b2PrismaticJoint_GetTranslation(joint.id),velocity=speed(joint);
        const margin=joint.turnaround??0.08;
        if((velocity>0&&position>=joint.upper-margin)||(velocity<0&&position<=joint.lower+margin)){
          joint.direction*=-1;setSpeed(joint);
        }
      }
      updateFeeds();
    },
    draw(ctx,scale){
      ctx.save();ctx.strokeStyle='#d9d9d9';ctx.lineWidth=1.5/scale;
      for(const joint of joints)if(valid(joint)){
        const [x,y]=joint.anchor;
        if(joint.type==='prismatic'){
          ctx.setLineDash([3/scale,3/scale]);ctx.beginPath();
          ctx.moveTo(x+joint.axis[0]*joint.lower,y+joint.axis[1]*joint.lower);
          ctx.lineTo(x+joint.axis[0]*joint.upper,y+joint.axis[1]*joint.upper);ctx.stroke();ctx.setLineDash([]);
        }else{ctx.beginPath();ctx.arc(x,y,0.12,0,Math.PI*2);ctx.stroke();}
      }
      ctx.restore();
    },
    destroy,
  };
}
