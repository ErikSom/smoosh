export default function rubber(scene) {
  scene.domain.addArea('tank', { x: 1, y: 1, width: 30, height: 18 });
  scene.fill.push({ x: 11, y: 10, width: 6, height: 6, material: 'rubber' });
  scene.bodies.push({ x: 12, y: 3, width: 11, height: 0.5, static: true, angle: 0.15 });
  scene.description = 'PB-MPM elastic block dropped onto a Box2D ramp. Stir or grab the block to stretch it.';
}
