import {addBody} from './helpers.mjs';
import {randomPalette} from '../colors.mjs';

// A repeating extrusion and kneading line, using the existing putty model.
export default function clayPress(scene) {
  scene.title='Clay extrusion press';
  scene.domain.addArea('tank',{x:1,y:1,width:30,height:18});
  scene.settings={friction:0.24};scene.materials={putty:{elasticity:0.08,plasticity:0.95}};
  for(const options of [
    {x:10.3,y:14.3,width:0.5,height:8.6},{x:21.7,y:14.3,width:0.5,height:8.6},
    {x:16,y:18.6,width:12.2,height:0.5},
    {x:7.5,y:2.4,width:0.5,height:2.8},{x:24.5,y:2.4,width:0.5,height:2.8},
  ])addBody(scene,{...options,static:true,color:'#89949d'});
  // Four open slots form the material; the five teeth are actual fixtures.
  const edges=[[10.3,11.6],[12.8,14.15],[15.35,16.65],[17.85,19.2],[20.4,21.7]];
  const dieY=9.95,dieHeight=1.65,dieTop=dieY+dieHeight/2,headHalfHeight=0.3;
  addBody(scene,{x:16,y:dieY,static:true,color:'#a6afb6',fixtures:edges.map(([a,b])=>({x:(a+b)/2-16,width:b-a,height:dieHeight}))});
  const body=addBody(scene,{x:16,y:16.9,density:700,color:'#c5a16c',fixtures:[
    {width:10.7,height:0.6},{y:0.8,width:0.55,height:1},
  ]});
  const bottom=dieTop+headHalfHeight+0.03,stroke=16.9-bottom;
  scene.press={body,dieTop,headHalfHeight,chamber:{x:10.55,y:dieTop,width:10.9,height:16.6-dieTop}};
  scene.joints.push({type:'prismatic',body,anchor:[16,bottom],axis:[0,1],lower:0,upper:stroke,
    speed:-1.35,maxForce:1700000,turnaround:0.025,feeds:[{source:0,above:3.9,randomColor:true},{source:1,above:3.9,randomColor:true}]});
  for(const [x,speed]of [[13.1,-1.05],[18.9,1.05]]){
    const fixtures=[{radius:1.65}];
    for(let i=0;i<8;i++){
      const angle=i*Math.PI/4;
      fixtures.push({x:Math.cos(angle)*1.76,y:Math.sin(angle)*1.76,width:0.72,height:0.4,angle});
    }
    const roller=addBody(scene,{x,y:6.1,density:600,angularDamping:0.1,color:'#b8a483',fixtures});
    scene.joints.push({type:'revolute',body:roller,anchor:[x,6.1],speed,maxTorque:1800000});
  }
  const colors=randomPalette(3);
  for(let i=0;i<3;i++)scene.fill.push({x:10.85,y:11+i*1.7,width:10.3,height:1.7,material:'putty',color:colors[i]});
  // Wide feed bands avoid the local compression throttle of point sources.
  for(const [i,x]of [11.1,16.2].entries())scene.emitters.push({x,y:13.4,width:4.7,height:1.1,
    rate:8000,velocity:[0,-5.5],material:'putty',color:colors[i],enabled:false});
  scene.drains.push({x:8,y:1.05,width:16,height:0.6});
  scene.description='A motor press extrudes layered clay through four slots. Two powered ribbed rollers pull and fold the strands into the catch bin. Feeders refill only while the head retracts; the bottom drain keeps the line running.';
}
