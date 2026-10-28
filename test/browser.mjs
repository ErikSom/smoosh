import { Smoosh, SimulationDomain } from '../dist/index.mjs';
import { createDevice } from '../dist/gpu.mjs';
import { createScene, createBody, createDomainWalls } from '../testbed/scenes.mjs';
import Box2DFactory from '../vendor/box2d3-wasm/build/dist/es/compat/Box2D.compat.mjs';
import { diagnoseParticles } from './particle-diagnostics.mjs';
import { createMechanisms } from '../testbed/mechanisms.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
export async function runBrowserTests(progress = () => {}, {match} = {}) {
  const results = [], validationErrors = [];
  let device;
  try {
    const gpu = await createDevice(); device = gpu.device;
    device.addEventListener('uncapturederror', event => validationErrors.push(event.error.message));
    const B = await Box2DFactory();
    const test = async (name, fn) => {
      if(match&&!match.test(name))return;
      progress(`Running: ${name}\n${results.map(r=>`${r.pass?'PASS':'FAIL'} ${r.name}`).join('\n')}`);
      const start = performance.now();
      try { const detail = await fn(); results.push({ name, pass: true, ms: +(performance.now()-start).toFixed(1), ...detail }); }
      catch (error) { results.push({ name, pass: false, error: error.message, stack: error.stack }); }
    };
    const makeDomain = () => { const d = new SimulationDomain({ width:12,height:8,cellSize:0.15 });d.addArea('tank',{x:1,y:1,width:10,height:6});return d; };
    const make = (domain=makeDomain(), options={}) => Smoosh.create({device,domain,maxParticles:8192,...options});
    const step = async (sim, frames=1) => {
      for(let i=0;i<frames;i++){sim.step(2,{render:false});await device.queue.onSubmittedWorkDone();await Promise.resolve();}
    };
    const inspect = async sim => {
      const p=await sim.inspectParticles(),points=[];let bad=0,outside=0;
      for(let i=0;i<p.length;i+=24)if(p[i+15]!==0){
        if(!p.subarray(i,i+24).every(Number.isFinite))bad++;
        const [x,y]=sim.domain.toWorld(p[i],p[i+1]);points.push([x,y]);
        if(!sim.domain.contains(x,y))outside++;
      }
      return {points,bad,outside};
    };

    await test('advance defers coupled physics until feedback is ready instead of queuing stale body states',async()=>{
      const wd=B.b2DefaultWorldDef(),world=B.b2CreateWorld(wd);wd.delete();
      const sim=await make(undefined,{box2d:B,worldId:world});
      try{
        sim.adapter.addBody(createBody(B,world,{x:6,y:5,width:1,height:1}));
        sim.fill({x:2,y:2,width:3,height:2});sim.advance(1/60,{render:false});
        const time=sim.time,frame=sim.frame,ticks=sim.stats.rigidSteps;
        assert(sim.gpuBusy,'Coupled feedback was not tracked');
        assert(sim.advance(1/60,{render:false})===0,'A second batch was queued before feedback');
        assert(sim.time===time&&sim.frame===frame&&sim.stats.rigidSteps===ticks,'Box2D advanced ahead of its liquid feedback');
        await device.queue.onSubmittedWorkDone();while(sim.readbacks.some(r=>r.pending))await new Promise(r=>setTimeout(r,0));
        assert(!sim.gpuBusy&&sim.advance(1/60,{render:false})>0,'Simulation did not resume after feedback');
        await device.queue.onSubmittedWorkDone();
        return {deferredFrames:sim.stats.deferredFrames};
      }finally{sim.destroy();B.b2DestroyWorld(world);}
    });

    await test('sparse grid dispatch and compact draw arguments omit empty work without changing particles',async()=>{
      const sim=await make();
      const readArgs=async buffer=>{
        const staging=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        try{const e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,staging,0,16);device.queue.submit([e.finish()]);await staging.mapAsync(GPUMapMode.READ);return new Uint32Array(staging.getMappedRange().slice(0));}
        finally{if(staging.mapState==='mapped')staging.unmap();staging.destroy();}
      };
      try{
        sim.fill({x:2,y:4,width:1,height:1});await step(sim);
        const tiles=(await readArgs(sim.buffers.gridArgs))[3],draw=(await readArgs(sim.buffers.renderArgs))[1],p=await inspect(sim);
        assert(tiles>0&&tiles<sim.bucketCount/3,`Sparse dispatch still visits ${tiles}/${sim.bucketCount} tiles`);
        assert(draw===p.points.length&&p.bad===0,'Compact draw list lost live particles');
        sim.addDrain({x:1,y:1,width:10,height:6});await step(sim,2);
        assert((await readArgs(sim.buffers.renderArgs))[1]===0,'Rendering still draws freed slots');
        assert((await readArgs(sim.buffers.gridArgs))[0]===0,'Empty simulation dispatches grid updates');
        assert(sim.stats.highWater>0&&sim.stats.particles===0,'The test did not retain an empty high-water pool');
        return {activeGridTiles:tiles,totalGridTiles:sim.bucketCount,renderedParticles:draw,emptyDrawInstances:0,storageBindings:device.limits.maxStorageBuffersPerShaderStage};
      }finally{sim.destroy();}
    });

    await test('surface rendering has a filled interior, antialiased edges and clears when panned away',async()=>{
      const canvas=document.createElement('canvas');canvas.width=384;canvas.height=384;
      const sim=await make(undefined,{canvas}),renderer=sim.renderer,context=renderer.context;
      const target=device.createTexture({size:[384,384],format:renderer.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
      const staging=device.createBuffer({size:384*384*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      const image=async()=>{
        const e=device.createCommandEncoder();renderer.encode(e);
        e.copyTextureToBuffer({texture:target},{buffer:staging,bytesPerRow:384*4},[384,384]);device.queue.submit([e.finish()]);
        await staging.mapAsync(GPUMapMode.READ);const pixels=new Uint8Array(staging.getMappedRange().slice(0));staging.unmap();return pixels;
      };
      try{
        sim.fill({x:4,y:2,width:3,height:4});sim.fill({type:'circle',x:9,y:4,radius:0.3});await step(sim,1);
        renderer.context={getCurrentTexture:()=>target};renderer.viewTransform.set([0.8,0.5,0,0]);
        const pixels=await image();let opaque=0,antialiased=0;
        for(let i=3;i<pixels.length;i+=4){if(pixels[i]>250)opaque++;else if(pixels[i]>0)antialiased++;}
        const center=(192*384+192)*4,blue=renderer.format.startsWith('bgra')?0:2,red=2-blue;
        assert(pixels[center+3]===255&&pixels[center+blue]>pixels[center+red],'Surface interior is transparent or lost its water color');
        assert(pixels[3]===0&&opaque>1000&&antialiased>0,'Surface fill, background or antialiasing failed');
        assert(pixels[(192*384+243)*4+3]===0&&pixels[(192*384+269)*4+3]>200,'Smoothing joined detached liquid or erased its droplet');
        // Disorder the particle positions without changing the material color.
        // A full liquid interior must not turn that density variation into bumps.
        const particles=await sim.inspectParticles();
        for(let i=0;i<particles.length;i+=24)if(particles[i+15]){
          particles[i]+=0.32*Math.sin(particles[i]*2.3+particles[i+1]*0.7);
          particles[i+1]+=0.32*Math.cos(particles[i]*0.9-particles[i+1]*1.9);
        }
        device.queue.writeBuffer(sim.buffers.particles,0,particles);
        const smooth=await image();let sum=0,square=0,samples=0;
        for(let y=176;y<208;y++)for(let x=160;x<192;x++){
          const offset=(y*384+x)*4,value=smooth[offset+blue];
          assert(smooth[offset+3]===255,'Reconstructed liquid interior contains holes');
          sum+=value;square+=value*value;samples++;
        }
        const interiorColorDeviation=Math.sqrt(Math.max(0,square/samples-(sum/samples)**2));
        assert(interiorColorDeviation<1,`Particle density still creates interior shading bumps: ${interiorColorDeviation}`);
        for(const mode of ['particles','velocity']){
          renderer.mode=mode;const other=await image();
          assert(other.some((v,i)=>i%4===3&&v>0)&&other[3]===0,`${mode} view did not render or clear its background`);
        }
        renderer.mode='surface';
        renderer.viewTransform[2]=4;
        assert((await image()).every(v=>v===0),'Panning outside the world left a stale surface');
        return {opaquePixels:opaque,antialiasedPixels:antialiased,densityScale:renderer.scale,interiorColorDeviation};
      }finally{renderer.context=context;target.destroy();staging.destroy();sim.destroy();}
    });

    await test('managed area walls rebuild on advance and clean up without destroying the world',async()=>{
      const wd=B.b2DefaultWorldDef(),world=B.b2CreateWorld(wd);wd.delete();
      const other=createBody(B,world,{x:5,y:5,width:1,height:1});
      const sim=await make(undefined,{box2d:B,worldId:world,domainWalls:true});
      try{
        const original=sim.walls.body;
        sim.domain.updateArea('tank',{width:8});sim.step(0,{render:false});
        assert(!B.b2Body_IsValid(original)&&B.b2Body_IsValid(sim.walls.body),'Domain walls did not update');
        const current=sim.walls.body;sim.destroy();
        assert(!B.b2Body_IsValid(current)&&B.b2Body_IsValid(other),'Cleanup destroyed caller-owned state');
        return {preservedExternalBody:true};
      }finally{sim.destroy();B.b2DestroyWorld(world);}
    });
    await test('bounded allocation and reset with readbacks in flight',async()=>{
      const sim=await make(undefined,{maxParticles:256});
      try{
        sim.fill({x:2,y:2,width:6,height:3});await step(sim);
        assert(sim.stats.highWater===256,`High-water count ${sim.stats.highWater}`);
        assert(sim.stats.rejected>0,'Capacity overflow was not recorded');
        const p=await inspect(sim);assert(p.points.length===256&&p.bad===0,'Invalid bounded particle storage');
        const count=sim.stats.bufferCount,rejected=sim.stats.rejected;sim.step(1,{render:false});sim.reset();sim.step(0,{render:false});
        await device.queue.onSubmittedWorkDone();await Promise.resolve();
        assert(sim.stats.particles===0,'A stale readback overwrote reset stats');
        assert((await inspect(sim)).points.length===0,'Reset did not clear particles');
        assert(count===sim.stats.bufferCount,'Reset allocated new persistent buffers');
        return {capacity:256,rejected};
      }finally{sim.destroy();}
    });
    await test('overlapping drains free once and emitters reuse the entire capacity',async()=>{
      const sim=await make(undefined,{maxParticles:256});
      try{
        sim.fill({x:2,y:2,width:3,height:2});
        const a=sim.addDrain({x:1,y:1,width:10,height:6}),b=sim.addDrain({x:1,y:1,width:10,height:6});
        await step(sim);assert(sim.stats.particles===0&&sim.stats.drained===256,`Duplicate drain accounting ${JSON.stringify(sim.stats)}`);
        sim.updateShape(a,{enabled:false});sim.updateShape(b,{enabled:false});
        sim.addEmitter({type:'circle',x:3,y:3,radius:0.25,rate:256*120});
        sim.step(1,{render:false});await device.queue.onSubmittedWorkDone();await Promise.resolve();
        assert(sim.stats.highWater===256&&sim.stats.particles===256,'Freed slots were not reused');
        assert(sim.stats.emitted-sim.stats.drained===sim.stats.particles,'Emission/drain mass accounting failed');
        return {emitted:sim.stats.emitted,drained:sim.stats.drained,live:sim.stats.particles};
      }finally{sim.destroy();}
    });
    await test('closed tank conserves particles and stays finite and inside its areas',async()=>{
      const sim=await make();
      try{
        sim.fill({x:2,y:2,width:7,height:3});await step(sim);const initial=sim.stats.particles,count=sim.stats.bufferCount;
        const createBuffer=device.createBuffer.bind(device),createBindGroup=device.createBindGroup.bind(device);
        let newBuffers=0,newBindings=0;
        device.createBuffer=(...args)=>{newBuffers++;return createBuffer(...args);};
        device.createBindGroup=(...args)=>{newBindings++;return createBindGroup(...args);};
        try{await step(sim,150);}finally{device.createBuffer=createBuffer;device.createBindGroup=createBindGroup;}
        const p=await inspect(sim);
        assert(sim.stats.particles===initial,`${initial-sim.stats.particles} particles lost`);
        assert(p.bad===0,`${p.bad} particles have non-finite state`);
        assert(p.outside===0,`${p.outside} particles escaped`);
        assert(sim.stats.bufferCount===count,'Simulation allocated persistent buffers in the hot path');
        assert(newBuffers===0&&newBindings===0,`Hot path allocated ${newBuffers} buffers and ${newBindings} binding groups`);
        return {particles:initial,steps:302,outside:p.outside,newBuffers,newBindings,gpuMs:sim.stats.gpuMs};
      }finally{sim.destroy();}
    });
    await test('liquid flows across overlapping areas without duplicating particles',async()=>{
      const domain=new SimulationDomain({width:12,height:8,cellSize:0.15});
      domain.addArea('left',{x:1,y:3,width:5,height:4});domain.addArea('right',{x:5,y:1,width:6,height:6});
      const sim=await make(domain);
      try{
        sim.fill({x:1.5,y:3.5,width:4,height:3});await step(sim);const initial=sim.stats.particles;
        const before=(await inspect(sim)).points.filter(p=>p[0]>6).length;
        await step(sim,180);const p=await inspect(sim),after=p.points.filter(p=>p[0]>6).length;
        assert(after>before+100,`No significant cross-area flow: ${before} -> ${after}`);
        assert(sim.stats.particles===initial,'Overlap changed the number of particles');assert(p.bad===0,'Invalid particle state');
        return {particles:initial,transferred:after-before};
      }finally{sim.destroy();}
    });
    await test('opening a channel area joins separated basins and updates Box2D walls',async()=>{
      const domain=new SimulationDomain({width:12,height:8,cellSize:0.15});
      domain.addArea('left',{x:1,y:3,width:3,height:4});
      domain.addArea('right',{x:7,y:1,width:4,height:6});
      domain.addArea('channel',{x:3,y:3,width:5,height:1.5,enabled:false});
      const wd=B.b2DefaultWorldDef(),world=B.b2CreateWorld(wd);wd.delete();
      const sim=await make(domain,{box2d:B,worldId:world,domainWalls:true});
      try{
        sim.fill({x:1.4,y:3.5,width:2.2,height:3});await step(sim,60);
        const initial=sim.stats.particles,closed=await inspect(sim),oldWalls=sim.walls.body;
        assert(closed.points.every(p=>p[0]<4.2),'Liquid crossed the disabled channel area');
        domain.updateArea('channel',{enabled:true});await step(sim,240);
        const open=await inspect(sim),transferred=open.points.filter(p=>p[0]>7).length;
        assert(!B.b2Body_IsValid(oldWalls)&&B.b2Body_IsValid(sim.walls.body),'Area edit did not rebuild Box2D walls');
        assert(transferred>100,`No significant flow through the channel area: ${transferred}`);
        assert(sim.stats.particles===initial&&open.points.length===initial,'Channel flow changed the particle count');
        assert(open.bad===0&&open.outside===0,'Channel flow produced invalid or escaped particles');
        return {particles:initial,transferred};
      }finally{sim.destroy();B.b2DestroyWorld(world);}
    });
    await test('disconnected areas do not exchange liquid',async()=>{
      const domain=new SimulationDomain({width:12,height:8,cellSize:0.15});
      domain.addArea('left',{x:1,y:1,width:3,height:6});domain.addArea('right',{x:7,y:1,width:4,height:6});
      const sim=await make(domain);
      try{sim.fill({x:1.4,y:2,width:2,height:3});await step(sim,120);const p=await inspect(sim);
        assert(p.points.every(p=>p[0]<5),'Liquid crossed a disconnected gap');assert(p.bad===0,'Invalid particle state');
        return {particles:p.points.length};
      }finally{sim.destroy();}
    });
    await test('bulk emission of more than 220,000 particles stays responsive',async()=>{
      const domain=new SimulationDomain({width:32,height:20,cellSize:0.08});
      domain.addArea('stress',{x:1,y:1,width:30,height:18});
      const sim=await make(domain,{maxParticles:262144});
      try{
        sim.fill({x:1.6,y:1.6,width:28.8,height:12.5});await step(sim);
        const initial=sim.stats.particles;assert(initial>220000,`Only ${initial} particles were created`);
        await step(sim,30);const p=await inspect(sim);
        assert(sim.stats.particles===initial&&p.points.length===initial,'Bulk fill lost particles');
        assert(p.bad===0&&p.outside===0,'Bulk fill generated invalid or escaped particles');
        assert(!sim.failure,'GPU failed during bulk emission');
        return {particles:initial,steps:62,gpuMs:sim.stats.gpuMs};
      }finally{sim.destroy();}
    });
    await test('multiple liquid worlds remain independent on one GPU device',async()=>{
      const a=await make(undefined,{maxParticles:128}),b=await make(undefined,{maxParticles:256});
      try{
        a.fill({x:2,y:2,width:2,height:2});b.fill({x:7,y:2,width:2,height:2});
        a.step(2,{render:false});b.step(2,{render:false});await device.queue.onSubmittedWorkDone();await Promise.resolve();
        assert(a.stats.particles===128&&b.stats.particles===256,'Instance counts interfered');
        a.destroy();await step(b,10);assert(b.stats.particles===256,'Destroying one instance broke the other');
        return {firstCapacity:128,secondParticles:b.stats.particles};
      }finally{a.destroy();b.destroy();}
    });
    await test('two-way Box2D coupling supports a floating body',async()=>{
      const run=async feedback=>{
        const domain=makeDomain(),wd=B.b2DefaultWorldDef(),world=B.b2CreateWorld(wd);wd.delete();
        createDomainWalls(B,world,domain);
        const sim=await make(domain,{maxParticles:16384,box2d:B,worldId:world,settings:{feedback}});
        try{
          sim.fill({x:1.3,y:1.4,width:9.4,height:3.8});
          const body=createBody(B,world,{x:6,y:5.5,width:1.5,height:0.8,density:30});sim.adapter.addBody(body);
          await step(sim,180);const position=B.b2Body_GetPosition(body),y=position.y;position.delete();
          assert(sim.stats.errors.length===0,'GPU validation error');return y;
        }finally{sim.destroy();B.b2DestroyWorld(world);}
      };
      const without=await run(false),withFeedback=await run(true);
      assert(withFeedback>without+0.3,`Feedback does not support the body: off=${without}, on=${withFeedback}`);
      return {withoutFeedbackY:without,withFeedbackY:withFeedback};
    });
    await test('all PB-MPM materials coexist with independent constitutive models',async()=>{
      const sim=await make(undefined,{maxParticles:16384});
      try{
        for(const [i,material]of ['water','syrup','rubber','sand','putty'].entries())sim.fill({x:1.4+i*1.9,y:4,width:1.3,height:1.8,material});
        await step(sim,120);const p=await sim.inspectParticles(),counts=[0,0,0,0,0];let nonIdentity=0;
        for(let i=0;i<p.length;i+=24)if(p[i+15]){
          const profile=p[i+19];counts[profile]++;assert(p.subarray(i,i+24).every(Number.isFinite),'Invalid mixed-material state');
          assert(p[i+18]===[0,0,1,2,3][profile],`Wrong model for profile ${profile}`);
          if(profile>=2&&Math.abs(p[i+4]-1)+Math.abs(p[i+7]-1)+Math.abs(p[i+5])+Math.abs(p[i+6])>0.01)nonIdentity++;
        }
        assert(counts.every(n=>n>100),'A material disappeared');assert(nonIdentity>50,'Solid models did not evolve their deformation state');
        assert(sim.materials[1].viscosity>sim.settings.viscosity,'Syrup and water share viscosity');
        return {counts,deformedSolidParticles:nonIdentity};
      }finally{sim.destroy();}
    });
    await test('late polygon pours are one-shot, bounded and stay inside the drawn outline',async()=>{
      const sim=await make();
      try{
        await step(sim,5);sim.setSettings({gravity:0});
        sim.pour({type:'polygon',points:[[2,3],[5,3],[3.5,6]],material:'putty'});await step(sim);
        const count=sim.stats.particles;assert(count>500,'Late polygon did not emit');
        assert(!sim.shapes.some(s=>s.kind==='burst'),'Transient pour was retained');
        const p=await inspect(sim);assert(p.bad===0&&p.points.every(p=>p[0]>=2&&p[0]<=5&&p[1]>=3&&p[1]<=6),'Polygon seeded outside bounds');
        await step(sim,10);assert(sim.stats.emitted===count,'One-shot material emitted again');
        sim.erase({x:1,y:1,width:10,height:6});await step(sim);
        assert(sim.stats.particles===0,'Material eraser left particles');assert(!sim.shapes.some(s=>s.kind==='erase'),'Eraser was retained');
        sim.addEmitter({type:'circle',x:4,y:5,radius:0.3,material:'sand',rate:1200});await step(sim,5);
        assert(sim.stats.particles>0,'Sand emitter failed after erasing');assert(sim.stats.highWater===count,'Emitter did not reuse freed slots');
        return {polygonParticles:count,emitterParticles:sim.stats.particles};
      }finally{sim.destroy();}
    });
    await test('syrup dissipates more kinetic energy than water under the same drop',async()=>{
      const energy={};
      for(const material of ['water','syrup']){
        const sim=await make();
        try{
          sim.fill({x:4,y:4,width:3,height:2.5,material});await step(sim,120);
          const p=await sim.inspectParticles();let e=0;
          for(let i=0;i<p.length;i+=24)if(p[i+15])e+=p[i+2]**2+p[i+3]**2;
          energy[material]=e;
        }finally{sim.destroy();}
      }
      assert(energy.water>0&&energy.syrup<energy.water*0.8,`Viscosity has no significant effect: ${JSON.stringify(energy)}`);
      return {relativeKineticEnergy:energy};
    });
    await test('compression chamber: water supports the piston until the relief valve opens',async()=>{
      const frame=document.createElement('iframe');frame.style.cssText='width:1100px;height:850px';
      frame.src='../testbed/?sample=compression';document.body.append(frame);
      try{
        const deadline=performance.now()+20000;
        while(!frame.contentWindow.smooshLab?.sim||frame.contentWindow.smooshLab.busy){
          if(frame.contentWindow.smooshLab?.errors.length)throw new Error(frame.contentWindow.smooshLab.errors[0]);
          if(performance.now()>deadline)throw new Error('Compression sample did not load');
          await new Promise(r=>setTimeout(r,20));
        }
        const lab=frame.contentWindow.smooshLab,s=lab.sim,B=lab.box2d;lab.pause(true);
        const settle=async()=>{await s.device.queue.onSubmittedWorkDone();while(s.readbacks.some(r=>r.pending))await new Promise(r=>setTimeout(r,0));};
        const run=async frames=>{for(let i=0;i<frames;i++){lab.mechanisms.beforeStep();s.step(2,{render:false});await settle();}};
        const heights=()=>lab.mechanisms.joints.map(j=>{const p=B.b2Body_GetPosition(j.bodyId),y=p.y;p.delete();return y;});
        await settle();const initial=s.stats.particles;
        await run(600);const sealed=heights(),floor=lab.scene.compression.pistonBottom;
        assert(Math.abs(sealed[0]-floor)<0.05,'Empty piston did not complete its stroke');
        assert(sealed[1]>sealed[0]+1.5,'Water did not hold the second piston above the empty one');
        assert(lab.mechanisms.joints.every(j=>j.direction===1),'Pistons automatically reversed instead of continuing to press');
        const joint=lab.mechanisms.joints[1],force=B.b2PrismaticJoint_GetMotorForce(joint.id);
        assert(Math.abs(force+joint.maxForce)<joint.maxForce*0.02,'Water-loaded motor did not reach its force limit');
        const closed=await s.inspectParticles(),chamber=lab.scene.compression.chamber;let leaked=0;
        for(let i=0;i<closed.length;i+=24)if(closed[i+15]){
          const [x,y]=s.domain.toWorld(closed[i],closed[i+1]);
          if(x<chamber.x-0.1||x>chamber.x+chamber.width+0.1||y<chamber.y-0.1||y>sealed[1]+0.1)leaked++;
        }
        assert(leaked<initial*0.01,'Sealed chamber lost significant water through its walls');
        frame.contentDocument.querySelector('[data-control="gate"] input').click();
        assert(lab.controls.gate,'Valve control did not open the outlet');
        await run(600);const released=heights(),particles=await s.inspectParticles();
        let live=0,outside=0;
        for(let i=0;i<particles.length;i+=24)if(particles[i+15]){
          live++;assert(particles.subarray(i,i+24).every(Number.isFinite),'Invalid particle state');
          if(!s.domain.contains(...s.domain.toWorld(particles[i],particles[i+1])))outside++;
        }
        assert(Math.abs(released[1]-floor)<0.15,'Opening the valve did not let the water piston finish its stroke');
        assert(live===initial&&s.stats.particles===initial,'Compression sample lost particles');
        assert(outside===0&&!lab.errors.length,'Compression sample escaped the domain or reported errors');
        return {particles:initial,sealedHeights:sealed,releasedHeights:released,motorForce:force,sealedLeakCount:leaked};
      }finally{frame.contentWindow.smooshLab?.sim?.destroy();frame.remove();}
    });
    await test('sample URLs choose the pump default, preserve old links, and follow browser history with cleanup',async()=>{
      const frame=document.createElement('iframe');frame.style.cssText='width:1100px;height:850px';document.body.append(frame);
      const waitFor=async condition=>{
        const end=performance.now()+20000;
        while(!condition()){
          if(frame.contentWindow.smooshLab?.errors.length)throw new Error(frame.contentWindow.smooshLab.errors[0]);
          if(performance.now()>end)throw new Error('Sample navigation did not finish');
          await new Promise(r=>setTimeout(r,20));
        }
      };
      const navigate=async query=>{
        const previous=frame.contentWindow.smooshLab;previous?.sim?.destroy();
        frame.src='../testbed/'+query;
        await waitFor(()=>{const l=frame.contentWindow.smooshLab;return l&&l!==previous&&l.sim&&!l.busy;});
        frame.contentWindow.smooshLab.pause(true);
        return frame.contentWindow.smooshLab;
      };
      try{
        let lab=await navigate('?gui=open&native=0'),w=frame.contentWindow;
        assert(lab.scene.name==='pistons'&&lab.mechanisms.motorCount===2,'Default sample is empty or is not Pumps + waterwheel');
        assert(new URL(w.location.href).searchParams.get('sample')==='pistons','Default link is not shareable');
        const initialSim=lab.sim,initialWorld=lab.world;
        [...frame.contentDocument.querySelectorAll('[data-sample="overlap"] button')][0].click();
        await waitFor(()=>lab.scene.name==='overlap'&&!lab.busy);
        assert(initialSim.destroyed&&!lab.box2d.b2World_IsValid(initialWorld),'Switching left the previous simulation or world alive');
        let url=new URL(w.location.href);
        assert(url.searchParams.get('sample')==='overlap'&&url.searchParams.get('native')==='0'&&url.searchParams.get('gui')==='open','Selection did not preserve a direct link and other options');
        assert(frame.contentDocument.getElementById('scene-source').href.endsWith('/testbed/samples/overlap.mjs'),'Source link points at shared scene code');
        w.history.back();await waitFor(()=>lab.scene.name==='pistons'&&!lab.busy);
        w.history.forward();await waitFor(()=>lab.scene.name==='overlap'&&!lab.busy);
        const count=w.history.length,oldSim=lab.sim;
        [...frame.contentDocument.querySelectorAll('button')].find(b=>b.textContent==='Reset scene').click();
        await waitFor(()=>lab.sim!==oldSim&&!lab.busy);
        assert(oldSim.destroyed&&w.history.length===count,'Reset leaked resources or added a history entry');
        lab=await navigate('?scene=rubber');w=frame.contentWindow;url=new URL(w.location.href);
        assert(lab.scene.name==='rubber'&&url.searchParams.get('sample')==='rubber'&&!url.searchParams.has('scene'),'Existing scene links no longer work');
        lab=await navigate('?sample=clay-press');
        assert(lab.scene.name==='clay-press','Direct sample link opened the wrong sample');
        lab=await navigate('?sample=missing');
        assert(lab.scene.name==='pistons','Unknown sample did not fall back to Pumps + waterwheel');
        return {defaultSample:'pistons',legacyLinks:true,browserHistory:true,sourcePerSample:true,resetCleanup:true};
      }finally{frame.contentWindow.smooshLab?.sim?.destroy();frame.remove();}
    });
    await test('sandbox pointer tools create, move and delete sources, shapes and Box2D bodies',async()=>{
      const frame=document.createElement('iframe');frame.style.cssText='width:1100px;height:850px';frame.src='../testbed/?scene=sandbox';document.body.append(frame);
      try{
        const end=performance.now()+15000;
        while(!frame.contentWindow.smooshLab?.sim||frame.contentWindow.smooshLab.busy){if(frame.contentWindow.smooshLab?.errors?.length)throw new Error(frame.contentWindow.smooshLab.errors[0].split('\n')[0]);if(performance.now()>end)throw new Error('Sandbox did not initialize');await new Promise(r=>setTimeout(r,50));}
        const w=frame.contentWindow,doc=frame.contentDocument,lab=w.smooshLab,canvas=doc.getElementById('overlay');lab.pause(true);
        const tool=name=>{lab.editor.setTool(name);lab.ui.refresh();};
        const pointer=(type,x,y)=>{const r=canvas.getBoundingClientRect(),p=lab.camera.screen(x,y);canvas.dispatchEvent(new w.PointerEvent(type,{bubbles:true,pointerId:1,button:0,buttons:type==='pointerup'?0:1,clientX:r.left+p.x/canvas.width*r.width,clientY:r.top+p.y/canvas.height*r.height}));};
        lab.controls.material='rubber';tool('box');pointer('pointerdown',3,10);pointer('pointermove',6,13);pointer('pointerup',6,13);
        tool('emitter');pointer('pointerdown',5,17);pointer('pointerup',5,17);
        tool('drain');pointer('pointerdown',28,2);pointer('pointerup',28,2);
        tool('obstacle');pointer('pointerdown',12,6);pointer('pointerup',18,7);
        tool('body');pointer('pointerdown',20,14);pointer('pointerup',22,15);
        lab.sim.step(2);await lab.sim.device.queue.onSubmittedWorkDone();await Promise.resolve();
        assert(lab.editor.records.filter(r=>r.body).length===2,'Pointer tools did not create Box2D bodies');
        assert(lab.editor.records.some(r=>r.kind==='drain'),'Drain placement failed');
        tool('select');pointer('pointerdown',5,17);pointer('pointermove',8,17);pointer('pointerup',8,17);
        const source=lab.editor.records.find(r=>r.kind==='emitter');assert(Math.abs(source.shape.x-8)<0.1,'Source drag did not move it');
        [...doc.querySelectorAll('button')].find(b=>b.textContent==='Delete object').click();assert(!lab.editor.records.some(r=>r.kind==='emitter'),'Selected source was not deleted');
        lab.controls.material='putty';tool('polygon');
        for(const [x,y]of [[24,12],[28,12],[26,16]]){pointer('pointerdown',x,y);pointer('pointerup',x,y);}
        doc.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
        lab.sim.step(2);await lab.sim.device.queue.onSubmittedWorkDone();await Promise.resolve();
        const p=await lab.sim.inspectParticles(),profiles=new Set();for(let i=0;i<p.length;i+=24)if(p[i+15])profiles.add(p[i+19]);
        assert(profiles.has(2)&&profiles.has(4),'Rectangle or polygon material tool failed');
        assert(!lab.errors.length,`Sandbox errors: ${lab.errors.join('; ')}`);
        [...doc.querySelectorAll('button')].find(b=>b.textContent==='Clear material').click();await lab.sim.device.queue.onSubmittedWorkDone();
        assert((await lab.sim.inspectParticles()).every((value,i)=>i%24!==15||value===0),'Clear material did not clear particles');
        return {profiles:[...profiles],bodies:2};
      }finally{frame.contentWindow.smooshLab?.sim?.destroy();frame.remove();}
    });
    await test('liquid dye blends persistently, conserves its mean and leaves physics unchanged',async()=>{
      const snapshots=[];
      // Identical particle IDs avoid comparing independently allocated emitters,
      // whose GPU allocation order is intentionally unspecified.
      const seed=new Float32Array(8192*24),columns=80,rows=26,count=columns*rows;
      for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
        const at=(y*columns+x)*24;
        seed[at]=25.25+x*0.5;seed[at+1]=25.25+y*0.5;
        seed[at+4]=seed[at+7]=seed[at+12]=seed[at+13]=seed[at+15]=1;
        seed[at+16]=seed[at+17]=0.25;seed[at+(x<columns/2?20:22)]=1;
      }
      for(const rate of [0,8]){
        const sim=await make(undefined,{settings:{gravity:0,colorMixing:rate}});
        try{
          device.queue.writeBuffer(sim.buffers.particles,0,seed);
          device.queue.writeBuffer(sim.buffers.count,0,new Uint32Array([count,sim.maxParticles,0,0]));
          const initial=await sim.inspectParticles();
          await step(sim,61);const particles=await sim.inspectParticles();
          const stats=p=>{let n=0,red=0,blue=0,mixed=0;for(let i=0;i<p.length;i+=24)if(p[i+15]){n++;red+=p[i+20];blue+=p[i+22];if(p[i+20]>0.03&&p[i+22]>0.03)mixed++;}return {n,red:red/n,blue:blue/n,mixed};};
          const before=stats(initial),after=stats(particles);
          assert(before.n===after.n&&Math.abs(after.red-before.red)<0.002&&Math.abs(after.blue-before.blue)<0.002,'Dye blending lost particles or changed the mean colour');
          assert(rate?after.mixed>50:after.mixed===0,'Dye was not stored on particles or the disabled pass still ran');
          if(!rate)assert(!sim.buffers.colorGrid,'Disabled dye mixing allocated a grid');
          snapshots.push({particles,stats:after});
        }finally{sim.destroy();}
      }
      for(let i=0;i<snapshots[0].particles.length;i++)if(i%24<20)assert(snapshots[0].particles[i]===snapshots[1].particles[i],'Passive dye changed physical particle state');
      return {withoutMixing:snapshots[0].stats,withMixing:snapshots[1].stats};
    });

    for(const name of ['mixer','tumbler','many-tumblers','pyramids','pistons','color-mixer','clay-press']){
      await test(`motor sample ${name}: coupled materials and joints remain finite`,async()=>{
        const scene=createScene(name),wd=B.b2DefaultWorldDef();wd.gravity.y=-9.81;
        const world=B.b2CreateWorld(wd);wd.delete();createDomainWalls(B,world,scene.domain);
        const sim=await make(scene.domain,{maxParticles:scene.maxParticles,box2d:B,worldId:world,settings:{...scene.settings,colorMixing:scene.colorMixing??0}});
        let mechanisms;
        const settle=async()=>{await device.queue.onSubmittedWorkDone();while(sim.readbacks.some(r=>r.pending))await new Promise(r=>setTimeout(r,0));};
        const width=async()=>{const p=await sim.inspectParticles();let lo=Infinity,hi=-Infinity,n=0,bad=0;for(let i=0;i<p.length;i+=24)if(p[i+15]){n++;if(!p.subarray(i,i+24).every(Number.isFinite))bad++;lo=Math.min(lo,p[i]);hi=Math.max(hi,p[i]);}return {particles:n,width:(hi-lo)*scene.domain.cellSize,bad};};
        try{
          for(const [material,parameters]of Object.entries(scene.materials??{}))sim.setMaterial(material,parameters);
          scene.fill.forEach(f=>sim.fill(f));const sources=scene.emitters.map(s=>sim.addEmitter(s));scene.drains.forEach(s=>sim.addDrain(s));
          const bodies=scene.bodies.map(o=>{const body=createBody(B,world,o);sim.adapter.addBody(body);return body;});
          mechanisms=createMechanisms(B,world,bodies,scene.joints,{sim,sources});
          sim.step(1,{render:false});await settle();const initial=await width();
          const frames=name==='clay-press'?1800:name==='pistons'?360:180;
          let minimumSlider=Infinity,maximumSlider=-Infinity,reversals=0,maximumWheelSpeed=0,extrudedParticles=0,feedFrames=0;
          const phases={};
          const charges=[];let lastChargeEmitted=sim.stats.emitted,minimumPressGap=Infinity;
          for(let frame=0;frame<frames;frame++){
            const direction=mechanisms.joints[0]?.direction;mechanisms.beforeStep();const turned=mechanisms.joints[0]?.direction!==direction;if(turned)reversals++;
            sim.step(Math.round(sim.simulationHz/60),{render:false});await settle();
            if(scene.waterwheel!==undefined)maximumWheelSpeed=Math.max(maximumWheelSpeed,Math.abs(B.b2Body_GetAngularVelocity(bodies[scene.waterwheel])));
            if(name==='clay-press'){
              if(sources.some(s=>s.enabled))feedFrames++;
              if([299,599,1079,1799].includes(frame)||(turned&&mechanisms.joints[0].direction===1)){
                let throughDie=0,throughRollers=0,inChamber=0;const p=await sim.inspectParticles(),c=scene.press.chamber;
                for(let i=0;i<p.length;i+=24)if(p[i+15]){const [x,y]=scene.domain.toWorld(p[i],p[i+1]);if(y<9)throughDie++;if(y<4.2)throughRollers++;if(x>=c.x&&x<=c.x+c.width&&y>=c.y&&y<=c.y+c.height)inChamber++;}
                phases[frame]={throughDie,throughRollers,inChamber,emitted:sim.stats.emitted,drained:sim.stats.drained};if(frame===299)extrudedParticles=throughDie;
                if(turned&&mechanisms.joints[0].direction===1){charges.push({time:sim.time,inChamber,added:sim.stats.emitted-lastChargeEmitted});lastChargeEmitted=sim.stats.emitted;}
              }
            }
            for(const joint of mechanisms.joints)if(joint.type==='prismatic'){
              const p=B.b2PrismaticJoint_GetTranslation(joint.id);minimumSlider=Math.min(minimumSlider,p);maximumSlider=Math.max(maximumSlider,p);
              if(name==='clay-press')minimumPressGap=Math.min(minimumPressGap,joint.anchor[1]+p-scene.press.headHalfHeight-scene.press.dieTop);
              assert(p>=joint.lower-0.05&&p<=joint.upper+0.05,'A coupled piston escaped its limits');
            }
          }
          const final=await width();assert(final.particles>0&&final.bad===0&&!sim.stats.errors.length,'Motor sample lost its material or generated invalid state');
          let maximumBodySpeed=0;
          for(const body of bodies){const p=B.b2Body_GetPosition(body),v=B.b2Body_GetLinearVelocity(body);assert([p.x,p.y,v.x,v.y,B.b2Body_GetAngularVelocity(body)].every(Number.isFinite),'A motor body generated invalid state');maximumBodySpeed=Math.max(maximumBodySpeed,Math.hypot(v.x,v.y));p.delete();v.delete();}
          for(const joint of mechanisms.joints)if(joint.type==='revolute'){
            const p=B.b2Body_GetPosition(joint.bodyId);assert(Math.hypot(p.x-joint.anchor[0],p.y-joint.anchor[1])<0.05,'A coupled motor hinge drifted');p.delete();
          }
          if(name==='clay-press'){
            assert(maximumSlider-minimumSlider>4,'Loaded extrusion press did not complete its stroke');
            assert(minimumPressGap>=0.015&&minimumPressGap<0.09,`Platen did not approach the die with clearance: ${minimumPressGap}`);
            assert(reversals>=6,`Loaded press did not complete three down/up cycles: ${JSON.stringify({reversals,minimumSlider,maximumSlider})}`);
            assert(extrudedParticles>initial.particles*0.15,`Die did not extrude enough clay: ${extrudedParticles}`);
            assert(phases[599].throughRollers+sim.stats.drained>100,`Clay did not leave the kneading rollers: ${JSON.stringify({phases,drained:sim.stats.drained,rollerSpeeds:mechanisms.joints.slice(1).map(j=>B.b2Body_GetAngularVelocity(j.bodyId))})}`);
            assert(feedFrames>0&&feedFrames<frames/2,'Clay refill was not synchronized to retraction');
            assert(final.particles===sim.stats.emitted-sim.stats.drained,'Extrusion line lost material outside its explicit drain');
            assert(charges.length>=3&&charges.every(c=>c.added>=12000&&c.inChamber>=initial.particles*0.8),`Refill did not keep the chamber stocked: ${JSON.stringify(charges)}`);
          }
          if(name==='pistons')assert(maximumWheelSpeed>0.1,`Liquid did not drive the passive wheel: ${maximumWheelSpeed}`);
          return {bodies:bodies.length,joints:mechanisms.count,initial,final,simulatedSeconds:sim.time,maximumBodySpeed,...(name==='clay-press'?{minimumSlider,maximumSlider,minimumPressGap,reversals,extrudedParticles,feedFrames,charges,phases,drained:sim.stats.drained}:{}),...(name==='pistons'?{maximumWheelSpeed}:{})};
        }finally{await settle();mechanisms?.destroy();sim.destroy();B.b2DestroyWorld(world);}
      });
    }

    await test('adding rubber to the full stress tank preserves water response and finite body motion',async()=>{
      const scene=createScene('stress'),wd=B.b2DefaultWorldDef();wd.gravity.y=-9.81;
      const world=B.b2CreateWorld(wd);wd.delete();createDomainWalls(B,world,scene.domain);
      const sim=await make(scene.domain,{maxParticles:scene.maxParticles,box2d:B,worldId:world});
      const bodies=scene.bodies.map(o=>{const body=createBody(B,world,o);sim.adapter.addBody(body);return body;});
      const settle=async()=>{await device.queue.onSubmittedWorkDone();while(sim.readbacks.some(r=>r.pending))await new Promise(r=>setTimeout(r,0));};
      const measure=async()=>{
        const p=await sim.inspectParticles();let water=0,rubber=0,energy=0,bad=0,bodySpeed=0;
        for(let i=0;i<p.length;i+=24)if(p[i+15]){
          if(!p.subarray(i,i+24).every(Number.isFinite))bad++;
          if(p[i+18]===0){water++;energy+=(p[i+2]**2+p[i+3]**2)*(scene.domain.cellSize*sim.simulationHz)**2;}else rubber++;
        }
        for(const body of bodies){const v=B.b2Body_GetLinearVelocity(body),position=B.b2Body_GetPosition(body);bodySpeed=Math.max(bodySpeed,Math.hypot(v.x,v.y));if(![v.x,v.y,position.x,position.y].every(Number.isFinite))bad++;v.delete();position.delete();}
        return {water,rubber,waterRmsSpeed:Math.sqrt(energy/water),bodySpeed,bad};
      };
      try{
        scene.fill.forEach(f=>sim.fill(f));
        for(let i=0;i<120;i++){sim.step(2,{render:false});await settle();}
        const before=await measure();assert(before.water===224640,'Full stress load was not seeded');
        sim.pour({type:'circle',x:16,y:17,radius:0.6,material:'rubber'});
        assert(sim.simulationHz===480&&sim.settings.hz===120,'Rubber did not raise the shared clock independently');
        let after;
        for(let i=0;i<60;i++){
          sim.step(8,{render:false});await settle();
          if(i===14){
            after=await measure();
            assert(after.waterRmsSpeed<before.waterRmsSpeed*1.5+0.5,`Water surged when rubber raised the clock: ${JSON.stringify({before,after})}`);
            assert(after.bodySpeed<Math.max(12,before.bodySpeed*1.5),`Bodies surged when rubber raised the clock: ${after.bodySpeed}`);
          }
        }
        const final=await measure();
        assert(final.water===before.water&&final.rubber>600&&final.bad===0,'Mixed stress tank lost particles or produced invalid motion');
        return {before,after,final,fluidHz:sim.simulationHz,rigidHz:sim.settings.rigidHz};
      }finally{await settle();sim.destroy();B.b2DestroyWorld(world);}
    });
    await test('rubber stays connected through a ramp impact and rebound',async()=>{
      const domain=new SimulationDomain();domain.addArea('tank',{x:1,y:1,width:30,height:18});
      const wd=B.b2DefaultWorldDef();wd.gravity.y=-9.81;const world=B.b2CreateWorld(wd);wd.delete();
      createDomainWalls(B,world,domain);
      const sim=await make(domain,{maxParticles:16384,box2d:B,worldId:world});
      try{
        sim.fill({x:11,y:10,width:6,height:6,material:'rubber'});
        sim.adapter.addBody(createBody(B,world,{x:12,y:3,width:11,height:0.5,static:true,angle:0.15}));
        assert(sim.simulationHz===480&&sim.settings.rigidHz===60,'Solid and rigid clocks are not independent');
        const checkpoints=[];
        for(let frame=0;frame<360;frame++){
          sim.step(8,{render:false});await device.queue.onSubmittedWorkDone();await Promise.resolve();
          if([59,119,179,359].includes(frame)){
            const d=diagnoseParticles(await sim.inspectParticles(),domain.cellSize);checkpoints.push({time:sim.time,...d});
            assert(d.count===9216&&d.nonFinite===0,'Rubber lost particles or generated invalid state');
            assert(d.largestFraction>0.99,`Rubber fragmented at ${sim.time}s: ${JSON.stringify(d)}`);
            assert(d.width<14,`Rubber lost its elastic shape: width ${d.width}`);
          }
        }
        assert(sim.stats.rigidSteps===360,`Expected 360 CPU ticks, got ${sim.stats.rigidSteps}`);
        return {fluidSteps:sim.frame,rigidSteps:sim.stats.rigidSteps,checkpoints};
      }finally{sim.destroy();B.b2DestroyWorld(world);}
    });
    await test('480 Hz fluid uses exactly 60 CPU ticks per simulated second',async()=>{
      const domain=makeDomain(),wd=B.b2DefaultWorldDef();wd.gravity.y=-9.81;
      const world=B.b2CreateWorld(wd);wd.delete();
      const sim=await make(domain,{maxParticles:64,box2d:B,worldId:world,settings:{hz:480,solidHz:0,rigidHz:60}});
      try{
        const body=createBody(B,world,{x:5,y:7,width:0.5,height:0.5});sim.adapter.addBody(body);
        B.b2Body_SetLinearDamping(body,0);
        let calls=0;const original=B.b2World_Step;
        B.b2World_Step=(...args)=>{calls++;return original(...args);};
        try{for(let i=0;i<60;i++)await step(sim,4);}finally{B.b2World_Step=original;}
        assert(sim.frame===480&&sim.stats.rigidSteps===60&&calls===60,'CPU clock followed the fluid rate');
        assert(Math.abs(sim.time-1)<1e-8,'Simulation clock drifted');
        const position=B.b2Body_GetPosition(body),y=position.y;position.delete();
        assert(Math.abs(y-(7-9.81/2))<0.15,`Rigid free fall used the wrong clock: ${y}`);
        return {fluidSteps:sim.frame,rigidCalls:calls,time:sim.time,bodyY:y};
      }finally{sim.destroy();B.b2DestroyWorld(world);}
    });
    await test('changing fluid Hz preserves physical velocity and simulated time',async()=>{
      const sim=await make(undefined,{settings:{hz:120,solidHz:0,gravity:0}});
      try{
        sim.fill({x:3,y:4,width:2,height:1,velocity:[1,0]});await step(sim,3);
        const meanVelocity=async()=>{
          const p=await sim.inspectParticles();let sum=0,count=0;
          for(let i=0;i<p.length;i+=24)if(p[i+15]){sum+=p[i+2]*sim.domain.cellSize*sim.simulationHz;count++;}
          return sum/count;
        };
        const before=await meanVelocity(),time=sim.time;
        sim.setSettings({hz:480});await step(sim,1);const fast=await meanVelocity();
        assert(Math.abs(sim.time-time-2/480)<1e-8,'Time jumped during retiming');
        sim.setSettings({hz:120});await step(sim,1);const slow=await meanVelocity();
        assert(Math.abs(fast-before)<0.02&&Math.abs(slow-before)<0.02,`Retiming changed momentum: ${before}, ${fast}, ${slow}`);
        return {before,at480Hz:fast,backAt120Hz:slow};
      }finally{sim.destroy();}
    });
    await device.queue.onSubmittedWorkDone();
  }catch(error){results.push({name:'GPU initialization',pass:false,error:error.message});}
  finally{device?.destroy();}
  return {passed:results.every(r=>r.pass)&&validationErrors.length===0,tests:results,validationErrors};
}
