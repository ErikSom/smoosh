export default function dam(scene) {
  scene.domain.addArea('tank', { x: 1, y: 1, width: 30, height: 18 });
  scene.fill.push({ x: 1.5, y: 1.5, width: 8, height: 14, material: 'water' });
  scene.gate = { x: 10, y: 8.2, width: 0.3, height: 14.5 };
  scene.gateClosed = true;
  scene.bodies.push({ x: 20, y: 4, width: 1.5, height: 1 }, { x: 24, y: 4, radius: 0.8 });
  scene.description = 'PB-MPM dam break with a Box2D gate and floating bodies. Open the gate to release it.';
}
