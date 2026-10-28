import {addBody,addPayload} from './helpers.mjs';

// Opposed positive-displacement pumps. Jets come from moving pistons;
// the only emitters replenish the two feed hoppers.
export default function pistons(scene) {
  scene.title='Pumps + waterwheel';
  scene.domain.addArea('tank',{x:1,y:1,width:30,height:18});
  scene.colorMixing=1.2;scene.settings={friction:0.18};
  const colors=[[1,0.16,0.24],[0.04,0.5,1]];
  for(let side=0;side<2;side++){
    const mirror=side===1,sign=mirror?-1:1,shift=mirror?-5:0;
    const point=(x,y)=>[mirror?32-x:x,y+shift];
    const [cx,cy]=point(6,13.5);
    const pieces=[
      [6,11.25,8.5,0.45],[5.15,15.75,6.7,0.45],[9.975,15.75,0.55,0.45],
      [10,12.125,0.5,1.75],[10,14.875,0.5,1.75],
      [8.2,17,0.35,2.5],[10.4,17,0.35,2.5],
    ];
    addBody(scene,{x:cx,y:cy,static:true,color:'#89949d',fixtures:pieces.map(([x,y,width,height])=>({x:(x-6)*sign,y:y-13.5,width,height}))});
    const phase=side?4.7:0,[x,y]=point(3.5+phase,13.5);
    const piston=addBody(scene,{x,y,density:700,color:'#c5a16c',fixtures:[
      {width:0.5,height:4},{x:-1.2*sign,width:2,height:0.35},
    ]});
    scene.joints.push({type:'prismatic',body:piston,anchor:point(3.5,13.5),axis:[sign,0],lower:0,upper:4.7,
      speed:side?-2.35:2.35,maxForce:800000});
    // Gravity opens the inlet; chamber pressure shuts it against its limit.
    for(const valve of [
      {x:8.6,y:15.75,fixture:{x:0.525*sign,width:1.05,height:0.22},limits:mirror?[0,1.05]:[-1.05,0]},
      {x:10.43,y:14.1,fixture:{y:-0.6,width:0.22,height:1.2},limits:mirror?[-1.3,0]:[0,1.3]},
    ]){
      const [vx,vy]=point(valve.x,valve.y);
      const body=addBody(scene,{x:vx,y:vy,density:180,angularDamping:1,color:'#d7dfe4',fixtures:[valve.fixture]});
      scene.joints.push({type:'revolute',body,anchor:[vx,vy],drive:false,limits:valve.limits,speed:0});
    }
    const color=colors[side],left=side?22.35:4;
    scene.fill.push({x:left,y:11.6+shift,width:side?1.05:5.55,height:3.8,color});
    scene.fill.push({x:side?21.8:8.55,y:16.05+shift,width:1.65,height:1.9,color});
    const [sx,sy]=point(9.2,18.1);
    scene.emitters.push({type:'circle',x:sx,y:sy,radius:0.34,rate:2600,velocity:[0,-1],color});
  }
  const fixtures=[{radius:0.65}];
  for(let i=0;i<8;i++){
    const angle=i*Math.PI/4;
    fixtures.push({x:Math.cos(angle)*2.65,y:Math.sin(angle)*2.65,width:2,height:0.4,angle});
  }
  const wheel=addBody(scene,{x:16,y:10,density:110,angularDamping:0.35,color:'#b8a483',fixtures});
  scene.joints.push({type:'revolute',body:wheel,anchor:[16,10],drive:false,speed:0});
  scene.waterwheel=wheel;
  addBody(scene,{x:8.5,y:5.1,width:10,height:0.4,angle:-0.22,static:true});
  addBody(scene,{x:23.5,y:4.2,width:9,height:0.4,angle:0.18,static:true});
  addPayload(scene,{columns:14,rows:5,x:6.2,y:1.65,dx:1.5,dy:0.45,size:0.32,density:85});
  scene.fill.push({x:2,y:1.45,width:28,height:2.5,color:[0.2,0.65,0.9]});
  scene.drains.push({type:'circle',x:16,y:1.6,radius:0.65});
  scene.description='Two opposed piston pumps drive coloured jets through passive check flaps into a free-spinning waterwheel. Feed hoppers refill the cylinders; the wheel has no motor. The catch basin contains 70 loose bodies.';
}
