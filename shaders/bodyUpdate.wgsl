// Per-iteration rigid reaction, following the finite-mass coupling in PB-MPM.
// Momentum is returned to Box2D; virtual gravity is never returned as feedback.
//!include dispatch.inc
//!include simConstants.inc
//!include matrix.inc
//!include rigidbody.inc
@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage> bodies: RigidBody;
@group(0) @binding(2) var<storage,read_write> feedback: BodyFeedback;
@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= g_simConstants.bodyCount) { return; }
    let base = id.x * 8u;
    let ix = atomicExchange(&feedback.iteration[base],0);
    let iy = atomicExchange(&feedback.iteration[base+1u],0);
    let angular = atomicExchange(&feedback.iteration[base+2u],0);
    let contactMass = f32(atomicExchange(&feedback.iteration[base+3u],0)) / 100000.0;
    let contactInertia = f32(atomicExchange(&feedback.iteration[base+4u],0)) / 100000.0;
    let body = bodies.bodies[id.x];
    var state = feedback.states[id.x];
    if (body.mass > 0.0) {
        if (g_simConstants.bodyFeedbackEnabled != 0u) {
            let impulse = vec2f(f32(ix),f32(iy)) / 100000.0;
            state.velocity += impulse / (body.mass * g_simConstants.cellSize);
            state.angularVelocity += f32(angular) / 100000.0 * state.inverseInertia;
            let total = id.x * 4u;
            atomicAdd(&feedback.total[total],ix);
            atomicAdd(&feedback.total[total+1u],iy);
            if (state.inverseInertia > 0.0) { atomicAdd(&feedback.total[total+2u],angular); }
            if (contactMass > 0.0) { state.liquidYield = 1.0 / (1.0 + contactMass/body.mass + contactInertia*state.inverseInertia); }
            else { state.liquidYield = min(state.liquidYield+0.05,1.0); }
        }
        if (g_simConstants.iteration == g_simConstants.iterationCount-1u) {
            state.velocity.y -= f32(g_simConstants.gridSize.y) * g_simConstants.gravityStrength * g_simConstants.deltaTime;
        }
    }
    state.contactMass = contactMass; state.contactInertia = contactInertia;
    feedback.states[id.x] = state;
}
