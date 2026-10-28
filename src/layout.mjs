export const MAX_BODIES = 128;
export const MAX_BODY_SHAPES = 512;
export const BODY_WORDS = 12;
export const RIGID_SHAPE_WORDS = 46;
export const RIGID_SHAPES_OFFSET = 4 + MAX_BODIES * BODY_WORDS;
export const RIGID_WORDS = RIGID_SHAPES_OFFSET + MAX_BODY_SHAPES * RIGID_SHAPE_WORDS;
export const PARTICLE_WORDS = 24;
export const SHAPE_WORDS = 84;
export const UNIFORM_BYTES = 512;
export const BUCKET_SIZE = 6;
export const IMPULSE_MULTIPLIER = 100000;
export const FEEDBACK_STATE_BYTES = MAX_BODIES * 32;
export const FEEDBACK_TOTAL_OFFSET = FEEDBACK_STATE_BYTES + MAX_BODIES * 32;
export const FEEDBACK_INERTIA_OFFSET = FEEDBACK_TOTAL_OFFSET + MAX_BODIES * 16;
export const FEEDBACK_BYTES = FEEDBACK_INERTIA_OFFSET + MAX_BODIES * 4;

export const insertions = {
  DispatchSizes: `const ParticleDispatchSize = 64; const GridDispatchSize = 8; const BukkitSize = 6; const BukkitHaloSize = 1;`,
  SimEnums: `
const MaterialLiquid = 0; const MaterialElastic = 1; const MaterialSand = 2; const MaterialVisco = 3;
const MouseFunctionPush = 0; const MouseFunctionGrab = 1; const GuardianSize = 3;
const ShapeTypeBox = 0; const ShapeTypeCircle = 1; const ShapeTypePolygon = 2;
const ShapeFunctionEmit = 0; const ShapeFunctionCollider = 1; const ShapeFunctionDrain = 2; const ShapeFunctionInitialEmit = 3;
const B2CircleShape = 0; const B2CapsuleShape = 1; const B2SegmentShape = 2; const B2PolygonShape = 3; const B2ChainSegmentShape = 4;`,
  SimConstants: `struct MaterialParams { mechanical: vec4f, physical: vec4f, };
  struct SimConstants {
    gridSize: vec2u, simResDivisor: f32, deltaTime: f32,
    mouseActivation: f32, padding0: f32, mousePosition: vec2f, mouseVelocity: vec2f,
    mouseFunction: f32, elasticityRatio: f32, gravityStrength: f32, liquidRelaxation: f32,
    elasticRelaxation: f32, liquidViscosity: f32, fixedPointMultiplier: u32, useGridVolumeForLiquid: u32,
    particlesPerCellAxis: u32, frictionAngle: f32, plasticity: f32, mouseRadius: f32,
    shapeCount: u32, simFrame: u32, bukkitCount: u32, bukkitCountX: u32,
    bukkitCountY: u32, iteration: u32, iterationCount: u32, borderFriction: f32,
    maxParticleCount: u32, bodyCount: u32, cellSize: f32, impulseScale: f32,
    bodyTime: f32, bodyHorizon: f32,
    materials: array<MaterialParams, 8>,
    timeStepRatio: f32, previousDeltaTime: f32, bucketParticleOffset: u32, bodyFeedbackEnabled: u32,
    colorMixingStrength: f32,
  };`,
  SimShape: `struct SimShape {
    position: vec2f, halfSize: vec2f, radius: f32, rotation: f32, functionality: f32, shapeType: f32,
    emitMaterial: f32, emissionRate: f32, emissionSpeed: f32, padding: f32,
    velocity: vec2f, area: f32, enabled: f32,
    vertices: array<vec2f, 32>,
    color: vec4f,
  };`,
  RigidBody: `
struct BodyDef {
    mass: f32, padding0: f32, position: vec2f, angle: f32, padding1: f32, velocity: vec2f,
    angularVelocity: f32, shapeStartIndex: f32, shapeCount: f32, boundRadiusSq: f32,
};
struct Shape {
    position: vec2f, radius: f32, shapeType: f32, boundRadius: f32, polyCount: f32,
    polyVerts: array<vec2f, 8>, polyNormals: array<vec2f, 8>, polyPlane: array<f32, 8>,
};
struct RigidBody { body_count: u32, shapeCount: u32, padding: vec2f,
    bodies: array<BodyDef, ${MAX_BODIES}>, shapes: array<Shape, ${MAX_BODY_SHAPES}>,
};
struct BodyGridCell { normal: vec2f, depth: f32, bodyIndex: i32, velocity: vec2f, arm: vec2f, };
struct BodyState { velocity: vec2f, angularVelocity: f32, liquidYield: f32, inverseInertia: f32, contactMass: f32, contactInertia: f32, padding: f32, };
struct BodyFeedback { states: array<BodyState, ${MAX_BODIES}>, iteration: array<atomic<i32>, ${MAX_BODIES * 8}>, total: array<atomic<i32>, ${MAX_BODIES * 4}>, inertias: array<f32, ${MAX_BODIES}>, };`,
};

// Material arrays start at word 36 (16-byte alignment); slots are 512 bytes.
export function writeUniform(f, u, offset, sim, frame, iteration, bodyTime = 0) {
  const { domain: d, settings: s, pointer: p } = sim;
  const b = offset / 4;
  u[b] = d.gridWidth; u[b + 1] = d.gridHeight;
  const hz = sim.simulationHz;
  f[b + 2] = 1; f[b + 3] = 1 / hz;
  f[b + 4] = p.active ? 0.16 * (120 / hz) ** 2 : 0;
  f[b + 6] = (p.x - d.origin[0]) / d.cellSize + 5;
  f[b + 7] = (p.y - d.origin[1]) / d.cellSize + 5;
  f[b + 8] = p.vx / d.cellSize; f[b + 9] = p.vy / d.cellSize;
  f[b + 10] = p.mode === 'push' ? 0 : 1; f[b + 11] = 0;
  f[b + 12] = s.gravity / (d.gridHeight * d.cellSize);
  f[b + 13] = s.relaxation; f[b + 14] = 1;
  f[b + 15] = s.viscosity; u[b + 16] = 1000000;
  u[b + 17] = 1; u[b + 18] = s.particlesPerCellAxis;
  f[b + 19] = 35; f[b + 20] = 0; f[b + 21] = p.radius / d.cellSize;
  u[b + 22] = sim.shapes.length; u[b + 23] = frame;
  u[b + 24] = sim.bucketCount; u[b + 25] = sim.bucketX; u[b + 26] = sim.bucketY;
  u[b + 27] = iteration; u[b + 28] = s.iterations;
  f[b + 29] = s.friction; u[b + 30] = sim.maxParticles; u[b + 31] = sim.adapter?.bodyCount ?? 0;
  f[b + 32] = d.cellSize; f[b + 33] = s.density * s.depth * d.cellSize ** 3;
  f[b + 34] = bodyTime;
  f[b + 35] = sim.bodyHorizon ?? 0;
  f[b + 100] = (sim.lastSimulationHz ?? hz) / hz;
  f[b + 101] = 1 / (sim.lastSimulationHz ?? hz);
  u[b + 102] = sim.bucketParticleOffset;
  u[b + 103] = +s.feedback;
  f[b + 104] = sim.colorMixingStrength ?? 0;
  for (let i = 0; i < sim.materials.length; i++) {
    const m = sim.materials[i], at = b + 36 + i * 8;
    const ratio = Math.min(1, s.hz / hz);
    const viscosity = i === 0 ? s.viscosity : m.viscosity;
    const relaxation = i === 0 ? s.relaxation : m.relaxation;
    // Solids can raise the shared clock without changing the requested liquid
    // response. Displacement pressure corrections scale with dt²; viscous
    // attenuation composes across the additional small steps.
    f[at] = m.model === 0 ? 1 - (1 - viscosity) ** ratio : viscosity;
    f[at + 1] = m.model === 0 ? relaxation * ratio * ratio : relaxation;
    f[at + 2] = m.elasticity; f[at + 3] = m.plasticity;
    f[at + 4] = m.frictionAngle; f[at + 5] = m.density; f[at + 6] = m.stiffness; f[at + 7] = m.model;
  }
}
