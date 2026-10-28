# Smoosh

GPU liquids and soft materials for Box2D 3. Paint water, rubber, sand and clay, then interact with them using rigid bodies and motors.

**[Testbed](https://eriksom.github.io/smoosh/testbed/)** · **[Examples](https://eriksom.github.io/smoosh/examples/)** · **[Docs](https://eriksom.github.io/smoosh/docs/)**

Try the colour mixer, clay extrusion press, piston pumps or six rotating tumblers. The fullscreen testbed supports touch; settings live under **Simulation** and **Samples**. Requires WebGPU.

## Run locally

```sh
git clone https://github.com/ErikSom/smoosh.git
cd smoosh
npm ci
npm run serve
```

Open [localhost:4179](http://127.0.0.1:4179/). Requires Node 22 or newer.

## Use in your project

```sh
npm install github:ErikSom/smoosh box2d3-wasm@5.2.0
```

Pass your Box2D module, world and canvas:

```js
import { Smoosh } from '@smoosh/box2d';

const sim = await Smoosh.create({ box2d, worldId, canvas, domainWalls: true });
sim.addArea('tank', { x: 1, y: 1, width: 30, height: 18 });
sim.fill({ x: 2, y: 2, width: 8, height: 10 });
sim.adapter.addBody(bodyId);

// Each frame:
sim.advance(deltaSeconds);
```

See the [minimal example](examples/minimal/scene.mjs) and [API](https://eriksom.github.io/smoosh/docs/api.html) for emitters, drains, colours and connected areas.

## Development

```sh
npm test
npm run test:gpu
npm run build:site
```

Experimental. Built on [EA PB-MPM](https://github.com/electronicarts/pbmpm) and [box2d3-wasm](https://github.com/Birch-san/box2d3-wasm). [MIT integration](LICENSE) · [BSD shader licence](LICENSE-PBMPM.md).
