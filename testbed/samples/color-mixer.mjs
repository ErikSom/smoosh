import {addRotor,addPayload} from './helpers.mjs';

export default function colorMixer(scene) {
  scene.domain.addArea('tank',{x:1,y:1,width:30,height:18});scene.colorMixing=3.5;
  addRotor(scene,{x:9,y:6.3,radius:3.7,speed:0.72});
  addRotor(scene,{x:23,y:6.3,radius:3.7,speed:-0.72});
  const colors=[[1,0.12,0.22],[1,0.86,0.06],[0.04,0.48,1]];
  for(let i=0;i<3;i++){
    scene.fill.push({x:1.7+i*9.5,y:1.7,width:9.5,height:8.5,color:colors[i]});
    scene.emitters.push({type:'circle',x:4+i*12,y:17,radius:0.32,rate:900,
      velocity:[3-i*3,-2],color:colors[i]});
  }
  addPayload(scene,{columns:12,rows:1,x:3,y:13,dx:2.3,size:0.5,density:75});
  scene.drains.push({type:'circle',x:16,y:2.3,radius:0.45});
  scene.description='Three coloured water streams are stirred by two joint motors. Dye moves with each particle and blends locally on the GPU; new colours remain in the liquid.';
}
