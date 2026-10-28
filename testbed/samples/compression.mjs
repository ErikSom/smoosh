import { SimulationDomain } from '../../dist/index.mjs';
import { addBody } from './helpers.mjs';

// Identical force-limited pistons: empty cylinder on the left, water on the right.
// Open the gate to release the water through the right cylinder's bottom outlet.
export default function compression(scene) {
  scene.title = 'Water compression';
  scene.maxParticles = 16384;
  scene.domain = new SimulationDomain({ width: 16, height: 10, cellSize: 0.125 });
  scene.domain.addArea('tank', { x: 0.5, y: 0.5, width: 15, height: 9 });
  const bottom = 2.5, pistonBottom = 3, pistonTop = 7.3;
  scene.compression = {
    pistons: [], bottom, pistonBottom, pistonTop,
    chamber: { x: 9.5, y: 2.65, width: 4, height: 4.5 },
  };

  for (const [side, x] of [4.5, 11.5].entries()) {
    const floor = side === 0
      ? [{ y: bottom - 5, width: 4.6, height: 0.3 }]
      : [{ x: -1.35, y: bottom - 5, width: 1.9, height: 0.3 },
         { x: 1.35, y: bottom - 5, width: 1.9, height: 0.3 }];
    addBody(scene, {
      x, y: 5, static: true, color: '#89949d',
      fixtures: [
        { x: -2.15, width: 0.3, height: 5.3 },
        { x: 2.15, width: 0.3, height: 5.3 },
        ...floor,
      ],
    });
    const body = addBody(scene, {
      x, y: pistonTop, density: 10, angularDamping: 1, color: '#c5a16c',
      fixtures: [{ width: 3.96, height: 0.3 }, { y: 0.55, width: 0.2, height: 0.8 }],
    });
    scene.compression.pistons.push(body);
    scene.joints.push({
      type: 'prismatic', body, anchor: [x, pistonBottom], axis: [0, 1],
      lower: 0, upper: pistonTop - pistonBottom,
      speed: -0.7, maxForce: 250, autoReverse: false,
    });
  }

  scene.fill.push({ x: 9.6, y: 2.75, width: 3.8, height: 3.5, color: [0.08, 0.5, 0.95] });
  scene.gate = { x: 11.5, y: bottom, width: 0.85, height: 0.325 };
  scene.gateClosed = true;
  scene.description = 'Left: empty cylinder. Right: sealed water. Identical motors push both pistons down. Open Gate to release the water; Reverse motors retracts both pistons.';
}
