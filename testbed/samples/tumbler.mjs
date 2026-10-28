import {addTumbler,addPayload} from './helpers.mjs';

// Box2D's Tumbler benchmark, with liquid inside the rotating compound body.
export default function tumbler(scene) {
  scene.domain.addArea('tank',{x:1,y:1,width:30,height:18});
  addTumbler(scene,{x:16,y:10});
  addPayload(scene,{columns:11,rows:10,x:12.5,y:6.5,size:0.5,density:110});
  scene.fill.push({x:11.3,y:5.3,width:9.4,height:3.8});
  scene.description='A motor-driven four-fixture tumbler carries water and 110 loose Box2D bodies. The hinge holds its centre while liquid and contacts load the motor.';
}
