//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!include dispatch.inc

@group(0) @binding(0) var<storage, read_write> g_particleCount : array<atomic<u32>>;
@group(0) @binding(1) var<storage, read_write> g_simIndirectArgs : array<u32>;
@group(0) @binding(2) var<storage, read_write> g_renderIndirectArgs : array<u32>;
@group(0) @binding(3) var<storage, read_write> g_freeIndices : array<atomic<i32>>;

@compute @workgroup_size(1)
fn csMain( @builtin(global_invocation_id) id: vec3<u32> )
{
    // Normalize reservations only after every emitter invocation has completed.
    // Overflow reservations never write a particle and never reach the solver.
    let count = min(atomicLoad(&g_particleCount[0]), atomicLoad(&g_particleCount[1]));
    atomicStore(&g_particleCount[0], count);
    atomicMax(&g_freeIndices[0], 0i);
    g_simIndirectArgs[0] = divUp(count, ParticleDispatchSize);
    g_renderIndirectArgs[1] = count;
}
