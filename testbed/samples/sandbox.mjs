export default function sandbox(scene) {
  scene.domain.addArea('tank', { x: 1, y: 1, width: 30, height: 18 });
  scene.description = 'Draw material or place sources, drains and Box2D bodies.';
}
