import { buffer, bindGroup } from './gpu.mjs';

// Bound the composite to the projected finite world, including particle splats.
// Fullscreen portrait views otherwise shade mostly empty letterbox pixels.
export function writeSurfaceScissor(out, width, height, gridWidth, gridHeight, camera, radius = 1.25) {
  const sx = Math.abs(camera[0]), sy = Math.abs(camera[1]);
  const px = (radius + 2) * sx * width / gridWidth + 2;
  const py = (radius + 2) * sy * height / gridHeight + 2;
  const x0 = Math.max(0, Math.min(width, Math.floor((1 + camera[2] - sx) * width / 2 - px)));
  const x1 = Math.max(0, Math.min(width, Math.ceil((1 + camera[2] + sx) * width / 2 + px)));
  const y0 = Math.max(0, Math.min(height, Math.floor((1 - camera[3] - sy) * height / 2 - py)));
  const y1 = Math.max(0, Math.min(height, Math.ceil((1 - camera[3] + sy) * height / 2 + py)));
  out[0] = x0; out[1] = y0; out[2] = Math.max(0, x1-x0); out[3] = Math.max(0, y1-y0);
  return out;
}

export class LiquidRenderer {
  static async create(sim, canvas, shaders) {
    const renderer = new LiquidRenderer(sim, canvas);
    const [density, surface] = await Promise.all([shaders.module(sim.device, 'density'), shaders.module(sim.device, 'surface')]);
    const d = sim.device;
    renderer.densityPipeline = await d.createRenderPipelineAsync({
      label: 'Smoosh density splats', layout: 'auto', vertex: { module: density, entryPoint: 'vertexMain' },
      primitive: { topology: 'triangle-strip' },
      fragment: { module: density, entryPoint: 'fragmentMain', targets: [{ format: 'rgba16float',
        blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } },
      }] },
    });
    renderer.surfacePipeline = await d.createRenderPipelineAsync({
      label: 'Smoosh liquid surface', layout: 'auto', vertex: { module: surface, entryPoint: 'vertexMain' },
      fragment: { module: surface, entryPoint: 'fragmentMain', targets: [{ format: renderer.format }] },
    });
    renderer.densityBindings = bindGroup(d, renderer.densityPipeline, [renderer.uniform, sim.buffers.particles, sim.buffers.bucketData]);
    renderer.particlePipeline = await d.createRenderPipelineAsync({
      label: 'Smoosh direct particles', layout: 'auto', vertex: { module: density, entryPoint: 'vertexMain' },
      primitive: { topology: 'triangle-strip' },
      fragment: { module: density, entryPoint: 'fragmentMain', targets: [{ format: renderer.format }] },
    });
    renderer.particleBindings = bindGroup(d, renderer.particlePipeline, [renderer.uniform, sim.buffers.particles, sim.buffers.bucketData]);
    return renderer;
  }
  constructor(sim, canvas) {
    this.sim = sim; this.device = sim.device; this.canvas = canvas;
    this.context = canvas.getContext('webgpu');
    if (!this.context) throw new Error('Could not create the WebGPU canvas');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' });
    this.uniform = buffer(this.device, 'render uniforms', 64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.values = new Float32Array(16); this.words = new Uint32Array(this.values.buffer);
    this.viewTransform = new Float32Array([1,1,0,0]); this.mode = 'surface'; this.scale = 0.75;
    this.densityScissor = new Uint32Array(4); this.surfaceScissor = new Uint32Array(4);
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }
  encode(encoder) {
    const width = Math.max(1, Math.floor(this.canvas.width * this.scale)), height = Math.max(1, Math.floor(this.canvas.height * this.scale));
    const d = this.sim.domain;
    this.values.set([width, height, d.width / d.cellSize, d.height / d.cellSize,
      this.mode === 'particles' ? 0.34 : 1.25, 1 / this.sim.simulationHz, this.mode === 'velocity' ? 1 : this.mode === 'particles' ? 2 : 0, this.sim.time]);
    this.values.set(this.viewTransform, 8);
    this.words[12] = this.sim.bucketParticleOffset;
    this.device.queue.writeBuffer(this.uniform, 0, this.values);
    if (this.mode === 'particles') {
      const pass = encoder.beginRenderPass({ label: 'Smoosh direct particle view', colorAttachments: [{
        view: this.context.getCurrentTexture().createView(), clearValue: [0,0,0,0], loadOp: 'clear', storeOp: 'store',
      }] });
      pass.setPipeline(this.particlePipeline); pass.setBindGroup(0, this.particleBindings);
      pass.drawIndirect(this.sim.buffers.renderArgs, 0); pass.end(); return;
    }
    if (!this.texture || width !== this.width || height !== this.height) {
      this.texture?.destroy(); this.width = width; this.height = height;
      this.texture = this.device.createTexture({ label: 'Smoosh density target', size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
      this.textureView = this.texture.createView();
      this.surfaceBindings = this.device.createBindGroup({ layout: this.surfacePipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: this.textureView }, { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.uniform } },
      ] });
    }
    const density = encoder.beginRenderPass({
      label: 'Smoosh density', colorAttachments: [{ view: this.textureView, clearValue: [0,0,0,0], loadOp: 'clear', storeOp: 'store' }],
    });
    const r = writeSurfaceScissor(this.densityScissor, width, height, d.width/d.cellSize, d.height/d.cellSize, this.viewTransform);
    density.setScissorRect(r[0],r[1],r[2],r[3]);
    density.setPipeline(this.densityPipeline); density.setBindGroup(0, this.densityBindings);
    if (r[2] && r[3]) density.drawIndirect(this.sim.buffers.renderArgs, 0); density.end();
    const surface = encoder.beginRenderPass({
      label: 'Smoosh surface', colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: [0,0,0,0], loadOp: 'clear', storeOp: 'store' }],
    });
    const sr = writeSurfaceScissor(this.surfaceScissor, this.canvas.width, this.canvas.height, d.width/d.cellSize, d.height/d.cellSize, this.viewTransform);
    surface.setScissorRect(sr[0],sr[1],sr[2],sr[3]);
    surface.setPipeline(this.surfacePipeline); surface.setBindGroup(0, this.surfaceBindings);
    if (sr[2] && sr[3]) surface.draw(3); surface.end();
  }
  destroy() { this.texture?.destroy(); this.uniform.destroy(); this.context.unconfigure(); }
}
