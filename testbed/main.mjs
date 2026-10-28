import { Smoosh } from '../dist/index.mjs';
import { createDevice } from '../dist/gpu.mjs';
import { createScene,createDomainWalls,SCENE_NAMES,DEFAULT_SCENE } from './scenes.mjs';
import { createBody } from './bodies.mjs';
import { sampleFromURL,sampleURL } from './sample-url.mjs';
import { createMechanisms } from './mechanisms.mjs';
import { rgbToHex } from './colors.mjs';
import { SandboxEditor } from './editor.mjs';
import { Camera2D } from './camera.mjs';
import { createGui } from './gui.mjs';

const canvas=document.getElementById('liquid'),overlay=document.getElementById('overlay'),ctx=overlay.getContext('2d');
const params=new URLSearchParams(location.search),camera=new Camera2D(),errors=[];
const controls={paused:false,tool:'stir',material:'water',radius:0.6,rate:2400,'velocity-x':0,'velocity-y':-2,'body-shape':'box','body-density':55,'touch-push':false,objects:'','object-x':0,'object-y':0,'object-enabled':true,viscosity:0.015,elasticity:0.08,stiffness:1.5,plasticity:0.5,'friction-angle':35,gravity:9.81,'fluid-hz':120,'solid-hz':480,'rigid-hz':60,quality:5,feedback:true,view:'surface',areas:true,gate:true,animate:true,particles:0,gpuMs:0,cpuMs:0,fps:0,memoryMB:0,time:0};
Object.assign(controls,{motors:true,'motor-speed':1,tint:'#1f8cf2','color-mixing':0,bodyCount:0,jointCount:0});
let B,gpu,sim,scene,world,ground,gate,mechanisms,velocityVector,ui,gpuLost=false,busy=true,benchmarking=false,needsStep=false,needsRender=true;
let lastTime=performance.now(),lastStats=0,frameMs=16.67,messageTimer;
const notify=message=>{const el=document.getElementById('message');el.textContent=message;el.hidden=false;clearTimeout(messageTimer);messageTimer=setTimeout(()=>{el.hidden=true;},2200);};
const objectsChanged=()=>{if(!busy)ui?.objects(editor.records,editor.selected);};
const editor=new SandboxEditor(overlay,{controls,camera,notify,onEdit:()=>{needsStep=true;needsRender=true;},onMaterialSelect:materialControls,onObjectsChange:objectsChanged,onSelectionChange:()=>ui?.selection(editor.selected),onHelp:()=>{},
  onAreaChange:()=>{if(ground)B.b2DestroyBody(ground);ground=createDomainWalls(B,world,sim.domain);needsStep=true;needsRender=true;},
});
function redraw(){needsRender=true;}
function showError(error){const message=error.message??String(error);if(errors.includes(message))return;errors.push(message);const el=document.getElementById('error');el.hidden=false;el.textContent=message+'\nReset the scene to restart.';console.error(error);}
function materialControls(){const m=sim?.materials.find(m=>m.name===controls.material);if(!m)return;controls.tint=rgbToHex(m.color);for(const [key,source]of [['viscosity','viscosity'],['elasticity','elasticity'],['stiffness','stiffness'],['plasticity','plasticity'],['friction-angle','frictionAngle']])controls[key]=m[source];if(m.name==='water')controls.viscosity=sim.settings.viscosity;ui?.material(m);}
function pause(value=!controls.paused){controls.paused=value;lastTime=performance.now();ui?.refresh();}
function setGate(){if(!gate||!B.b2Body_IsValid(gate))return;const p=new B.b2Vec2(scene.gate.x,controls.gate?23:scene.gate.y),q=B.b2MakeRot(0);B.b2Body_SetTransform(gate,p,q);p.delete();q.delete();for(const r of editor.records)if(r.body===gate)r.hidden=controls.gate;needsStep=true;redraw();}
function syncCamera(){if(sim?.renderer)sim.renderer.viewTransform.set(camera.transform);redraw();}
function fit(){if(sim){camera.reset(sim.domain);syncCamera();}}
function resize(){const r=document.getElementById('viewport').getBoundingClientRect(),scale=Math.min(devicePixelRatio||1,2);const width=Math.max(1,Math.round(r.width*scale)),height=Math.max(1,Math.round(r.height*scale));if(canvas.width!==width||canvas.height!==height){canvas.width=overlay.width=width;canvas.height=overlay.height=height;camera.resize(width,height);syncCamera();}}
new ResizeObserver(resize).observe(document.getElementById('viewport'));resize();
camera.bind(overlay,{isPanTool:()=>controls.tool==='pan',onChange:syncCamera,onCancel:()=>editor.cancel()});
overlay.addEventListener('pointermove',redraw);overlay.addEventListener('pointerup',redraw);
function useDevice(context){gpu=context;gpuLost=false;context.device.lost.then(()=>{if(gpu===context)gpuLost=true;});}
let sceneLoad=null,pendingScene=null;
function loadScene(name,{historyMode='replace'}={}){
  name=SCENE_NAMES.includes(name)?name:DEFAULT_SCENE;
  const url=sampleURL(location.href,name);
  if(url.href!==location.href)history[historyMode==='push'?'pushState':'replaceState'](null,'',url);
  pendingScene=name;
  if(sceneLoad)return sceneLoad;
  sceneLoad=(async()=>{
    try{
      while(pendingScene!==null){const next=pendingScene;pendingScene=null;await buildScene(next);}
    }finally{sceneLoad=null;}
  })();
  return sceneLoad;
}
async function buildScene(name){
  busy=true;ui.busy(true);editor.disabled=true;editor.cancel();errors.length=0;document.getElementById('error').hidden=true;const loading=document.getElementById('loading');loading.hidden=false;loading.textContent='Loading simulation…';
  try{
    mechanisms?.destroy();mechanisms=null;sim?.destroy();sim=null;if(gpuLost)useDevice(await createDevice());if(world)B.b2DestroyWorld(world);world=null;
    scene=createScene(name);const wd=B.b2DefaultWorldDef();wd.gravity.y=-controls.gravity;world=B.b2CreateWorld(wd);wd.delete();ground=createDomainWalls(B,world,scene.domain);
    controls['color-mixing']=scene.colorMixing??0;
    sim=await Smoosh.create({domain:scene.domain,maxParticles:scene.maxParticles,device:gpu.device,canvas,box2d:B,worldId:world,nativeBridge:params.get('native')!=='0',onError:showError,
      settings:{...scene.settings,hz:controls['fluid-hz'],solidHz:controls['solid-hz'],rigidHz:controls['rigid-hz'],iterations:controls.quality,gravity:controls.gravity,feedback:controls.feedback,colorMixing:controls['color-mixing']}});
    for(const [material,parameters]of Object.entries(scene.materials??{}))sim.setMaterial(material,parameters);
    camera.reset(sim.domain);syncCamera();editor.bind(sim,B,world);
    for(const id of scene.domain.areas.keys())editor.addAreaRecord(id);
    for(const fill of scene.fill)sim.fill(fill);
    const sources=[];for(const s of scene.emitters){const shape=sim.addEmitter(s);sources.push(shape);editor.register('emitter',{shape});}
    for(const s of scene.drains)editor.register('drain',{shape:sim.addDrain(s)});
    const bodies=[],records=[];for(const options of scene.bodies){const b=createBody(B,world,options);sim.adapter.addBody(b);bodies.push(b);records.push(editor.addBodyRecord(b,options));}
    for(const motion of scene.kinematics??[])records[motion.bodyIndex].animation=motion;
    mechanisms=createMechanisms(B,world,bodies,scene.joints,{sim,sources});mechanisms.setControls({enabled:controls.motors,speed:controls['motor-speed']});editor.mechanisms=mechanisms;
    gate=scene.gate?createBody(B,world,{...scene.gate,kinematic:true}):null;if(gate){sim.adapter.addBody(gate);editor.addBodyRecord(gate,{kinematic:true});controls.gate=!scene.gateClosed;setGate();}
    ui.scene(scene.title??name,!!gate,mechanisms.motorCount>0,scene.kinematics.length>0);document.getElementById('scene-source').href=`https://github.com/ErikSom/smoosh/blob/main/${scene.source}`;
    sim.renderer.mode=controls.view;sim.step(1);needsStep=false;drawOverlay();needsRender=false;loading.hidden=true;
  }catch(error){loading.hidden=true;throw error;}
  finally{busy=false;editor.disabled=false;ui.busy(false);ui.objects(editor.records,editor.selected);materialControls();lastTime=performance.now();}
}
function animate(){mechanisms?.beforeStep();for(const r of editor.records)if(r.animation){const m=r.animation;velocityVector.Set(0,controls.animate?-m.amplitude*m.speed*Math.cos(sim.time*m.speed):0);B.b2Body_SetLinearVelocity(r.body,velocityVector);}}
function drawOverlay(){ctx.clearRect(0,0,overlay.width,overlay.height);editor.draw(ctx);}
function clear(){if(!sim)return;for(const s of [...sim.shapes])if(['fill','burst','erase'].includes(s.kind))sim.removeShape(s);editor.pending=[];sim.reset();needsStep=false;redraw();}
function tick(now){
  const dt=Math.max(0,(now-lastTime)/1000);lastTime=now;frameMs=frameMs*0.93+Math.min(dt*1000,100)*0.07;
  if(!busy&&!benchmarking&&sim&&!errors.length&&!document.hidden){try{
    editor.flush();let rendered=false;
    if(controls.paused){if(needsStep||needsRender){sim.step(needsStep?1:0);rendered=true;}}
    else{const busyGPU=sim.gpuBusy;if(!busyGPU)animate();const render=needsRender||sim.accumulator+dt+1e-9>=1/sim.simulationHz;sim.advance(dt,{render});rendered=render&&!busyGPU;}
    needsStep=false;if(rendered){drawOverlay();needsRender=false;}
    if(now-lastStats>250){const s=sim.stats;Object.assign(controls,{particles:s.particles,bodyCount:sim.adapter.bodyCount,jointCount:mechanisms?.count??0,gpuMs:s.gpuMs??0,cpuMs:s.cpuMs,fps:Math.round(1000/frameMs),memoryMB:s.gpuBytes/1048576,time:sim.time});ui.stats();lastStats=now;}
  }catch(error){showError(error);}}
  requestAnimationFrame(tick);
}
async function benchmark({samples=60,warmup=10,steps=Math.min(sim?.maxSubsteps??8,Math.max(1,Math.round((sim?.simulationHz??120)/60)))}={}){
  if(busy||benchmarking||!sim)return;benchmarking=true;ui.busy(true);editor.disabled=true;const times=[],cpu=[];
  try{for(let i=0;i<samples+warmup;i++){animate();sim.step(steps,{render:false});await sim.device.queue.onSubmittedWorkDone();await Promise.resolve();if(i>=warmup&&sim.stats.gpuMs!==null){times.push(sim.stats.gpuMs);cpu.push(sim.stats.cpuMs);}if(i%10===0)await new Promise(requestAnimationFrame);}
    times.sort((a,b)=>a-b);cpu.sort((a,b)=>a-b);const result={scene:scene.name,particles:sim.stats.particles,iterations:sim.settings.iterations,fluidHz:sim.simulationHz,rigidHz:sim.settings.rigidHz,cellSize:sim.domain.cellSize,stepsPerSample:steps,simulatedSecondsPerSample:steps/sim.simulationHz,samples:times.length,gpuMedianMs:times[Math.floor(times.length/2)]??null,gpuP95Ms:times[Math.min(times.length-1,Math.floor(times.length*0.95))]??null,cpuMedianMs:cpu[Math.floor(cpu.length/2)]??null,errors:[...sim.stats.errors]};window.lastSmooshBenchmark=result;notify(result.gpuMedianMs===null?'GPU timestamps unavailable':`${steps} steps: ${result.gpuMedianMs.toFixed(2)} ms median / ${result.gpuP95Ms.toFixed(2)} ms p95 GPU`);return result;
  }finally{benchmarking=false;editor.disabled=false;ui.busy(false);lastTime=performance.now();redraw();}
}
ui=createGui(controls,{
  pause,step:()=>{if(busy||benchmarking)return;pause(true);editor.flush();animate();sim.step(1);needsStep=false;drawOverlay();},reset:()=>loadScene(scene.name).catch(showError),clear,fit,gate:setGate,animate:()=>{animate();redraw();},
  motors:()=>{mechanisms?.setControls({enabled:controls.motors,speed:controls['motor-speed']});redraw();},
  reverseMotors:()=>{controls['motor-speed']*=-1;mechanisms?.setControls({enabled:controls.motors,speed:controls['motor-speed']});ui.refresh();redraw();},
  colorMixing:value=>sim?.setSettings({colorMixing:value}),
  tool:tool=>{editor.setTool(tool);redraw();},material:materialControls,finishPolygon:()=>editor.guard(()=>editor.finishPolygon()),cancel:()=>{editor.cancel();redraw();},
  select:id=>editor.select(editor.records.find(r=>r.id===id)),move:()=>editor.guard(()=>editor.move(editor.selected,controls['object-x'],controls['object-y'])),enabled:v=>editor.guard(()=>editor.setEnabled(v)),apply:()=>editor.guard(()=>editor.applySelected()),remove:()=>editor.guard(()=>editor.remove(editor.selected)),
  materialParameter:(key,value)=>editor.guard(()=>{sim?.setMaterial(controls.material,{[key==='friction-angle'?'frictionAngle':key]:value});needsStep=true;redraw();}),
  gravity:value=>{sim?.setSettings({gravity:value});velocityVector?.Set(0,-value);if(world)B.b2World_SetGravity(world,velocityVector);needsStep=true;},
  physics:(key,value)=>{sim?.setSettings({[{'fluid-hz':'hz','solid-hz':'solidHz','rigid-hz':'rigidHz',quality:'iterations'}[key]]:value});needsStep=true;},
  feedback:value=>sim?.setSettings({feedback:value}),view:value=>{if(sim)sim.renderer.mode=value;redraw();},redraw,
  scene:name=>{ui.pane.expanded=false;loadScene(name,{historyMode:'push'}).catch(showError);},
});
document.addEventListener('keydown',event=>{if(['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement.tagName))return;if(event.code==='Space'){event.preventDefault();pause();return;}if(event.key==='Escape'){editor.cancel();ui.pane.expanded=false;redraw();return;}if(event.key==='Enter'&&editor.polygon.length){editor.guard(()=>editor.finishPolygon());return;}if(['Delete','Backspace'].includes(event.key)){editor.guard(()=>editor.remove(editor.selected));return;}const tool={s:'stir',b:'paint',r:'box',c:'circle',p:'polygon',e:'emitter',d:'drain',x:'erase',o:'obstacle',f:'body',v:'select',a:'area',h:'pan'}[event.key.toLowerCase()];if(tool){editor.setTool(tool);ui.refresh();redraw();}});
window.addEventListener('popstate',()=>{if(B)loadScene(sampleFromURL(location.href)).catch(showError);});
document.addEventListener('visibilitychange',()=>{lastTime=performance.now();});
window.smooshLab={get sim(){return sim;},get box2d(){return B;},get world(){return world;},get mechanisms(){return mechanisms;},get errors(){return errors;},get scene(){return scene;},get busy(){return busy;},controls,camera,ui,editor,loadScene,benchmark,pause,redraw};
try{const threaded=params.get('threading')==='1'&&globalThis.crossOriginIsolated,entry=threaded?'../vendor/box2d3-wasm/build/dist/es/entry.mjs':'../vendor/box2d3-wasm/build/dist/es/compat/Box2D.compat.mjs';const [factory,context]=await Promise.all([import(entry),createDevice()]);useDevice(context);B=await factory.default({pthreadCount:2});velocityVector=new B.b2Vec2(0,0);await loadScene(sampleFromURL(location.href));if(params.get('gui')==='open')ui.pane.expanded=true;requestAnimationFrame(tick);}catch(error){busy=false;ui.busy(false);showError(error);}
