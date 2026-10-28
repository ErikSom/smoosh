//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts. All rights reserved.
// Smoosh: cache signed contact geometry once per submitted batch. The iterative
// solver only reads this field, avoiding repeated convex geometry queries.
//-----------------------------------------------------------------------------
//!include dispatch.inc
//!include simConstants.inc
//!include matrix.inc
//!include rigidbody.inc
@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage> bodies: RigidBody;
@group(0) @binding(2) var<storage,read_write> bodyGrid: array<BodyGridCell>;
@group(0) @binding(3) var<storage> bodyBuckets: array<vec2u>;
@group(0) @binding(4) var<storage> bodyIndices: array<u32>;
@compute @workgroup_size(8,8)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if (any(id.xy >= g_simConstants.gridSize)) { return; }
    let p = vec2f(id.xy);
    let bucket = bodyBuckets[(id.y/6u)*g_simConstants.bukkitCountX+id.x/6u];
    var best = BodyGridCell(vec2f(0),-1e6,-1,vec2f(0),vec2f(0));
    for (var i = 0u; i < bucket.x; i++) {
        let index = bodyIndices[bucket.y+i]; let body = bodies.bodies[index];
        let speed = length(body.velocity) + abs(body.angularVelocity)*sqrt(body.boundRadiusSq);
        let margin = 2.0 + g_simConstants.bodyHorizon*speed;
        let offset = p-body.position; let reach = sqrt(body.boundRadiusSq)+margin;
        if (dot(offset,offset) > reach*reach) { continue; }
        for (var j = 0u; j < u32(body.shapeCount); j++) {
            let hit = RBdistance(bodies.shapes[u32(body.shapeStartIndex)+j],body.position,body.angle,p);
            if (hit.penetration > best.depth && hit.penetration > -margin) {
                let arm = p-vec2f(body.padding0,body.padding1);
                best = BodyGridCell(hit.normal,hit.penetration,i32(index),body.velocity+body.angularVelocity*vec2f(-arm.y,arm.x),arm);
            }
        }
    }
    bodyGrid[id.y*g_simConstants.gridSize.x+id.x] = best;
}
