import { Smoosh } from '../dist/index.mjs';
import Box2DFactory from '../vendor/box2d3-wasm/build/dist/es/compat/Box2D.compat.mjs';

const canvas = document.querySelector('canvas'), status = document.querySelector('#status');
let sim, box2d, worldId, previous, frameId, paused = false;
try {
  box2d = await Box2DFactory();
  const definition = box2d.b2DefaultWorldDef(); definition.gravity.y = -9.81;
  worldId = box2d.b2CreateWorld(definition); definition.delete();
  sim = await Smoosh.create({ box2d, worldId, canvas, domainWalls: true,
    width: 32, height: 20, cellSize: 0.125, maxParticles: 131072,
    onError: error => { status.textContent = error.message; },
  });
  sim.renderer.mode = 'surface';
  const scene = await import(`./${document.body.dataset.scene}/scene.mjs`);
  scene.default(sim);
  let drag;
  const point = event => { const r = canvas.getBoundingClientRect(); return { x: (event.clientX-r.left)/r.width*32, y: (1-(event.clientY-r.top)/r.height)*20 }; };
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId); drag = { ...point(event), time: event.timeStamp, id: event.pointerId };
    Object.assign(sim.pointer, point(event), { active: true, mode: 'grab', vx: 0, vy: 0 });
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const p = point(event), dt = Math.max(0.005, (event.timeStamp-drag.time)/1000);
    Object.assign(sim.pointer, p, { vx: Math.max(-12,Math.min(12,(p.x-drag.x)/dt)), vy: Math.max(-12,Math.min(12,(p.y-drag.y)/dt)) });
    drag = { ...p, time: event.timeStamp, id: event.pointerId };
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(type, () => { sim.pointer.active=false; drag=null; });
  const frame = now => {
    const dt = previous == null ? 0 : (now - previous) / 1000; previous = now;
    try {
      if (!document.hidden) sim.advance(paused ? 0 : dt);
      status.textContent = `${sim.stats.particles.toLocaleString()} particles | material ${sim.simulationHz} Hz | Box2D ${sim.settings.rigidHz} Hz`;
      frameId = requestAnimationFrame(frame);
    } catch (error) { status.textContent = error.message; window.smooshExampleError = error.message; }
  };
  document.querySelector('#pause').onclick = event => { paused = !paused; event.target.textContent = paused ? 'Play' : 'Pause'; };
  document.querySelector('#reset').onclick = () => sim.reset();
  document.addEventListener('visibilitychange', () => { previous = undefined; });
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(frameId); sim.destroy(); box2d.b2DestroyWorld(worldId);
  }, { once: true });
  window.smooshExample = { sim, box2d, worldId };
  frameId = requestAnimationFrame(frame);
} catch (error) { status.textContent = error.message; window.smooshExampleError = error.message; }
