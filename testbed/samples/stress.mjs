import { SimulationDomain } from '../../dist/index.mjs';

export default function stress(scene) {
  scene.domain = new SimulationDomain({ width: 32, height: 20, cellSize: 0.08 });
  scene.maxParticles = 262144;
  scene.domain.addArea('tank', { x: 1, y: 1, width: 30, height: 18 });
  scene.fill.push({ x: 1.6, y: 1.6, width: 28.8, height: 12.5 });
  scene.emitters.push({ type: 'circle', x: 5, y: 17, radius: 0.5, velocity: [4, -2], rate: 2400 });
  scene.drains.push({ type: 'circle', x: 29.5, y: 2.5, radius: 0.65 });
  for (let i = 0; i < 12; i++) {
    scene.bodies.push({ x: 4 + i % 6 * 4.5, y: 13 + Math.floor(i / 6) * 2.3, width: 1.2, height: 0.8, angle: i * 0.1 });
  }
  scene.description = 'A finer grid and more than 220,000 initial particles. Add other materials to test mixed simulation. The particle buffer has a hard capacity.';
}
