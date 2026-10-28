//-----------------------------------------------------------------------------
// Copyright (c) 2024 Electronic Arts.  All rights reserved.
//-----------------------------------------------------------------------------

//!include dispatch.inc
//!include simConstants.inc
//!include bukkit.inc

@group(0) @binding(0) var<uniform> g_simConstants : SimConstants;
@group(0) @binding(1) var<storage> g_bukkitCounts : array<u32>;
@group(0) @binding(2) var<storage, read_write> g_bukkitIndirectDispatch : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> g_bucketData : array<u32>;
@group(0) @binding(4) var<storage, read_write> g_bukkitParticleAlloctor : array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> g_bukkitIndexStart : array<u32>;

@group(0) @binding(6) var<storage, read_write> gridArgs: array<atomic<u32>>;
@group(0) @binding(7) var<storage, read_write> gridBuckets: array<u32>;

@compute @workgroup_size(GridDispatchSize, GridDispatchSize)
fn csMain( @builtin(global_invocation_id) id: vec3<u32> )
{
    if(id.x >= g_simConstants.bukkitCountX || id.y >= g_simConstants.bukkitCountY)
    {
        return;
    }

    let bukkitIndex = bukkitAddressToIndex(id.xy, g_simConstants.bukkitCountX);

    let bukkitCount = g_bukkitCounts[bukkitIndex];
    let bukkitCountResidual = bukkitCount % ParticleDispatchSize;

    // The quadratic particle stencil reaches only the adjacent grid tiles.
    // Include the full 3x3 halo, including empty tiles receiving grid mass.
    var tileOccupied = false;
    for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
            let p = vec2i(id.xy) + vec2i(ox, oy);
            if (all(p >= vec2i(0)) && all(p < vec2i(vec2u(g_simConstants.bukkitCountX, g_simConstants.bukkitCountY)))) {
                tileOccupied = tileOccupied || g_bukkitCounts[bukkitAddressToIndex(vec2u(p), g_simConstants.bukkitCountX)] > 0u;
            }
        }
    }
    if (tileOccupied) {
        let index = atomicAdd(&gridArgs[3], 1u);
        atomicMax(&gridArgs[0], divUp((index + 1u) * 36u, 64u));
        gridBuckets[index] = bukkitIndex;
    }

    if(bukkitCount == 0)
    {
        return;
    }

    let dispatchCount = divUp(bukkitCount, ParticleDispatchSize);

    let dispatchStartIndex = atomicAdd(&g_bukkitIndirectDispatch[0], dispatchCount);
    let particleStartIndex = atomicAdd(&g_bukkitParticleAlloctor[0], bukkitCount);

    g_bukkitIndexStart[bukkitIndex] = particleStartIndex;

    for(var i: u32 = 0; i < dispatchCount; i++)
    {
        // Group count is equal to ParticleDispatchSize except for the final dispatch for this
        // bukkit in which case it's equal to the residual count
        var groupCount : u32 = ParticleDispatchSize;
        if(bukkitCountResidual != 0 && i == dispatchCount - 1)
        {
            groupCount = bukkitCountResidual;
        }

        let base = (i + dispatchStartIndex) * 4u;
        g_bucketData[base] = particleStartIndex + i * ParticleDispatchSize;
        g_bucketData[base + 1u] = groupCount;
        g_bucketData[base + 2u] = id.x;
        g_bucketData[base + 3u] = id.y;
    }
}
