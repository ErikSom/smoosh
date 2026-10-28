export default function cascade(scene) {
  // The channel is an ordinary area overlapping both basins.
  scene.domain.addArea('reservoir', { x: 2, y: 8, width: 10, height: 10 });
  scene.domain.addArea('basin', { x: 15, y: 2, width: 15, height: 11 });
  scene.domain.addArea('channel', { x: 10.5, y: 8, width: 5.5, height: 2 });
  scene.fill.push(
    { x: 2.7, y: 8.5, width: 8.6, height: 6.3 },
    { x: 15.6, y: 2.5, width: 13.7, height: 2.5 },
  );
  scene.emitters.push({ type: 'circle', x: 4.2, y: 16.8, radius: 0.35, velocity: [2.4, -1.3], rate: 2400 });
  scene.drains.push({ type: 'circle', x: 28.6, y: 3.1, radius: 0.65 });
  scene.gate = { x: 13.1, y: 9, width: 0.35, height: 2.2 };
  scene.bodies.push(
    { x: 7.5, y: 14, width: 1.6, height: 1, angle: 0.12 },
    { x: 9.8, y: 12, radius: 0.55 },
    { x: 22, y: 6.8, width: 1.8, height: 0.85, angle: -0.15 },
  );
  scene.description = 'A reservoir spills through a connecting channel into a lower basin. The liquid pushes back on floating Box2D bodies.';
}
