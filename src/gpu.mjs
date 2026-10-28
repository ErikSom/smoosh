import { insertions } from './layout.mjs';
import { embeddedShaderSources } from './shader-sources.mjs';

export class ShaderLibrary {
  constructor(base) {
    this.base = base ?? new URL('../shaders/', import.meta.url);
    this.sources = new Map(base == null && embeddedShaderSources ? Object.entries(embeddedShaderSources) : []);
  }
  async source(name, seen = new Set()) {
    if (seen.has(name)) return '';
    seen.add(name);
    if (!this.sources.has(name)) this.sources.set(name, fetch(new URL(`${name}.wgsl`, this.base)).then(async r => {
      if (!r.ok) throw new Error(`Could not load ${name}: HTTP ${r.status}`);
      return r.text();
    }));
    const raw = await this.sources.get(name);
    const lines = [];
    for (const line of raw.split('\n')) {
      const include = line.match(/^\s*\/\/!include\s+(.+)$/);
      const insert = line.match(/^\s*\/\/!insert\s+(.+)$/);
      if (include) lines.push(await this.source(include[1].trim(), seen));
      else if (insert) {
        const value = insertions[insert[1].trim()];
        if (value === undefined) throw new Error(`Unknown shader insertion ${insert[1]}`);
        lines.push(value);
      } else lines.push(line);
    }
    return lines.join('\n');
  }
  async module(device, name) {
    const module = device.createShaderModule({ label: `Smoosh ${name}`, code: await this.source(name) });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error(`${name}: ${errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n')}`);
    return module;
  }
}

export async function createDevice() {
  if (!globalThis.navigator?.gpu) throw new Error('Smoosh needs WebGPU. Open this page on localhost in a browser with WebGPU enabled.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter is available.');
  if (adapter.limits.maxStorageBuffersPerShaderStage < 8) throw new Error('Smoosh needs 8 storage buffers per compute stage.');
  const timestamps = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: timestamps ? ['timestamp-query'] : [],
    requiredLimits: { maxStorageBuffersPerShaderStage: 8 },
  });
  return { device, adapter, timestamps };
}

export function buffer(device, label, bytes, usage, initial) {
  const b = device.createBuffer({ label: `Smoosh ${label}`, size: Math.max(4, Math.ceil(bytes / 4) * 4), usage });
  if (initial) device.queue.writeBuffer(b, 0, initial);
  return b;
}

export function bindGroup(device, pipeline, resources) {
  return device.createBindGroup({
    label: `Smoosh ${pipeline.label} bindings`, layout: pipeline.getBindGroupLayout(0),
    entries: resources.map((resource, binding) => ({ binding, resource: resource.buffer ? resource : { buffer: resource } })),
  });
}
