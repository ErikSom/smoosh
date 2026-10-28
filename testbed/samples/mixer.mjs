import {addBody,addRotor,addPayload} from './helpers.mjs';

// Inspired by the Box2D Spinner benchmark; two finite-torque joint motors.
export default function mixer(scene) {
  scene.domain.addArea('tank',{x:1,y:1,width:30,height:18});
  scene.fill.push({x:1.7,y:1.7,width:28.6,height:8.8});
  addRotor(scene,{x:8.7,y:6.2,radius:3.5,speed:0.7,angle:0.1});
  addRotor(scene,{x:23.3,y:6.2,radius:3.5,speed:-0.7,angle:-0.1});
  addBody(scene,{x:16,y:3,width:0.5,height:4,static:true});
  addPayload(scene,{columns:10,rows:8,x:5.2,y:10.4,dx:2.4,dy:0.8,size:0.58,density:85});
  scene.emitters.push({type:'circle',x:4,y:17,radius:0.35,rate:1800,velocity:[3,-2]});
  scene.drains.push({type:'circle',x:29.4,y:2.4,radius:0.5});
  scene.description='Two counter-rotating Box2D paddle motors stir water and 80 loose bodies. Change motor speed or reverse them in Simulation.';
}
