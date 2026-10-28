export function addBody(scene, options) {
  scene.bodies.push(options);
  return scene.bodies.length - 1;
}

export function addRotor(scene, {x,y,radius=3,speed=0.65,angle=0}) {
  const body=addBody(scene,{x,y,angle,density:700,angularDamping:0.05,color:'#c5a16c',fixtures:[
    {width:radius*2,height:0.55},{width:0.55,height:radius*2},
  ]});
  scene.joints.push({type:'revolute',body,anchor:[x,y],speed,maxTorque:300000});
  return body;
}

export function addTumbler(scene, {x,y,halfSize=5.4,thickness=0.42,speed=0.42}) {
  const body=addBody(scene,{x,y,density:600,color:'#b6a582',fixtures:[
    {x:-halfSize,width:thickness,height:halfSize*2},
    {x:halfSize,width:thickness,height:halfSize*2},
    {y:-halfSize,width:halfSize*2,height:thickness},
    {y:halfSize,width:halfSize*2,height:thickness},
  ]});
  scene.joints.push({type:'revolute',body,anchor:[x,y],speed,maxTorque:1000000});
  return body;
}

export function addPayload(scene,{columns,rows,x,y,dx=0.7,dy=0.7,size=0.48,density=80,circles=true}) {
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const index=row*columns+col;
    addBody(scene,{x:x+col*dx,y:y+row*dy,width:size,height:size*0.85,
      ...(circles&&index%3===0?{radius:size*0.47}:{}),
      angle:circles?((index*17)%11-5)*0.025:0,density,color:index%3===0?'#c8d0d5':'#dba265'});
  }
}
