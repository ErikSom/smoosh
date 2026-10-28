import {addBody,addRotor} from './helpers.mjs';

// Inspired by Many Pyramids and Spinner, combined in one flooded world.
export default function pyramids(scene) {
  scene.domain.addArea('tank',{x:1,y:1,width:30,height:18});
  for(const center of [10,22])for(let row=0;row<9;row++)for(let col=0;col<9-row;col++){
    addBody(scene,{x:center+(col-(8-row)/2)*0.735,y:1.4+row*0.705,
      width:0.7,height:0.7,density:350,friction:0.45,color:'#dba265'});
  }
  addRotor(scene,{x:3.8,y:5.2,radius:2.4,speed:-0.85});
  addRotor(scene,{x:28.5,y:5.2,radius:2.4,speed:0.85});
  addBody(scene,{x:16,y:2.5,width:2.3,height:0.4,angle:0.1,static:true});
  scene.fill.push({x:1.5,y:1.5,width:29,height:7.2});
  scene.emitters.push({type:'circle',x:3,y:17,radius:0.32,rate:1200,velocity:[4,-2]},
    {type:'circle',x:29,y:17,radius:0.32,rate:1200,velocity:[-4,-2]});
  scene.drains.push({type:'circle',x:16,y:1.9,radius:0.5});
  scene.description='Two nine-row pyramids contain 90 heavy Box2D blocks. Motorized paddles and falling water disturb the stacks; all 93 bodies couple to the liquid.';
}
