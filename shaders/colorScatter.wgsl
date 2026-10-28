// Passive dye: deposit liquid mass and mass-weighted RGB onto the existing grid.
//!include dispatch.inc
//!include simConstants.inc
//!include particle.inc
@group(0) @binding(0) var<uniform> sim: SimConstants;
@group(0) @binding(1) var<storage> count: array<u32>;
@group(0) @binding(2) var<storage> particles: array<Particle>;
@group(0) @binding(3) var<storage,read_write> colors: array<atomic<i32>>;
@compute @workgroup_size(64)
fn csMain(@builtin(global_invocation_id) id: vec3u) {
    if(id.x>=min(count[0],sim.maxParticleCount)){return;}
    let p=particles[id.x];if(p.enabled==0.0||p.material!=0.0){return;}
    let info=quadraticWeightInit(p.position);
    for(var y=0;y<3;y++){for(var x=0;x<3;x++){
        let node=vec2i(info.cellIndex)+vec2i(x,y);
        if(any(node<vec2i(0))||any(node>=vec2i(sim.gridSize))){continue;}
        let weight=info.weights[x].x*info.weights[y].y;
        let mass=p.mass*weight;
        let address=(u32(node.y)*sim.gridSize.x+u32(node.x))*4u;
        atomicAdd(&colors[address],i32(round(p.color.r*mass*1000000.0)));
        atomicAdd(&colors[address+1u],i32(round(p.color.g*mass*1000000.0)));
        atomicAdd(&colors[address+2u],i32(round(p.color.b*mass*1000000.0)));
        atomicAdd(&colors[address+3u],i32(round(mass*1000000.0)));
    }}
}
