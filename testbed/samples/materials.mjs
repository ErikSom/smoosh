export default function materials(scene) {
  scene.domain.addArea('tank', { x: 1, y: 1, width: 30, height: 18 });
  const materials = ['water', 'syrup', 'rubber', 'sand', 'putty'];
  for (const [i, material] of materials.entries()) {
    scene.fill.push({ x: 2 + i * 5.8, y: 11, width: 3.8, height: 4, material });
    if (i < 4) scene.bodies.push({ x: 6.8 + i * 5.8, y: 10, width: 0.2, height: 18, static: true });
  }
  scene.description = 'Same-sized blocks, different PB-MPM models: water, syrup, elastic rubber, sand and viscoplastic putty.';
}
