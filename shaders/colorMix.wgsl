// Relax particle dye toward a frozen local mass average. No forces are changed.
//!include dispatch.inc
//!include simConstants.inc
//!include particle.inc
@group(0) @binding(0) var<uniform> sim: SimConstants;
@group(0) @binding(1) var<storage> count: array<u32>;
@group(0) @binding(2) var<storage,read_write> particles: array<Particle>;
@group(0) @binding(3) var<storage> colors: array<i32>;
@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if(id.x>=min(count[0],sim.maxParticleCount)){return;}
    let p=particles[id.x];if(p.enabled==0.0||p.material!=0.0){return;}
    let info=quadraticWeightInit(p.position);var color=vec3f(0);var coverage=0.0;
    for(var y=0;y<3;y++){for(var x=0;x<3;x++){
        let node=vec2i(info.cellIndex)+vec2i(x,y);
        if(any(node<vec2i(0))||any(node>=vec2i(sim.gridSize))){continue;}
        let address=(u32(node.y)*sim.gridSize.x+u32(node.x))*4u;
        let mass=f32(colors[address+3u]);if(mass<=0.0){continue;}
        let weight=info.weights[x].x*info.weights[y].y;
        color+=weight*vec3f(f32(colors[address]),f32(colors[address+1u]),f32(colors[address+2u]))/mass;
        coverage+=weight;
    }}
    if(coverage>0.0){particles[id.x].color=clamp(mix(p.color,color/coverage,sim.colorMixingStrength),vec3f(0),vec3f(1));}
}
