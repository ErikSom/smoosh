import {addTumbler,addPayload} from './helpers.mjs';

// Inspired by Many Tumblers; all 114 bodies participate in liquid coupling.
export default function manyTumblers(scene) {
  scene.domain.addArea('tank',{x:1,y:1,width:30,height:18});
  for(let row=0;row<2;row++)for(let col=0;col<3;col++){
    const x=6+col*10,y=5.2+row*9.6,index=row*3+col;
    addTumbler(scene,{x,y,halfSize:2.4,thickness:0.35,speed:(index%2?-1:1)*(0.35+col*0.07)});
    addPayload(scene,{columns:3,rows:6,x:x-0.85,y:y-1.3,dx:0.85,dy:0.45,size:0.38,density:100});
    scene.fill.push({x:x-1.9,y:y-1.8,width:3.8,height:1.75,material:index%2?'syrup':'water'});
  }
  scene.description='Six independently motorized tumblers, 108 loose bodies, water and syrup. Opposing speeds exercise contacts, motor constraints and two-way liquid interaction.';
}
