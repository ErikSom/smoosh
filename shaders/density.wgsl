//!include particle.inc
struct View { size: vec2f, gridSize: vec2f, radius: f32, dt: f32, mode: f32, time: f32, camera: vec4f, particleOffset: u32, };
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage> particles: array<Particle>;
@group(0) @binding(2) var<storage> particleIndices: array<u32>;
struct VertexOut { @builtin(position) position: vec4f, @location(0) local: vec2f, @location(1) color: vec3f, };
@vertex fn vertexMain(@builtin(vertex_index) vertex: u32, @builtin(instance_index) index: u32) -> VertexOut {
    let corners = array(vec2f(-1,-1), vec2f(1,-1), vec2f(-1,1), vec2f(1,1));
    let p = particles[particleIndices[view.particleOffset + index]];
    let local = corners[vertex];
    let position = (((p.position - 5.0 + local * view.radius) / view.gridSize) * 2.0 - 1.0) * view.camera.xy + view.camera.zw;
    var color = p.color;
    if (view.mode == 1.0) {
        let speed = clamp(length(p.displacement) / view.dt * 0.06, 0.0, 1.0);
        color = mix(vec3f(0.05,0.35,0.8), vec3f(1.0,0.55,0.16), speed);
    }
    return VertexOut(vec4f(select(vec2f(-3), position, p.enabled > 0.0),0,1), local, color);
}
@fragment fn fragmentMain(v: VertexOut) -> @location(0) vec4f {
    let r2 = dot(v.local, v.local);
    if (r2 > 1.0) { discard; }
    let falloff = 1.0 - r2;
    let w = select(falloff * falloff, 1.0, view.mode == 2.0);
    return vec4f(v.color * w, w);
}
