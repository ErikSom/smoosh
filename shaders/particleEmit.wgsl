// Smoosh emitter. Exact per-step budgets; bounded allocation and free-list reuse.
//!include dispatch.inc
//!include simConstants.inc
//!include particle.inc
//!include matrix.inc
//!include shapes.inc
//!include random.inc
//!include domain.inc

@group(0) @binding(0) var<uniform> g_simConstants: SimConstants;
@group(0) @binding(1) var<storage, read_write> g_particleCount: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> g_particles: array<Particle>;
@group(0) @binding(3) var<storage> g_shapes: array<SimShape>;
@group(0) @binding(4) var<storage, read_write> g_freeIndices: array<atomic<i32>>;
@group(0) @binding(5) var<storage> g_grid: array<i32>;
@group(0) @binding(6) var<storage> g_domain: array<vec4f>;

fn allocate() -> u32 {
    // No CAS spin loop: large fills otherwise serialize entire GPU wavefronts.
    // Emission and draining are separate dispatches, so each popped slot is unique.
    let free = atomicSub(&g_freeIndices[0], 1i) - 1i;
    if (free >= 0) {
        return u32(atomicLoad(&g_freeIndices[4 + u32(free)]));
    }
    let index = atomicAdd(&g_particleCount[0], 1u);
    if (index >= g_simConstants.maxParticleCount) {
        atomicAdd(&g_freeIndices[2], 1i);
        return g_simConstants.maxParticleCount;
    }
    return index;
}

fn randomUnit(seed: u32) -> f32 { return f32(hash(seed) & 0x00ffffffu) / 16777216.0; }

@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if (id.y >= g_simConstants.shapeCount) { return; }
    let shape = g_shapes[id.y];
    if (shape.enabled == 0.0) { return; }
    let initial = shape.functionality == ShapeFunctionInitialEmit;
    if (!initial && shape.functionality != ShapeFunctionEmit) { return; }
    if (initial && g_simConstants.simFrame != u32(shape.padding)) { return; }
    let ppc = g_simConstants.particlesPerCellAxis;
    let nxy = max(vec2u(1), vec2u(floor(shape.halfSize * 2.0 * f32(ppc))));
    var count = u32(floor(shape.area * f32(ppc * ppc)));
    if (initial && shape.shapeType != ShapeTypeCircle) { count = nxy.x * nxy.y; }
    if (!initial) {
        let perStep = shape.emissionRate * g_simConstants.deltaTime;
        count = u32(floor(f32(g_simConstants.simFrame + 1u) * perStep)) - u32(floor(f32(g_simConstants.simFrame) * perStep));
    }
    if (id.x >= count) { return; }
    let seed = id.x + g_simConstants.simFrame * 1664525u + id.y * 1013904223u;
    let uv = vec2f(randomUnit(seed), randomUnit(seed ^ 0x9e3779b9u));
    var offset = (uv * 2.0 - 1.0) * shape.halfSize;
    if (initial && shape.shapeType != ShapeTypeCircle) {
        let cell = vec2u(id.x % nxy.x, id.x / nxy.x);
        offset = (vec2f(cell) + 0.5 + (uv - 0.5) * 0.2) / f32(ppc) - shape.halfSize;
    }
    if (shape.shapeType == ShapeTypeCircle) {
        let angle = uv.y * 6.2831853;
        offset = shape.radius * sqrt(uv.x) * vec2f(cos(angle), sin(angle));
    }
    let position = shape.position + rot(shape.rotation / 180.0 * 3.14159265) * offset;
    if (shape.shapeType == ShapeTypePolygon && !insidePolygon(shape, position)) { return; }
    if (sampleDomain(position).z < 0.3) { return; }
    if (!insideGuardian(vec2u(max(position, vec2f(0))), g_simConstants.gridSize, GuardianSize + 1u)) { return; }
    let gridIndex = gridVertexIndex(vec2u(position), g_simConstants.gridSize);
    if ((!initial || g_simConstants.simFrame > 0u) && decodeFixedPoint(g_grid[gridIndex + 3], g_simConstants.fixedPointMultiplier) > 1.6) { return; }
    let index = allocate();
    if (index == g_simConstants.maxParticleCount) { return; }
    let volume = 1.0 / f32(ppc * ppc);
    let profile = u32(shape.emitMaterial);
    let params = g_simConstants.materials[profile];
    let color = shape.color.rgb;
    g_particles[index] = Particle(position, shape.velocity * g_simConstants.deltaTime,
        Identity, ZeroMatrix, 1.0, 1.0, 0.0, 1.0, volume * params.physical.y, volume, params.physical.w, f32(profile), color);
    atomicAdd(&g_freeIndices[3], 1i);
}
