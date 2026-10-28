import { SimulationDomain, region } from './domain.mjs';
import { createDevice, ShaderLibrary, buffer, bindGroup } from './gpu.mjs';
import { Box2DAdapter } from './box2d-adapter.mjs';
import { DomainWalls } from './domain-walls.mjs';
import { LiquidRenderer } from './renderer.mjs';
import { MATERIALS, materialIndex, validateMaterial, validateColor } from './materials.mjs';
import { MAX_BODIES, RIGID_WORDS, RIGID_SHAPES_OFFSET, PARTICLE_WORDS, SHAPE_WORDS, UNIFORM_BYTES, BUCKET_SIZE, FEEDBACK_BYTES, FEEDBACK_TOTAL_OFFSET, FEEDBACK_INERTIA_OFFSET, writeUniform } from './layout.mjs';

const COMPUTE = ['particleEmit', 'rescaleParticles', 'setIndirectArgs', 'bukkitCount', 'bukkitAllocate', 'bukkitInsert', 'rigidbody2g', 'bodyBegin', 'bodyUpdate', 'gridUpdate', 'g2p2g', 'colorScatter', 'colorMix'];
const MAX_ITERATIONS = 8, MAX_SHAPES = 64;
const defaults = { hz: 120, solidHz: 480, rigidHz: 60, iterations: 5, gravity: 9.81, viscosity: 0.015, relaxation: 1.2, friction: 0.02, particlesPerCellAxis: 2, density: 1000, depth: 0.15, feedback: true, colorMixing: 0 };

export class Smoosh {
  static async create(options = {}) {
    const domain = options.domain instanceof SimulationDomain ? options.domain : new SimulationDomain(options);
    const gpu = options.device ? { device: options.device, timestamps: options.device.features.has('timestamp-query') } : await createDevice();
    let sim;
    try { sim = new Smoosh(domain, gpu, options); await sim.initialize(options); return sim; }
    catch (error) {
      if (sim) sim.destroy(); else if (!options.device) gpu.device.destroy();
      throw error;
    }
  }

  constructor(domain, gpu, options) {
    this.domain = domain; this.device = gpu.device; this.adapterInfo = gpu.adapter?.info;
    this.ownsDevice = !options.device; this.timestamps = gpu.timestamps;
    this.maxParticles = options.maxParticles ?? 131072; this.maxSubsteps = options.maxSubsteps ?? 8;
    if (!Number.isInteger(this.maxParticles) || this.maxParticles < 1 || this.maxParticles > 1_000_000) throw new RangeError('maxParticles must be an integer between 1 and 1,000,000');
    if (!Number.isInteger(this.maxSubsteps) || this.maxSubsteps < 1 || this.maxSubsteps > 8) throw new RangeError('maxSubsteps must be an integer between 1 and 8');
    this.settings = { ...defaults }; this.setSettings(options.settings ?? {});
    this.materials = MATERIALS.map(m => ({ ...m, color: [...m.color] })); this.hasSolids = false;
    this.pointer = { x: 0, y: 0, vx: 0, vy: 0, radius: 1.1, active: false, mode: 'grab' };
    this.frame = 0; this.time = 0; this.accumulator = 0; this.epoch = 0; this.buffers = {}; this.groups = [];
    this.rigidAccumulator = 0; this.rigidTime = 0;
    this.lastSimulationHz = null;
    this.gridIndex = 0; this.shapes = []; this.shapesDirty = true; this.uploadedDomainVersion = -1;
    this.stats = { particles: 0, highWater: 0, emitted: 0, drained: 0, rejected: 0, cpuMs: 0, box2dMs: 0, rigidSteps: 0, gpuMs: null, gpuBytes: 0, bufferCount: 0, droppedSeconds: 0, skippedReadbacks: 0, deferredFrames: 0, errors: [] };
    this.bucketX = Math.ceil(domain.gridWidth / BUCKET_SIZE); this.bucketY = Math.ceil(domain.gridHeight / BUCKET_SIZE); this.bucketCount = this.bucketX * this.bucketY;
    this.bucketParticleOffset = (Math.ceil(this.maxParticles / 64) + this.bucketCount) * 4;
    this.shapeData = new Float32Array(MAX_SHAPES * SHAPE_WORDS);
    this.uniformData = new ArrayBuffer(this.maxSubsteps * MAX_ITERATIONS * UNIFORM_BYTES);
    this.uniformF = new Float32Array(this.uniformData); this.uniformU = new Uint32Array(this.uniformData);
    this.readbacks = []; this.pendingImpulses = new Int32Array(MAX_BODIES * 4);
    this.hasPendingImpulses = false;
    this.onError = options.onError ?? (() => {});
    this.errorListener = event => this.reportError(event.error);
    this.device.addEventListener('uncapturederror', this.errorListener);
    this.device.lost.then(info => { if (!this.destroyed && info.reason !== 'destroyed') this.reportError(new Error(`WebGPU device lost: ${info.message}`)); });
  }

  setSettings(changes) {
    const next = { ...this.settings, ...changes };
    for (const key of ['hz', 'solidHz', 'rigidHz', 'iterations', 'gravity', 'viscosity', 'relaxation', 'friction', 'particlesPerCellAxis', 'density', 'depth', 'colorMixing']) {
      if (!Number.isFinite(next[key])) throw new TypeError(`${key} must be finite`);
    }
    if (!(next.hz >= 30 && next.hz <= 500)) throw new RangeError('hz must be between 30 and 500');
    if (next.solidHz !== 0 && !(next.solidHz >= 30 && next.solidHz <= 500)) throw new RangeError('solidHz must be 0 or between 30 and 500');
    if (!(next.rigidHz >= 30 && next.rigidHz <= 240)) throw new RangeError('rigidHz must be between 30 and 240');
    if (!Number.isInteger(next.iterations) || next.iterations < 2 || next.iterations > MAX_ITERATIONS) throw new RangeError('iterations must be between 2 and 8');
    if (!Number.isInteger(next.particlesPerCellAxis) || next.particlesPerCellAxis < 1 || next.particlesPerCellAxis > 4) throw new RangeError('particlesPerCellAxis must be between 1 and 4');
    if (this.frame && next.particlesPerCellAxis !== this.settings.particlesPerCellAxis) throw new Error('Reset before changing particlesPerCellAxis');
    if (next.gravity < 0 || next.viscosity < 0 || next.viscosity > 1 || next.relaxation <= 0 || next.relaxation > 2 || next.friction < 0 || next.friction > 1 || next.density <= 0 || next.depth <= 0) throw new RangeError('Invalid liquid settings');
    if(next.colorMixing<0||next.colorMixing>30)throw new RangeError('colorMixing must be between 0 and 30 per second');
    this.settings = next;
  }

  get simulationHz() { return this.hasSolids ? Math.max(this.settings.hz, this.settings.solidHz) : this.settings.hz; }
  get gpuBusy() {
    const limit = this.adapter?.bodyCount && this.settings.feedback ? 1 : this.readbacks.length;
    let pending = 0;
    for (const slot of this.readbacks) if (slot.pending && ++pending >= limit) return true;
    return false;
  }

  async initialize(options) {
    const d = this.device, U = GPUBufferUsage;
    const storage = U.STORAGE | U.COPY_DST;
    const alloc = (name, bytes, usage = storage, initial) => {
      const b = buffer(d, name, bytes, usage, initial); this.buffers[name] = b;
      this.stats.gpuBytes += b.size; this.stats.bufferCount++; return b;
    };
    const gridBytes = this.domain.gridWidth * this.domain.gridHeight * 32;
    if (gridBytes > d.limits.maxStorageBufferBindingSize || this.maxParticles * PARTICLE_WORDS * 4 > d.limits.maxStorageBufferBindingSize) throw new Error('This simulation exceeds the GPU storage buffer limit');
    alloc('particles', this.maxParticles * PARTICLE_WORDS * 4, storage | U.COPY_SRC);
    alloc('count', 16, storage | U.COPY_SRC, new Uint32Array([0,this.maxParticles,0,0]));
    alloc('free', (this.maxParticles + 4) * 4, storage | U.COPY_SRC);
    alloc('simArgs', 16, storage | U.INDIRECT, new Uint32Array([0,1,1,0]));
    alloc('renderArgs', 16, storage | U.INDIRECT | U.COPY_SRC, new Uint32Array([4,0,0,0]));
    alloc('bucketArgs', 16, storage | U.INDIRECT, new Uint32Array([0,1,1,0]));
    alloc('blankArgs', 16, U.COPY_SRC | U.COPY_DST, new Uint32Array([0,1,1,0]));
    alloc('grid0', gridBytes); alloc('grid1', gridBytes);
    alloc('domain', this.domain.gridWidth * this.domain.gridHeight * 16);
    alloc('bodyGrid', this.domain.gridWidth * this.domain.gridHeight * 32);
    alloc('shapes', MAX_SHAPES * SHAPE_WORDS * 4);
    alloc('rigid', RIGID_WORDS * 4);
    alloc('forces', FEEDBACK_BYTES, storage | U.COPY_SRC);
    alloc('bodyBuckets', this.bucketCount * 8);
    alloc('bodyIndices', this.bucketCount * MAX_BODIES * 4);
    alloc('bucketCount', this.bucketCount * 4); alloc('bucketInsertCount', this.bucketCount * 4);
    alloc('bucketStarts', this.bucketCount * 4); alloc('bucketAllocator', 16, storage | U.COPY_SRC);
    // Headers and compact particle IDs share one read-only solver binding.
    alloc('bucketData', (this.bucketParticleOffset + this.maxParticles) * 4);
    alloc('gridArgs', 16, storage | U.INDIRECT | U.COPY_SRC, new Uint32Array([0,1,1,0]));
    alloc('gridBuckets', this.bucketCount * 4);
    alloc('uniforms', this.uniformData.byteLength, U.UNIFORM | U.COPY_DST);
    if (this.timestamps) {
      this.querySet = d.createQuerySet({ type: 'timestamp', count: 4 });
      alloc('timestampResolve', 256, U.QUERY_RESOLVE | U.COPY_SRC);
    }
    const readbackSize = 32 + MAX_BODIES * 16 + 32;
    for (let i = 0; i < 3; i++) this.readbacks.push({ buffer: alloc(`readback${i}`, readbackSize, U.COPY_DST | U.MAP_READ), pending: false });
    this.shaders = new ShaderLibrary(options.shaderBaseURL);
    // Both variants share an explicit layout, so their cached binding groups
    // can be reused. Water-only worlds compile away SVD and plasticity code.
    const solveLayout = d.createBindGroupLayout({ entries: Array.from({length:9}, (_,binding) => ({
      binding, visibility: GPUShaderStage.COMPUTE,
      buffer: { type: binding === 0 ? 'uniform' : [2,4,5,7,8].includes(binding) ? 'read-only-storage' : 'storage' },
    })) });
    const solvePipelineLayout = d.createPipelineLayout({ bindGroupLayouts: [solveLayout] });
    this.pipelines = Object.fromEntries(await Promise.all(COMPUTE.map(async name => {
      const module = await this.shaders.module(d, name);
      const layout = name === 'g2p2g' ? solvePipelineLayout : 'auto';
      const pipeline = await d.createComputePipelineAsync({ label: `Smoosh ${name}`, layout, compute: { module, entryPoint: 'csMain' } });
      if (name === 'g2p2g') this.solidPipeline = await d.createComputePipelineAsync({
        label: 'Smoosh mixed materials', layout, compute: { module, entryPoint: 'csMain', constants: { enableSolidMaterials: true } },
      });
      return [name, pipeline];
    })));
    this.createGroups();
    if (options.box2d) this.attachBox2D(options.box2d, options.worldId, { native: options.nativeBridge !== false, domainWalls: options.domainWalls });
    if (options.canvas) this.renderer = await LiquidRenderer.create(this, options.canvas, this.shaders);
    this.uploadDomain();
  }

  createGroups() {
    const b = this.buffers;
    this.indirectGroup = bindGroup(this.device, this.pipelines.setIndirectArgs, [b.count, b.simArgs, b.renderArgs, b.free]);
    for (let slot = 0; slot < this.maxSubsteps * MAX_ITERATIONS; slot++) {
      const uniform = { buffer: b.uniforms, offset: slot * UNIFORM_BYTES, size: UNIFORM_BYTES };
      const group = (name, resources) => bindGroup(this.device, this.pipelines[name], [uniform, ...resources]);
      this.groups.push({
        emit: [b.grid0, b.grid1].map(grid => group('particleEmit', [b.count, b.particles, b.shapes, b.free, grid, b.domain])),
        rescale: group('rescaleParticles', [b.count, b.particles]),
        count: group('bukkitCount', [b.count, b.particles, b.bucketCount]),
        allocate: group('bukkitAllocate', [b.bucketCount, b.bucketArgs, b.bucketData, b.bucketAllocator, b.bucketStarts, b.gridArgs, b.gridBuckets]),
        insert: group('bukkitInsert', [b.count, b.bucketInsertCount, b.particles, b.bucketData, b.bucketStarts]),
        beginBody: slot === 0 ? group('bodyBegin', [b.rigid, b.forces]) : null,
        updateBody: group('bodyUpdate', [b.rigid, b.forces]),
        raster: group('rigidbody2g', [b.rigid, b.bodyGrid, b.bodyBuckets, b.bodyIndices]),
        update: [b.grid0, b.grid1].map(grid => group('gridUpdate', [grid, b.shapes, b.rigid, b.bodyGrid, b.forces, b.domain, b.gridBuckets, b.gridArgs])),
        solve: [b.grid0, b.grid1].map((grid, index) => group('g2p2g', [b.particles, grid, index ? b.grid0 : b.grid1, b.bucketData, b.shapes, b.free, b.rigid, b.domain])),
      });
    }
  }

  attachBox2D(box2d, worldId, options) {
    const adapter = new Box2DAdapter(box2d, worldId, this.domain, options);
    let walls;
    try { if (options?.domainWalls) walls = new DomainWalls(box2d, worldId, this.domain); }
    catch (error) { adapter.destroy(); throw error; }
    this.walls?.destroy(); this.adapter?.destroy(); this.adapter = adapter; this.walls = walls;
    this.pendingImpulses.fill(0); this.hasPendingImpulses = false;
    this.rigidAccumulator = 0; this.rigidTime = this.time; this.lastBodyStateVersion = null; return this.adapter;
  }
  addArea(id, r) { return this.domain.addArea(id, r); }
  setMaterial(name, changes) {
    const index = materialIndex(name); validateMaterial(changes);
    Object.assign(this.materials[index], changes);
    if(changes.color){this.materials[index].color=validateColor(changes.color);this.shapesDirty=true;}
    if (index === 0) this.setSettings({ viscosity: changes.viscosity ?? this.settings.viscosity, relaxation: changes.relaxation ?? this.settings.relaxation });
  }
  addShape(kind, options) {
    if (this.shapes.length >= MAX_SHAPES) throw new RangeError(`Smoosh supports ${MAX_SHAPES} emitters, drains and fills`);
    const shape = region({ ...options, kind, material: options.material ?? 'water', rate: options.rate ?? 1200, velocity: options.velocity ?? [0, 0], rotation: options.rotation ?? 0, spawnFrame: kind === 'burst' ? this.frame : 0 });
    const material = materialIndex(shape.material);
    if(shape.color!==undefined)shape.color=validateColor(shape.color);
    if (!Number.isFinite(shape.rate) || shape.rate < 0 || shape.rate > 1_000_000) throw new RangeError('Emitter rate must be between 0 and 1,000,000 particles/s');
    if (!Array.isArray(shape.velocity) || shape.velocity.length !== 2 || !shape.velocity.every(Number.isFinite) || !Number.isFinite(shape.rotation)) throw new TypeError('Emitter velocity and rotation must be finite');
    if (this.materials[material].model !== 0) this.hasSolids = true;
    this.shapes.push(shape); this.shapesDirty = true; return shape;
  }
  addEmitter(options) { return this.addShape('emitter', options); }
  addDrain(options) { return this.addShape('drain', options); }
  pour(options) { return this.addShape('burst', options); }
  erase(options) { return this.addShape('erase', options); }
  fill(options) {
    if (this.frame) throw new Error('Add initial fills before the first step, or reset first');
    return this.addShape('fill', options);
  }
  updateShape(shape, changes) {
    if (!this.shapes.includes(shape)) throw new Error('Shape does not belong to this Smoosh instance');
    const validated = region({ ...shape, ...changes });
    const material = materialIndex(validated.material);
    if(validated.color!==undefined)validated.color=validateColor(validated.color);
    if (!Number.isFinite(validated.rate) || validated.rate < 0 || validated.rate > 1_000_000 || !validated.velocity.every(Number.isFinite)) throw new RangeError('Invalid emitter settings');
    if (this.materials[material].model !== 0) this.hasSolids = true;
    Object.assign(shape, validated); this.shapesDirty = true;
  }
  removeShape(shape) { const i = this.shapes.indexOf(shape); if (i >= 0) { this.shapes.splice(i, 1); this.shapesDirty = true; } }

  uploadDomain() {
    if (this.uploadedDomainVersion === this.domain.version) return;
    this.walls?.sync();
    this.device.queue.writeBuffer(this.buffers.domain, 0, this.domain.compile());
    this.uploadedDomainVersion = this.domain.version;
  }
  uploadShapes() {
    if (!this.shapesDirty) return;
    const c = this.domain.cellSize;
    for (let i = 0; i < this.shapes.length; i++) {
      const r = this.shapes[i], circle = r.type === 'circle', at = i * SHAPE_WORDS;
      const p = this.domain.toGrid(r.x + (circle ? 0 : r.width / 2), r.y + (circle ? 0 : r.height / 2));
      this.shapeData.set([p[0], p[1], circle ? 0 : r.width / c / 2, circle ? 0 : r.height / c / 2,
        circle ? r.radius / c : 0, r.rotation, r.kind === 'emitter' ? 0 : ['drain','erase'].includes(r.kind) ? 2 : 3, circle ? 1 : r.type === 'polygon' ? 2 : 0,
        materialIndex(r.material), r.rate, r.points?.length ?? 0, r.spawnFrame, r.velocity[0] / c, r.velocity[1] / c,
        (circle ? Math.PI * r.radius ** 2 : r.width * r.height) / c ** 2, +r.enabled], at);
      if (r.type === 'polygon') for (let j = 0; j < r.points.length; j++) {
        this.shapeData[at + 16 + j * 2] = (r.points[j][0] - r.x - r.width / 2) / c;
        this.shapeData[at + 17 + j * 2] = (r.points[j][1] - r.y - r.height / 2) / c;
      }
      this.shapeData.set(r.color??this.materials[materialIndex(r.material)].color,at+80);this.shapeData[at+83]=1;
    }
    this.device.queue.writeBuffer(this.buffers.shapes, 0, this.shapeData); this.shapesDirty = false;
  }

  emissionGroups(frame) {
    let count = 0;
    for (const r of this.shapes) {
      if (!r.enabled || r.kind === 'drain' || r.kind === 'erase') continue;
      if (r.kind === 'fill' || r.kind === 'burst') {
        if (frame !== r.spawnFrame) continue;
        const area = r.type === 'circle' ? Math.PI * r.radius ** 2 : r.width * r.height;
        count = Math.max(count, Math.ceil(area / this.domain.cellSize ** 2 * this.settings.particlesPerCellAxis ** 2));
      } else count = Math.max(count, Math.ceil(r.rate / this.simulationHz) + 1);
    }
    return Math.ceil(count / 64);
  }

  advance(deltaSeconds, options) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('deltaSeconds must be finite and nonnegative');
    if (this.destroyed) throw new Error('Smoosh has been destroyed');
    if (this.failure) throw this.failure;
    // Defer rather than advance Box2D with feedback from an older GPU frame.
    // This is asynchronous backpressure; it never blocks the main thread.
    if (this.gpuBusy) {
      this.stats.deferredFrames++; this.stats.droppedSeconds += deltaSeconds;
      return 0;
    }
    const available = this.accumulator + deltaSeconds;
    const hz = this.simulationHz;
    this.accumulator = Math.min(available, this.maxSubsteps / hz);
    this.stats.droppedSeconds += available - this.accumulator;
    const steps = Math.min(this.maxSubsteps, Math.floor((this.accumulator + 1e-9) * hz));
    this.accumulator -= steps / hz;
    this.step(steps, options); return steps;
  }

  step(steps = 1, { render = true, stepRigidBodies = true } = {}) {
    if (this.destroyed) throw new Error('Smoosh has been destroyed');
    if (this.failure) throw this.failure;
    if (!Number.isInteger(steps) || steps < 0 || steps > this.maxSubsteps) throw new RangeError(`steps must be between 0 and ${this.maxSubsteps}`);
    const start = performance.now(), d = this.device, b = this.buffers, hz = this.simulationHz;
    this.uploadDomain(); this.uploadShapes();
    if (!steps && !render) { this.stats.cpuMs = performance.now() - start; return; }
    if (steps && this.adapter) {
      const adapterStart = performance.now();
      this.applyPendingImpulses();
      if (stepRigidBodies) {
        const rigidDt = 1 / this.settings.rigidHz;
        this.rigidAccumulator += steps / hz;
        while (this.rigidAccumulator + 1e-9 >= rigidDt) {
          this.applyPendingImpulses();
          this.adapter.box2d.b2World_Step(this.adapter.worldId, rigidDt, 4);
          this.rigidAccumulator -= rigidDt; this.rigidTime += rigidDt; this.stats.rigidSteps++;
        }
      } else {
        this.applyPendingImpulses();
        this.rigidAccumulator = 0; this.rigidTime = this.time + steps / hz;
      }
      const dirty = this.adapter.geometryDirty;
      this.bodyHorizon = Math.max(Math.abs(this.time - this.rigidTime), Math.abs(this.time + steps / hz - this.rigidTime));
      const data = this.adapter.refresh(this.bodyHorizon);
      d.queue.writeBuffer(b.rigid, 0, data.buffer, 0, dirty ? data.byteLength : RIGID_SHAPES_OFFSET * 4);
      d.queue.writeBuffer(b.forces, FEEDBACK_INERTIA_OFFSET, this.adapter.inertias);
      d.queue.writeBuffer(b.bodyBuckets, 0, this.adapter.bucketInfo);
      if (this.adapter.usedBucketIndices) d.queue.writeBuffer(b.bodyIndices, 0, this.adapter.bucketIndices.buffer, 0, this.adapter.usedBucketIndices * 4);
      this.stats.box2dMs = performance.now() - adapterStart;
    }
    const mixColors=steps>0&&this.settings.colorMixing>0;
    this.colorMixingStrength=1-Math.exp(-this.settings.colorMixing*steps/hz);
    if(mixColors&&!b.colorGrid){
      const size=this.domain.gridWidth*this.domain.gridHeight*16;
      b.colorGrid=buffer(d,'liquid dye grid',size,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);
      this.stats.gpuBytes+=size;this.stats.bufferCount++;
      const uniform={buffer:b.uniforms,offset:0,size:UNIFORM_BYTES};
      this.colorScatterGroup=bindGroup(d,this.pipelines.colorScatter,[uniform,b.count,b.particles,b.colorGrid]);
      this.colorMixGroup=bindGroup(d,this.pipelines.colorMix,[uniform,b.count,b.particles,b.colorGrid]);
    }
    for (let substep = 0; substep < steps; substep++) for (let iteration = 0; iteration < this.settings.iterations; iteration++) {
      writeUniform(this.uniformF, this.uniformU, (substep * MAX_ITERATIONS + iteration) * UNIFORM_BYTES, this, this.frame + substep, iteration, this.adapter ? this.time + substep / hz - this.rigidTime : 0);
    }
    if (steps) d.queue.writeBuffer(b.uniforms, 0, this.uniformData, 0, steps * MAX_ITERATIONS * UNIFORM_BYTES);
    const encoder = d.createCommandEncoder({ label: 'Smoosh frame' });
    const dispatch = (pass, name, group, size) => {
      pass.setPipeline(name === 'g2p2g' && this.hasSolids ? this.solidPipeline : this.pipelines[name]); pass.setBindGroup(0, group);
      if (typeof size === 'number') pass.dispatchWorkgroups(size);
      else if (Array.isArray(size)) pass.dispatchWorkgroups(...size);
      else pass.dispatchWorkgroupsIndirect(size, 0);
    };
    const resetBodyState = this.adapter && this.lastBodyStateVersion !== this.adapter.version;
    if (resetBodyState) encoder.clearBuffer(b.forces, 0, FEEDBACK_INERTIA_OFFSET);
    const gx = Math.ceil(this.domain.gridWidth / 8), gy = Math.ceil(this.domain.gridHeight / 8);
    for (let substep = 0; substep < steps; substep++) {
      const groups = this.groups[substep * MAX_ITERATIONS];
      const timestampWrites = this.timestamps && substep === 0 ? { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } : undefined;
      let pass = encoder.beginComputePass({ label: 'Smoosh emit', timestampWrites });
      if (substep === 0 && this.adapter?.bodyCount) dispatch(pass, 'bodyBegin', groups.beginBody, Math.ceil(this.adapter.bodyCount / 64));
      if (substep === 0 && this.lastSimulationHz && this.lastSimulationHz !== hz) dispatch(pass, 'rescaleParticles', groups.rescale, b.simArgs);
      if (substep === 0 && this.adapter?.bodyCount) dispatch(pass, 'rigidbody2g', groups.raster, [gx, gy]);
      const emit = this.emissionGroups(this.frame + substep);
      if (emit && this.shapes.length) dispatch(pass, 'particleEmit', groups.emit[this.gridIndex], [emit, this.shapes.length]);
      dispatch(pass, 'setIndirectArgs', this.indirectGroup, 1); pass.end();
      encoder.clearBuffer(b.bucketCount); encoder.clearBuffer(b.bucketInsertCount); encoder.clearBuffer(b.bucketAllocator);
      encoder.copyBufferToBuffer(b.blankArgs, 0, b.bucketArgs, 0, 16);
      encoder.copyBufferToBuffer(b.blankArgs, 0, b.gridArgs, 0, 16);
      pass = encoder.beginComputePass({ label: 'Smoosh particle buckets' });
      dispatch(pass, 'bukkitCount', groups.count, b.simArgs);
      dispatch(pass, 'bukkitAllocate', groups.allocate, [Math.ceil(this.bucketX / 8), Math.ceil(this.bucketY / 8)]);
      dispatch(pass, 'bukkitInsert', groups.insert, b.simArgs); pass.end();
      for (let iteration = 0; iteration < this.settings.iterations; iteration++) {
        const next = 1 - this.gridIndex, g = this.groups[substep * MAX_ITERATIONS + iteration];
        encoder.clearBuffer(next ? b.grid1 : b.grid0);
        const final = substep === steps - 1 && iteration === this.settings.iterations - 1;
        pass = encoder.beginComputePass({ label: 'Smoosh PB-MPM', timestampWrites: this.timestamps && final ? { querySet: this.querySet, beginningOfPassWriteIndex: 2, ...(!mixColors?{endOfPassWriteIndex:3}:{}) } : undefined });
        if (iteration) dispatch(pass, 'gridUpdate', g.update[this.gridIndex], b.gridArgs);
        dispatch(pass, 'g2p2g', g.solve[this.gridIndex], b.bucketArgs);
        if (iteration && this.adapter?.bodyCount) dispatch(pass, 'bodyUpdate', g.updateBody, Math.ceil(this.adapter.bodyCount / 64));
        pass.end(); this.gridIndex = next;
      }
    }
    if(mixColors){
      encoder.clearBuffer(b.colorGrid);
      const pass=encoder.beginComputePass({label:'Smoosh liquid dye mixing',timestampWrites:this.timestamps?{querySet:this.querySet,endOfPassWriteIndex:3}:undefined});
      dispatch(pass,'colorScatter',this.colorScatterGroup,b.simArgs);
      dispatch(pass,'colorMix',this.colorMixGroup,b.simArgs);pass.end();
    }
    if (steps) encoder.copyBufferToBuffer(b.bucketAllocator, 0, b.renderArgs, 4, 4);
    this.frame += steps;
    this.time += steps / hz;
    if (render && this.renderer) this.renderer.encode(encoder);
    const slot = steps ? this.readbacks.find(r => !r.pending) : null;
    if (slot) {
      slot.pending = true; slot.epoch = this.epoch; slot.adapter = this.adapter; slot.version = this.adapter?.version;
      slot.steps = steps; slot.frame = this.frame;
      encoder.copyBufferToBuffer(b.count, 0, slot.buffer, 0, 16);
      encoder.copyBufferToBuffer(b.free, 0, slot.buffer, 16, 16);
      encoder.copyBufferToBuffer(b.forces, FEEDBACK_TOTAL_OFFSET, slot.buffer, 32, MAX_BODIES * 16);
      // If readback slots are busy, accumulate feedback until one becomes available.
      encoder.clearBuffer(b.forces, FEEDBACK_TOTAL_OFFSET, MAX_BODIES * 16);
      if (this.timestamps) {
        encoder.resolveQuerySet(this.querySet, 0, 4, b.timestampResolve, 0);
        encoder.copyBufferToBuffer(b.timestampResolve, 0, slot.buffer, 32 + MAX_BODIES * 16, 32);
      }
    } else if (steps) this.stats.skippedReadbacks++;
    d.queue.submit([encoder.finish()]);
    if (steps) { this.lastSimulationHz = hz; this.lastBodyStateVersion = this.adapter?.version; }
    if (steps && this.shapes.some(shape => ['burst','erase'].includes(shape.kind) && shape.spawnFrame < this.frame)) {
      this.shapes = this.shapes.filter(shape => !['burst','erase'].includes(shape.kind) || shape.spawnFrame >= this.frame); this.shapesDirty = true;
    }
    if (slot) this.readSlot(slot);
    this.stats.cpuMs = performance.now() - start;
  }

  applyPendingImpulses() {
    if (!this.hasPendingImpulses) return;
    if (this.settings.feedback) this.adapter.applyImpulses(this.pendingImpulses, this.pendingVersion);
    this.pendingImpulses.fill(0); this.hasPendingImpulses = false;
  }

  async readSlot(slot) {
    try {
      await slot.buffer.mapAsync(GPUMapMode.READ);
      if (this.destroyed || slot.epoch !== this.epoch) return;
      const range = slot.buffer.getMappedRange(), counts = new Int32Array(range, 0, 8);
      if (slot.frame >= (this.lastStatsFrame ?? 0)) {
        Object.assign(this.stats, { highWater: counts[0], particles: counts[0] - counts[4], drained: counts[5], rejected: counts[6], emitted: counts[7] });
        this.lastStatsFrame = slot.frame;
      }
      if (slot.adapter === this.adapter && slot.version === this.adapter?.version && this.settings.feedback) {
        if (this.pendingVersion !== slot.version) this.pendingImpulses.fill(0);
        const values = new Int32Array(range, 32, MAX_BODIES * 4);
        for (let i = 0; i < values.length; i++) this.pendingImpulses[i] += values[i];
        this.pendingVersion = slot.version; this.hasPendingImpulses = true;
      }
      if (this.timestamps) {
        const times = new BigUint64Array(range, 32 + MAX_BODIES * 16, 4);
        this.stats.gpuMs = Number(times[3] - times[0]) / 1e6;
        this.stats.gpuMsPerStep = this.stats.gpuMs / slot.steps;
      }
    } catch (error) { if (!this.destroyed) this.reportError(error); }
    finally { if (slot.buffer.mapState === 'mapped') slot.buffer.unmap(); slot.pending = false; }
  }

  reset() {
    if (this.destroyed) return;
    this.epoch++; this.frame = 0; this.time = 0; this.lastStatsFrame = 0; this.accumulator = 0; this.gridIndex = 0;
    this.rigidAccumulator = 0; this.rigidTime = 0;
    this.lastSimulationHz = null;
    this.pendingImpulses.fill(0); this.hasPendingImpulses = false;
    this.shapes = this.shapes.filter(shape => !['burst','erase'].includes(shape.kind)); this.shapesDirty = true;
    this.hasSolids = this.shapes.some(shape => this.materials[materialIndex(shape.material)].model !== 0);
    const e = this.device.createCommandEncoder();
    for (const key of ['particles', 'count', 'free', 'grid0', 'grid1', 'forces', 'bucketCount', 'bucketInsertCount', 'bucketAllocator']) e.clearBuffer(this.buffers[key]);
    this.device.queue.submit([e.finish()]);
    this.device.queue.writeBuffer(this.buffers.count, 0, new Uint32Array([0,this.maxParticles,0,0]));
    this.device.queue.writeBuffer(this.buffers.renderArgs, 0, new Uint32Array([4,0,0,0]));
    Object.assign(this.stats, { particles: 0, emitted: 0, drained: 0, highWater: 0, rejected: 0, droppedSeconds: 0, rigidSteps: 0, deferredFrames: 0 });
  }

  async inspectParticles() {
    const size = this.maxParticles * PARTICLE_WORDS * 4;
    const staging = buffer(this.device, 'diagnostic particles', size, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    try {
      const e = this.device.createCommandEncoder(); e.copyBufferToBuffer(this.buffers.particles, 0, staging, 0, size);
      this.device.queue.submit([e.finish()]); await staging.mapAsync(GPUMapMode.READ);
      return new Float32Array(staging.getMappedRange().slice(0));
    } finally { if (staging.mapState === 'mapped') staging.unmap(); staging.destroy(); }
  }
  reportError(error) {
    const message = String(error.message ?? error);
    this.failure ??= new Error(message);
    if (!this.stats.errors.includes(message) && this.stats.errors.length < 8) {
      this.stats.errors.push(message); this.onError(error);
    }
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.epoch++; this.walls?.destroy(); this.adapter?.destroy(); this.renderer?.destroy();
    for (const b of Object.values(this.buffers)) b.destroy();
    this.querySet?.destroy(); this.device.removeEventListener('uncapturederror', this.errorListener);
    if (this.ownsDevice) this.device.destroy();
  }
}
