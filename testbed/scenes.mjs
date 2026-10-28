import { SimulationDomain } from '../dist/index.mjs';
import sandbox from './samples/sandbox.mjs';
import materials from './samples/materials.mjs';
import dam from './samples/dam.mjs';
import rubber from './samples/rubber.mjs';
import press from './samples/press.mjs';
import sand from './samples/sand.mjs';
import cascade from './samples/cascade.mjs';
import overlap from './samples/overlap.mjs';
import stress from './samples/stress.mjs';
import mixer from './samples/mixer.mjs';
import tumbler from './samples/tumbler.mjs';
import manyTumblers from './samples/many-tumblers.mjs';
import pyramids from './samples/pyramids.mjs';
import pistons from './samples/pistons.mjs';
import colorMixer from './samples/color-mixer.mjs';
import clayPress from './samples/clay-press.mjs';
import compression from './samples/compression.mjs';
export { createDomainWalls } from '../dist/index.mjs';
export { createBody } from './bodies.mjs';

export const SCENE_GROUPS={
  Basics:[['sandbox','Empty sandbox'],['materials','Material comparison'],['dam','Dam break']],
  Materials:[['rubber','Rubber drop'],['press','Plastic press'],['sand','Sand ramps']],
  Machines:[['color-mixer','Colour mixer'],['clay-press','Clay extrusion press'],['mixer','Motor mixer'],['pistons','Pumps + waterwheel'],['compression','Water compression']],
  Areas:[['cascade','Connected basins'],['overlap','Overlapping areas']],
  Benchmarks:[['tumbler','Liquid tumbler'],['many-tumblers','Six tumblers'],['pyramids','Flooded pyramids'],['stress','Particle stress test']],
};
export const SCENE_NAMES=Object.values(SCENE_GROUPS).flatMap(entries=>entries.map(([name])=>name));

export const DEFAULT_SCENE = 'pistons';
const builders = { sandbox, materials, dam, rubber, press, sand, cascade, overlap, stress, mixer, tumbler, 'many-tumblers': manyTumblers, pyramids, pistons, 'color-mixer': colorMixer, 'clay-press': clayPress, compression };

// Sample files contain the setup; the runner owns the world and its cleanup.
export function createScene(name = DEFAULT_SCENE) {
  if (!SCENE_NAMES.includes(name)) name = DEFAULT_SCENE;
  const scene = {
    name, domain: new SimulationDomain({ width: 32, height: 20, cellSize: 0.125 }),
    maxParticles: 131072, source: `testbed/samples/${name}.mjs`,
    bodies: [], gate: null, fill: [], emitters: [], drains: [], kinematics: [], joints: [],
  };
  builders[name](scene);
  return scene;
}
