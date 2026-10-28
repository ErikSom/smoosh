// Smoosh: seed GPU-side rigid velocities; preserve the previous contact yield.
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
    let b = bodies.bodies[id.x];
    var state = feedback.states[id.x];
    state.velocity = b.velocity;
    if (b.mass > 0.0) {
        state.velocity.y -= f32(g_simConstants.gridSize.y) * g_simConstants.gravityStrength * g_simConstants.bodyTime;
    }
    state.angularVelocity = b.angularVelocity;
    state.inverseInertia = 0.0;
    if (feedback.inertias[id.x] > 0.0) { state.inverseInertia = 1.0 / feedback.inertias[id.x]; }
    if (b.mass <= 0.0 || g_simConstants.bodyFeedbackEnabled == 0u) { state.liquidYield = 1.0; }
    feedback.states[id.x] = state;
}
