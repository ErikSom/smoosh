//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts. All rights reserved.
// Smoosh adaptation: signed-distance area boundaries and Box2D impulse feedback.
//-----------------------------------------------------------------------------
//!include dispatch.inc
//!include simConstants.inc
//!include particle.inc
//!include shapes.inc
//!include rigidbody.inc
//!include domain.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage,read_write> grid: array<i32>;
@group(0) @binding(2) var<storage> shapes: array<SimShape>;
@group(0) @binding(3) var<storage> bodies: RigidBody;
@group(0) @binding(4) var<storage> bodyGrid: array<BodyGridCell>;
@group(0) @binding(5) var<storage,read_write> feedback: BodyFeedback;
@group(0) @binding(6) var<storage> g_domain: array<vec4f>;

@group(0) @binding(7) var<storage> activeBuckets: array<u32>;
@group(0) @binding(8) var<storage> gridArgs: array<u32>;
@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) invocation: vec3u) {
    if (invocation.x >= gridArgs[3] * 36u) { return; }
    let bucket = activeBuckets[invocation.x / 36u];
    let node = invocation.x % 36u;
    let id = vec3u(vec2u(bucket % g_simConstants.bukkitCountX, bucket / g_simConstants.bukkitCountX) * 6u + vec2u(node % 6u, node / 6u), 0u);
    if (any(id.xy >= g_simConstants.gridSize)) { return; }
    let address = gridVertexIndex(id.xy,g_simConstants.gridSize);
    let position = vec2f(id.xy);
    var best = RBCollideResult(false,-2.0,vec2f(0),position);
    var bodyIndex = -1;
    if (g_simConstants.bodyCount > 0u) {
        let cell = bodyGrid[id.y*g_simConstants.gridSize.x+id.x];
        bodyIndex = cell.bodyIndex;
        if (bodyIndex >= 0) {
            let rawBody = bodies.bodies[u32(bodyIndex)];
            let normal = rot(rawBody.angularVelocity*g_simConstants.bodyTime)*cell.normal;
            let depth = cell.depth-dot(cell.normal,cell.velocity)*g_simConstants.bodyTime;
            best = RBCollideResult(depth>0.0,depth,normal,position);
        }
    }
    grid[address+4] = bodyIndex;
    grid[address+5] = encodeFixedPoint(best.normal.x,g_simConstants.fixedPointMultiplier);
    grid[address+6] = encodeFixedPoint(best.normal.y,g_simConstants.fixedPointMultiplier);
    grid[address+7] = encodeFixedPoint(best.penetration,g_simConstants.fixedPointMultiplier);
    let mass = decodeFixedPoint(grid[address+2],g_simConstants.fixedPointMultiplier);
    if (mass < 1e-5) { grid[address]=0; grid[address+1]=0; return; }
    var displacement = vec2f(
        decodeFixedPoint(grid[address],g_simConstants.fixedPointMultiplier),
        decodeFixedPoint(grid[address+1],g_simConstants.fixedPointMultiplier)
    ) / mass;

    if (bodyIndex >= 0) {
        let body = bodyAtTime(bodies.bodies[u32(bodyIndex)],g_simConstants.bodyTime);
        let arm = position-vec2f(body.padding0,body.padding1);
        let state = feedback.states[u32(bodyIndex)];
        let velocity = state.velocity + state.angularVelocity * vec2f(-arm.y,arm.x);
        let relative = displacement-velocity*g_simConstants.deltaTime;
        let radial = dot(relative,best.normal);
        let correction = max(0.0,radial+min(best.penetration+0.5,0.0));
        if (correction > 0.0) {
            var delta = -correction*best.normal;
            let tangent = relative-radial*best.normal;
            let tangentLength = length(tangent);
            if (tangentLength > 1e-7) {
                delta -= tangent * min(1.0,g_simConstants.borderFriction*correction/tangentLength);
            }
            delta *= state.liquidYield;
            displacement += delta;
            if (body.mass > 0.0) {
                let impulse = -mass*delta*g_simConstants.impulseScale/g_simConstants.deltaTime;
                let torque = (arm.x*impulse.y-arm.y*impulse.x)*g_simConstants.cellSize;
                let base = u32(bodyIndex)*8u;
                let contactMass = mass * g_simConstants.impulseScale / g_simConstants.cellSize;
                let contactInertia = contactMass * dot(arm,arm) * g_simConstants.cellSize * g_simConstants.cellSize;
                atomicAdd(&feedback.iteration[base],i32(round(impulse.x*100000.0)));
                atomicAdd(&feedback.iteration[base+1u],i32(round(impulse.y*100000.0)));
                atomicAdd(&feedback.iteration[base+2u],i32(round(torque*100000.0)));
                atomicAdd(&feedback.iteration[base+3u],i32(round(contactMass*100000.0)));
                atomicAdd(&feedback.iteration[base+4u],i32(round(contactInertia*100000.0)));
            }
        }
    }
    for (var i = 0u; i < g_simConstants.shapeCount; i++) {
        let shape = shapes[i];
        if (shape.functionality != ShapeFunctionCollider) { continue; }
        let hit = collide(shape,position+displacement);
        if (hit.collides) {
            let gap = min(0.0,dot(hit.normal,hit.pointOnCollider-position));
            displacement -= max(0.0,dot(hit.normal,displacement)-gap)*hit.normal;
        }
    }
    let boundary = sampleDomain(position+displacement);
    if (boundary.z < 0.65) {
        let normal = safeNormal(boundary.xy);
        displacement -= min(0.0,dot(displacement,normal))*normal;
    }
    // Bound transport BEFORE G2P derives its affine deformation, not afterward.
    displacement *= min(1.0,1.0/max(length(displacement),0.00001));
    grid[address] = encodeFixedPoint(displacement.x,g_simConstants.fixedPointMultiplier);
    grid[address+1] = encodeFixedPoint(displacement.y,g_simConstants.fixedPointMultiplier);
}
