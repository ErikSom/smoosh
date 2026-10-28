export function createBody(B, world, { x, y, width = 1.5, height = 1, radius, angle = 0, kinematic = false, static: isStatic = false, density = 55, friction=0.35, linearDamping=0.15, angularDamping=0.3, fixtures }) {
  const def = B.b2DefaultBodyDef();
  def.type = isStatic ? B.b2BodyType.b2_staticBody : kinematic ? B.b2BodyType.b2_kinematicBody : B.b2BodyType.b2_dynamicBody;
  def.position.x = x; def.position.y = y;
  def.rotation.c = Math.cos(angle); def.rotation.s = Math.sin(angle);
  def.linearDamping = linearDamping; def.angularDamping = angularDamping;
  const body = B.b2CreateBody(world, def); def.delete();
  const sd = B.b2DefaultShapeDef();
  for(const fixture of fixtures??[{width,height,radius}]){
    sd.density=fixture.density??density;sd.material.friction=fixture.friction??friction;
    let shape;
    if(fixture.radius){
      shape=new B.b2Circle();shape.center.Set(fixture.x??0,fixture.y??0);shape.radius=fixture.radius;
      B.b2CreateCircleShape(body,sd,shape);
    }else{
      if(fixture.x||fixture.y||fixture.angle){
        const center=new B.b2Vec2(fixture.x??0,fixture.y??0),rotation=B.b2MakeRot(fixture.angle??0);
        shape=B.b2MakeOffsetBox(fixture.width/2,fixture.height/2,center,rotation);center.delete();rotation.delete();
      }else shape=B.b2MakeBox(fixture.width/2,fixture.height/2);
      B.b2CreatePolygonShape(body,sd,shape);
    }
    shape.delete();
  }
  sd.delete();return body;
}
