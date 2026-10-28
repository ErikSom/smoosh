export default function sand(scene) {
  scene.domain.addArea('tank', { x: 1, y: 1, width: 30, height: 18 });
  scene.emitters.push({ type: 'circle', x: 16, y: 17, radius: 0.45, material: 'sand', rate: 5000, velocity: [0, -1] });
  scene.bodies.push(
    { x: 12, y: 9, width: 10, height: 0.5, static: true, angle: -0.28 },
    { x: 22, y: 4, width: 6, height: 0.5, static: true, angle: 0.15 },
  );
  scene.description = 'Granular PB-MPM sand falling over Box2D ramps.';
}
