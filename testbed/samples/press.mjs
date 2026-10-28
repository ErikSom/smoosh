export default function press(scene) {
  scene.domain.addArea('tank', { x: 1, y: 1, width: 30, height: 18 });
  scene.fill.push({ x: 11, y: 1.5, width: 9, height: 6, material: 'putty' });
  scene.bodies.push({ x: 15.5, y: 12, width: 12, height: 1, kinematic: true });
  scene.kinematics.push({ bodyIndex: 0, baseY: 12, amplitude: 5.5, speed: 0.6 });
  scene.description = 'PB-MPM viscoplastic block squeezed by a moving Box2D press.';
}
