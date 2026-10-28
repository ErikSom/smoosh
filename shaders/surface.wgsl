@group(0) @binding(0) var density: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
struct View { size: vec2f, gridSize: vec2f, radius: f32, dt: f32, mode: f32, time: f32, camera: vec4f, particleOffset: u32, };
@group(0) @binding(2) var<uniform> view: View;
struct VertexOut { @builtin(position) position: vec4f, @location(0) uv: vec2f, };
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOut {
    let uv = array(vec2f(0,0), vec2f(2,0), vec2f(0,2))[index];
    return VertexOut(vec4f(uv * vec2f(2,-2) + vec2f(-1,1),0,1), uv);
}
@fragment fn fragmentMain(v: VertexOut) -> @location(0) vec4f {
    // Reconstruct at the particle scale, so zooming cannot expose separate
    // density lobes. The filter width follows world cells, not screen pixels.
    let step = abs(view.camera.xy) / view.gridSize * 0.6;
    let d = textureSample(density, linearSampler, v.uv) * 0.25
        + (textureSample(density, linearSampler, v.uv + vec2f(step.x,0))
         + textureSample(density, linearSampler, v.uv - vec2f(step.x,0))
         + textureSample(density, linearSampler, v.uv + vec2f(0,step.y))
         + textureSample(density, linearSampler, v.uv - vec2f(0,step.y))) * 0.125
        + (textureSample(density, linearSampler, v.uv + step)
         + textureSample(density, linearSampler, v.uv - step)
         + textureSample(density, linearSampler, v.uv + vec2f(step.x,-step.y))
         + textureSample(density, linearSampler, v.uv + vec2f(-step.x,step.y))) * 0.0625;
    let edgeWidth = clamp(fwidth(d.a) * 0.65, 0.025, 0.28);
    let alpha = smoothstep(0.55 - edgeWidth, 0.55 + edgeWidth, d.a);
    // Lighting follows the outer surface; interior density changes are not
    // separate bumps. This is a 2D slice with a constant physical depth.
    let gradient = vec2f(dpdx(alpha), dpdy(alpha));
    if (alpha < 0.001) { return vec4f(0); }
    let normal = normalize(vec3f(-gradient * 3.0, 1.0));
    let light = normalize(vec3f(-0.4,-0.55,0.85));
    let halfVector = normalize(light + vec3f(0,0,1));
    let highlight = max(0.0, dot(normal, halfVector));
    let h2 = highlight * highlight;
    let h4 = h2 * h2;
    let h8 = h4 * h4;
    let specular = h8 * h8 * h8 * h8;
    let base = clamp(d.rgb / max(d.a, 0.001), vec3f(0), vec3f(1));
    let diffuse = 0.9 + 0.08 * max(0.0, dot(normal, light));
    let rim = (1.0 - normal.z) * (1.0 - normal.z);
    let color = base * diffuse
        + vec3f(0.65,0.8,0.95) * specular * 0.1
        + vec3f(0.2,0.36,0.5) * rim * 0.12;
    return vec4f(color * alpha, alpha);
}
