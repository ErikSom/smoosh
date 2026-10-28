export default function minimal(sim) {
  sim.addArea('tank', { x: 1, y: 1, width: 30, height: 18 });
  sim.fill({ x: 2, y: 2, width: 8, height: 10 });
  sim.addEmitter({ type: 'circle', x: 6, y: 17, radius: 0.4, rate: 1600, velocity: [2, -1] });
  sim.addDrain({ type: 'circle', x: 28, y: 2, radius: 0.7 });
}
