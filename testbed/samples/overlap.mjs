export default function overlap(scene) {
  scene.domain.addArea('left', { x: 2, y: 2, width: 16, height: 16 });
  scene.domain.addArea('right', { x: 14, y: 2, width: 16, height: 13 });
  scene.fill.push(
    { x: 2.8, y: 2.8, width: 10, height: 11 },
    { x: 19, y: 2.8, width: 10, height: 2 },
  );
  scene.emitters.push({ type: 'circle', x: 6, y: 16, radius: 0.4, velocity: [1.6, -1], rate: 2400 });
  scene.drains.push({ type: 'circle', x: 28.5, y: 3.5, radius: 0.75 });
  scene.gate = { x: 16, y: 8.5, width: 0.35, height: 13.2 };
  scene.bodies.push(
    { x: 7, y: 14, width: 1.5, height: 1.2 },
    { x: 10, y: 11, radius: 0.6 },
    { x: 25, y: 7, width: 2, height: 0.8 },
  );
  scene.description = 'Two areas overlap by four metres. Their shared space belongs to one liquid domain, so particles cross the seam without being copied or counted twice.';
}
