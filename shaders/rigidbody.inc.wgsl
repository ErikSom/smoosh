//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts. All rights reserved.
// Adapted for signed distance queries and Box2D world-space snapshots.
//-----------------------------------------------------------------------------
//!insert RigidBody
struct RBCollideResult {
    collides: bool, penetration: f32, normal: vec2f, pointOnCollider: vec2f,
};

// The CPU snapshot is at the end of the submitted batch. Reconstruct each
// substep about the centre of mass, including bodies with offset fixtures.
fn bodyAtTime(body: BodyDef, time: f32) -> BodyDef {
    var result = body;
    let center = vec2f(body.padding0, body.padding1);
    let advanced = center + body.velocity * time;
    result.position = advanced + rot(body.angularVelocity * time) * (body.position - center);
    result.angle += body.angularVelocity * time;
    result.padding0 = advanced.x; result.padding1 = advanced.y;
    return result;
}

// Positive depth is inside, negative depth outside. Normals point INTO the
// solid throughout this ABI; grid correction subtracts that normal.
fn RBdistance(shape: Shape, body_pos: vec2f, body_rot: f32, query_pos: vec2f) -> RBCollideResult {
    let R = rot(body_rot);
    let center = body_pos + R * shape.position;
    if (shape.shapeType == B2CircleShape) {
        let offset = center - query_pos;
        let distance = length(offset);
        let n = select(vec2f(1,0), offset / max(distance, 0.00001), distance > 0.00001);
        let depth = shape.radius - distance;
        return RBCollideResult(depth > 0.0, depth, n, center - n * shape.radius);
    }
    if (shape.shapeType == B2PolygonShape) {
        let p = transpose(R) * (query_pos - center);
        var plane = -3.402823e38;
        var inward = vec2f(0);
        var closest = vec2f(0);
        var distanceSq = 3.402823e38;
        let count = u32(shape.polyCount);
        for (var i = 0u; i < count; i++) {
            let d = dot(shape.polyNormals[i], p) - shape.polyPlane[i];
            if (d > plane) { plane = d; inward = -shape.polyNormals[i]; }
            let a = shape.polyVerts[i]; let b = shape.polyVerts[(i + 1u) % count];
            let e = b - a;
            let q = a + clamp(dot(p - a, e) / max(dot(e,e), 0.00001), 0.0, 1.0) * e;
            let d2 = dot(q-p,q-p);
            if (d2 < distanceSq) { distanceSq = d2; closest = q; }
        }
        var depth = shape.radius - plane;
        if (plane > 0.0) {
            let distance = sqrt(max(distanceSq,0.0));
            depth = shape.radius - distance;
            inward = (closest - p) / max(distance,0.00001);
        }
        let n = R * inward;
        return RBCollideResult(depth > 0.0, depth, n, center + R * closest - n * shape.radius);
    }
    if (shape.shapeType == B2CapsuleShape || shape.shapeType == B2SegmentShape || shape.shapeType == B2ChainSegmentShape) {
        let a = center + R * shape.polyVerts[0]; let b = center + R * shape.polyVerts[1];
        let e = b-a; let q = a + clamp(dot(query_pos-a,e) / max(dot(e,e),0.00001),0.0,1.0) * e;
        let offset = q-query_pos; let distance = length(offset);
        let n = select(vec2f(0,1), offset / max(distance,0.00001), distance > 0.00001);
        let depth = shape.radius-distance;
        return RBCollideResult(depth > 0.0,depth,n,q-n*shape.radius);
    }
    return RBCollideResult(false,-1e6,vec2f(0),query_pos);
}
fn RBcollide(shape: Shape, body_pos: vec2f, body_rot: f32, query_pos: vec2f) -> RBCollideResult {
    return RBdistance(shape,body_pos,body_rot,query_pos);
}
