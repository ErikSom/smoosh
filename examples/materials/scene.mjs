export default function materials(sim) {
  for (const [i, material] of ['water', 'syrup', 'rubber', 'sand', 'putty'].entries()) {
    sim.addArea(material, { x: 1 + i * 6, y: 1, width: 5.5, height: 18 });
    sim.fill({ x: 2 + i * 6, y: 11, width: 3.5, height: 4, material });
  }
}
