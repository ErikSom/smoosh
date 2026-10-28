export default function connected(sim) {
  sim.addArea('reservoir', { x: 2, y: 8, width: 10, height: 10 });
  sim.addArea('basin', { x: 15, y: 2, width: 15, height: 11 });
  sim.addArea('channel', { x: 10.5, y: 8, width: 5.5, height: 2 });
  sim.fill({ x: 3, y: 9, width: 8, height: 7 });
  sim.addEmitter({ type: 'circle', x: 4, y: 17, radius: 0.35, rate: 1200 });
  sim.addDrain({ type: 'circle', x: 28, y: 3, radius: 0.7 });
}
