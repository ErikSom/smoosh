import { writeFile } from 'node:fs/promises';
import path from 'node:path';
export async function runMobileChecks(command,sessionId,baseURL){
  const results=[];
  const evaluate=async expression=>{let r;try{r=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);}catch(e){if(/execution context|context.*destroyed/i.test(e.message))return;throw e;}if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result?.value;};
  const waitFor=async expression=>{const end=Date.now()+20000;while(Date.now()<end){if(await evaluate(expression))return;const failure=await evaluate('window.smooshLab?.errors?.[0]??window.smooshExampleError');if(failure)throw new Error(failure.split('\n')[0]);await new Promise(r=>setTimeout(r,50));}throw new Error(`Page did not initialize: ${await evaluate('document.body.innerText.slice(-600)')}`);};
  const navigate=async(path,ready)=>{const marker=`old-${Date.now()}-${Math.random()}`;await evaluate(`globalThis.__oldDocument=${JSON.stringify(marker)}`);await command('Page.navigate',{url:new URL(path,baseURL).href},sessionId);await waitFor(`globalThis.__oldDocument!==${JSON.stringify(marker)}&&(${ready})`);};
  const touch=(type,points=[])=>command('Input.dispatchTouchEvent',{type,touchPoints:points.map((p,i)=>({...p,id:i+1,radiusX:4,radiusY:4,force:1}))},sessionId);
  const tap=async point=>{await touch('touchStart',[point]);await touch('touchEnd');await new Promise(r=>setTimeout(r,230));};
  const center=async selector=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await command('Page.enable',{},sessionId);await command('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5},sessionId);
  for(const [width,height]of [[390,844],[844,390]]){
    const name=`fullscreen touch GUI at ${width}×${height}`;
    try{
      await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:true},sessionId);
      await navigate('testbed/?scene=sandbox','!!window.smooshLab?.sim&&!smooshLab.busy');
      const layout=await evaluate(`(()=>{smooshLab.pause(true);const r=document.getElementById('viewport').getBoundingClientRect();return {width:r.width,height:r.height,iw:innerWidth,ih:innerHeight,expanded:smooshLab.ui.pane.expanded,overflow:document.documentElement.scrollWidth>innerWidth+1,surface:smooshLab.sim.renderer.mode==='surface',benchmark:[...document.querySelectorAll('#gui button')].some(b=>/benchmark gpu/i.test(b.textContent))};})()`);
      if(layout.expanded||layout.overflow||Math.abs(layout.width-layout.iw)>1||Math.abs(layout.height-layout.ih)>1)throw new Error(`Testbed is not a clean fullscreen view: ${JSON.stringify(layout)}`);
      if(!layout.surface||layout.benchmark)throw new Error('Surface is not the default or the GPU benchmark button remains');
      await tap(await center('#gui .tp-rotv_b'));
      if(!await evaluate('smooshLab.ui.pane.expanded'))throw new Error('Touch did not expand settings');
      const changed=await evaluate(`(()=>{const e=document.querySelector('[data-control="tool"] select'),option=[...e.options].find(o=>o.textContent==='Paint material');e.value=option.value;e.dispatchEvent(new Event('change',{bubbles:true}));return smooshLab.controls.tool;})()`);
      if(changed!=='paint')throw new Error('Tweakpane tool binding did not update');
      await tap(await center('#gui .tp-rotv_b'));
      const p={x:width/2,y:height/2};await touch('touchStart',[p]);await touch('touchMove',[{x:p.x+12,y:p.y+4}]);await touch('touchEnd');
      const count=await evaluate(`(async()=>{const l=smooshLab;l.editor.flush();l.sim.step(2);await l.sim.device.queue.onSubmittedWorkDone();return (await l.sim.inspectParticles()).filter((v,i)=>i%24===15&&v).length;})()`);
      if(!count)throw new Error('Touch painting did not create particles');
      // Samples are selected through the actual second Tweakpane tab.
      await tap(await center('#gui .tp-rotv_b'));
      const tab=await evaluate(`(()=>{const e=[...document.querySelectorAll('#gui button')].find(e=>e.textContent==='Samples');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await tap(tab);if(process.env.SMOOSH_SCREENSHOT_DIR&&width===390){const shot=await command('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(path.join(process.env.SMOOSH_SCREENSHOT_DIR,'smoosh-gui-mobile.png'),Buffer.from(shot.data,'base64'));}const samplePoint=await center('[data-sample="cascade"] button');await tap(samplePoint);
      await waitFor('smooshLab.scene.name==="cascade"&&!smooshLab.busy');
      const corridor=await evaluate(`(()=>{const l=smooshLab,edges=l.sim.domain.boundarySegments();for(let i=0;i<edges.length;i+=4){if(edges[i+1]===edges[i+3]&&Math.min(edges[i],edges[i+2])<14&&Math.max(edges[i],edges[i+2])>13&&Math.abs(edges[i+1]-10)<0.2){const p=l.camera.screen(13.5,edges[i+1]);return [...document.getElementById('overlay').getContext('2d').getImageData(Math.round(p.x)-2,Math.round(p.y)-2,5,5).data].some((v,i)=>i%4===3&&v>0);}}return false;})()`);
      if(!corridor)throw new Error('Connecting channel outline is missing');
      await evaluate('smooshLab.pause(true);smooshLab.editor.setTool("stir")');
      const zoom=await evaluate('smooshLab.camera.zoom');
      await touch('touchStart',[{x:p.x-25,y:p.y},{x:p.x+25,y:p.y}]);
      await touch('touchMove',[{x:p.x-45,y:p.y+5},{x:p.x+45,y:p.y+5}]);await touch('touchEnd');
      if(!await evaluate(`smooshLab.camera.zoom>${zoom}`))throw new Error('Pinch did not zoom the camera');
      const idle=await evaluate(`(async()=>{const l=smooshLab;await new Promise(r=>setTimeout(r,100));let calls=0;const q=l.sim.device.queue,submit=q.submit.bind(q);q.submit=(...a)=>{calls++;return submit(...a);};await new Promise(r=>setTimeout(r,150));q.submit=submit;return {calls,errors:l.errors};})()`);
      if(idle.calls||idle.errors.length)throw new Error(`Paused testbed keeps submitting or reports errors: ${JSON.stringify(idle)}`);
      await evaluate('smooshLab.camera.reset(smooshLab.sim.domain);smooshLab.sim.renderer.viewTransform.set(smooshLab.camera.transform);smooshLab.redraw()');
      if(process.env.SMOOSH_SCREENSHOT_DIR){await new Promise(r=>setTimeout(r,100));const shot=await command('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(path.join(process.env.SMOOSH_SCREENSHOT_DIR,`smoosh-mobile-${width}.png`),Buffer.from(shot.data,'base64'));}
      results.push({name,pass:true,paintedParticles:count,corridorVisible:true,pinchZoom:true,pausedSubmissions:idle.calls});
    }catch(error){results.push({name,pass:false,error:error.message});}
  }
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true},sessionId);
  for(const scene of ['minimal','connected','materials']){
    try{
      await navigate(`examples/${scene}/`,'!!window.smooshExample?.sim');
      const p=await evaluate(`(()=>{document.getElementById('pause').click();const c=document.querySelector('canvas');c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await touch('touchStart',[p]);await touch('touchMove',[{x:p.x+10,y:p.y}]);if(!await evaluate('smooshExample.sim.pointer.active'))throw new Error('Touch did not activate pointer');await touch('touchEnd');
      const state=await evaluate(`(async()=>{const s=smooshExample.sim;s.step(2);await s.device.queue.onSubmittedWorkDone();return {count:(await s.inspectParticles()).filter((v,i)=>i%24===15&&v).length,errors:s.stats.errors,active:s.pointer.active,links:[...document.links].map(a=>a.href)};})()`);
      if(!state.count||state.errors.length||state.active||!state.links.some(l=>l.endsWith('/examples/'+scene+'/scene.mjs')))throw new Error(`Example failed: ${JSON.stringify(state)}`);
      results.push({name:`mobile example: ${scene}`,pass:true,particles:state.count});
    }catch(error){results.push({name:`mobile example: ${scene}`,pass:false,error:error.message});}
  }
  for(const scene of ['many-tumblers','color-mixer','clay-press','pistons']){
    const name=`mobile motor scene: ${scene}`;
    try{
      await command('Emulation.setDeviceMetricsOverride',{width:844,height:390,deviceScaleFactor:2,mobile:true},sessionId);
      await navigate(`testbed/?scene=${scene}`,'!!window.smooshLab?.sim&&!smooshLab.busy');
      await evaluate('smooshLab.pause(true)');
      await tap(await center('#gui .tp-rotv_b'));
      const reverse=await evaluate(`(()=>{const e=[...document.querySelectorAll('#gui button')].find(b=>b.textContent==='Reverse motors');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      const before=await evaluate('smooshLab.controls["motor-speed"]');await tap(reverse);
      if(!await evaluate(`Math.abs(smooshLab.controls['motor-speed']+${before})<1e-6`)){
        const detail=await evaluate(`({point:${JSON.stringify(reverse)},hit:document.elementFromPoint(${reverse.x},${reverse.y})?.outerHTML.slice(0,250),expanded:smooshLab.ui.pane.expanded,scroll:document.getElementById('gui').scrollTop})`);
        if(process.env.SMOOSH_SCREENSHOT_DIR){const shot=await command('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(path.join(process.env.SMOOSH_SCREENSHOT_DIR,`smoosh-${scene}-controls.png`),Buffer.from(shot.data,'base64'));}
        throw new Error(`Touch reverse button did not change motor direction: ${JSON.stringify(detail)}`);
      }
      await tap(reverse);
      await tap(await center('[data-control="motors"] input'));
      if(!await evaluate('smooshLab.controls.motors===false'))throw new Error('Touch did not disable the motors');
      await tap(await center('[data-control="motors"] input'));
      await tap(await center('#gui .tp-rotv_b'));
      const frames=scene==='clay-press'?300:scene==='color-mixer'?360:120;
      const state=await evaluate(`(async()=>{const l=smooshLab,s=l.sim;for(let i=0;i<${frames};i++){l.mechanisms.beforeStep();s.step(Math.round(s.simulationHz/60),{render:false});await s.device.queue.onSubmittedWorkDone();while(s.readbacks.some(r=>r.pending))await new Promise(r=>setTimeout(r,0));}s.step(0);l.redraw();return {bodies:s.adapter.bodyCount,joints:l.mechanisms.count,particles:s.stats.particles,errors:l.errors,source:document.getElementById('scene-source').href,overflow:document.documentElement.scrollWidth>innerWidth+1};})()`);
      if(state.overflow||!state.particles||!state.joints||state.errors.length||!state.source.endsWith(`/testbed/samples/${scene}.mjs`))throw new Error(`Motor sample failed: ${JSON.stringify(state)}`);
      if(process.env.SMOOSH_SCREENSHOT_DIR){await new Promise(r=>setTimeout(r,100));const shot=await command('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(path.join(process.env.SMOOSH_SCREENSHOT_DIR,`smoosh-${scene}.png`),Buffer.from(shot.data,'base64'));}
      results.push({name,pass:true,...state});
    }catch(error){results.push({name,pass:false,error:error.message});}
  }
  return results;
}
