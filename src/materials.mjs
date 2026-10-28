// PB-MPM constitutive models. Profiles share a model but retain independent
// mechanical parameters in GPU uniforms, including when they coexist.
export const MATERIALS = Object.freeze([
  Object.freeze({ name: 'water', label: 'Water', model: 0, viscosity: 0.015, relaxation: 1.2, elasticity: 0, plasticity: 0, frictionAngle: 35, density: 1, stiffness: 1, color: [0.12, 0.55, 0.95] }),
  Object.freeze({ name: 'syrup', label: 'Syrup', model: 0, viscosity: 0.45, relaxation: 1.2, elasticity: 0, plasticity: 0, frictionAngle: 35, density: 1.2, stiffness: 1, color: [0.95, 0.5, 0.08] }),
  Object.freeze({ name: 'rubber', label: 'Elastic / rubber', model: 1, viscosity: 0, relaxation: 1.2, elasticity: 0.08, plasticity: 0, frictionAngle: 35, density: 1, stiffness: 1.5, color: [0.24, 0.84, 0.3] }),
  Object.freeze({ name: 'sand', label: 'Sand', model: 2, viscosity: 0.015, relaxation: 1.2, elasticity: 0.5, plasticity: 0, frictionAngle: 35, density: 1.5, stiffness: 1.5, color: [0.8, 0.68, 0.3] }),
  Object.freeze({ name: 'putty', label: 'Viscoplastic / putty', model: 3, viscosity: 0.1, relaxation: 1.2, elasticity: 0.25, plasticity: 0.85, frictionAngle: 35, density: 1.1, stiffness: 1.5, color: [0.84, 0.25, 0.65] }),
]);

export function materialIndex(name = 'water') {
  const index = MATERIALS.findIndex(material => material.name === name);
  if (index < 0) throw new TypeError(`Unknown material: ${name}`);
  return index;
}

export function validateMaterial(changes) {
  const ranges = { viscosity: [0,1], relaxation: [0.01,2], elasticity: [0,1], plasticity: [0,1], frictionAngle: [0,80], stiffness: [0.01,2] };
  for (const [name, value] of Object.entries(changes)) {
    if(name==='color'){validateColor(value);continue;}
    const range = ranges[name];
    if (!range || !Number.isFinite(value) || value < range[0] || value > range[1]) throw new RangeError(`Invalid material property ${name}`);
  }
}

export function validateColor(color) {
  if(!Array.isArray(color)||color.length!==3||!color.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new RangeError('Color must contain three numbers between 0 and 1');
  return [...color];
}
