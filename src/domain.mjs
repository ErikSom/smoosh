const finite = (value, name) => {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
};

export function region(options) {
  const r = { ...options, type: options.type ?? 'box', enabled: options.enabled ?? true };
  if (r.type === 'polygon') {
    if (!Array.isArray(r.points) || r.points.length < 3 || r.points.length > 32) throw new RangeError('Polygons need 3 to 32 vertices');
    r.points = r.points.map(p => [finite(p[0], 'vertex.x'), finite(p[1], 'vertex.y')]);
    r.x = Math.min(...r.points.map(p => p[0])); r.y = Math.min(...r.points.map(p => p[1]));
    r.width = Math.max(...r.points.map(p => p[0])) - r.x; r.height = Math.max(...r.points.map(p => p[1])) - r.y;
    let twiceArea = 0;
    for (let i = 0, j = r.points.length - 1; i < r.points.length; j = i++) twiceArea += r.points[j][0] * r.points[i][1] - r.points[i][0] * r.points[j][1];
    if (r.width <= 0 || r.height <= 0 || Math.abs(twiceArea) < 1e-8) throw new RangeError('Polygon must have a nonzero area');
    return r;
  }
  finite(r.x, 'x'); finite(r.y, 'y');
  if (r.type === 'circle') {
    if (!(finite(r.radius, 'radius') > 0)) throw new RangeError('radius must be positive');
  } else if (r.type === 'box') {
    if (!(finite(r.width, 'width') > 0 && finite(r.height, 'height') > 0)) {
      throw new RangeError('width and height must be positive');
    }
  } else throw new TypeError(`Unsupported region: ${r.type}`);
  return r;
}

export function contains(r, x, y) {
  if (!r.enabled) return false;
  if (r.type === 'circle') return (x - r.x) ** 2 + (y - r.y) ** 2 <= r.radius ** 2;
  if (r.type === 'polygon') {
    let inside = false;
    for (let i = 0, j = r.points.length - 1; i < r.points.length; j = i++) {
      const a = r.points[j], b = r.points[i];
      if (Math.abs((x-a[0])*(b[1]-a[1])-(y-a[1])*(b[0]-a[0])) < 1e-9 && x >= Math.min(a[0],b[0]) && x <= Math.max(a[0],b[0]) && y >= Math.min(a[1],b[1]) && y <= Math.max(a[1],b[1])) return true;
      if ((a[1] > y) !== (b[1] > y) && x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) inside = !inside;
    }
    return inside;
  }
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

// Squared Euclidean distance transform: lower envelope of parabolas, O(n).
// A finite sentinel avoids Infinity - Infinity for rows without a seed.
function edt1d(source, output, length, vertices, edges) {
  let k = 0;
  vertices[0] = 0; edges[0] = -1e20; edges[1] = 1e20;
  for (let q = 1; q < length; q++) {
    let p = vertices[k];
    let s = ((source[q] + q * q) - (source[p] + p * p)) / (2 * (q - p));
    while (s <= edges[k]) {
      p = vertices[--k];
      s = ((source[q] + q * q) - (source[p] + p * p)) / (2 * (q - p));
    }
    vertices[++k] = q; edges[k] = s; edges[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < length; q++) {
    while (edges[k + 1] < q) k++;
    output[q] = (q - vertices[k]) ** 2 + source[vertices[k]];
  }
}

function distances(mask, width, height, seed) {
  const size = Math.max(width, height);
  const source = new Float64Array(size), output = new Float64Array(size);
  const vertices = new Int32Array(size), edges = new Float64Array(size + 1);
  const result = new Float32Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) source[x] = mask[y * width + x] === seed ? 0 : 1e12;
    edt1d(source, output, width, vertices, edges);
    for (let x = 0; x < width; x++) result[y * width + x] = output[x];
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) source[y] = result[y * width + x];
    edt1d(source, output, height, vertices, edges);
    for (let y = 0; y < height; y++) result[y * width + x] = output[y];
  }
  return result;
}

export class SimulationDomain {
  constructor({ width = 32, height = 20, cellSize = 0.125, origin = [0, 0] } = {}) {
    if (!(finite(width, 'width') > 0 && finite(height, 'height') > 0 && finite(cellSize, 'cellSize') > 0)) {
      throw new RangeError('Domain dimensions must be positive');
    }
    this.width = width; this.height = height; this.cellSize = cellSize;
    this.origin = [finite(origin[0], 'origin.x'), finite(origin[1], 'origin.y')];
    // Four guard cells on each side keep the 3x3 interpolation stencil in bounds.
    this.gridWidth = Math.ceil(width / cellSize) + 10;
    this.gridHeight = Math.ceil(height / cellSize) + 10;
    if (this.gridWidth * this.gridHeight > 2_000_000) throw new RangeError('Domain grid is too large');
    this.areas = new Map(); this.version = 0;
    this.compiledVersion = -1;
  }

  addArea(id, options) {
    if (this.areas.has(id)) throw new Error(`Duplicate area: ${id}`);
    const r = region({ ...options, id });
    this.areas.set(id, r); this.version++; return r;
  }

  updateArea(id, changes) {
    const previous = this.areas.get(id);
    if (!previous) throw new Error(`Unknown area: ${id}`);
    const r = region({ ...previous, ...changes, id });
    Object.assign(previous, r); this.version++; return previous;
  }

  removeArea(id) {
    if (this.areas.delete(id)) this.version++;
  }

  contains(x, y) {
    if (x < this.origin[0] || y < this.origin[1] || x > this.origin[0] + this.width || y > this.origin[1] + this.height) return false;
    for (const r of this.areas.values()) if (contains(r, x, y)) return true;
    return false;
  }

  compile() {
    if (this.compiledVersion === this.version) return this.field;
    const width = this.gridWidth, height = this.gridHeight;
    const mask = new Uint8Array(width * height);
    for (let y = 5; y < height - 5; y++) for (let x = 5; x < width - 5; x++) {
      mask[y * width + x] = +this.contains(this.origin[0] + (x - 5) * this.cellSize, this.origin[1] + (y - 5) * this.cellSize);
    }
    const outside = distances(mask, width, height, 0), inside = distances(mask, width, height, 1);
    const signed = new Float32Array(mask.length);
    for (let i = 0; i < mask.length; i++) signed[i] = mask[i] ? Math.sqrt(outside[i]) - 1 : -Math.sqrt(inside[i]);
    const field = new Float32Array(mask.length * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const nx = signed[y * width + Math.min(x + 1, width - 1)] - signed[y * width + Math.max(0, x - 1)];
      const ny = signed[Math.min(y + 1, height - 1) * width + x] - signed[Math.max(0, y - 1) * width + x];
      const length = Math.hypot(nx, ny);
      field[i * 4] = length > 1e-6 ? nx / length : 0;
      field[i * 4 + 1] = length > 1e-6 ? ny / length : 0;
      field[i * 4 + 2] = signed[i]; field[i * 4 + 3] = mask[i];
    }
    this.mask = mask; this.field = field; this.compiledVersion = this.version;
    return field;
  }

  boundarySegments() {
    if (this.boundaryVersion === this.version) return this.boundary;
    this.compile();
    const result = [], w = this.gridWidth, h = this.gridHeight, mask = this.mask;
    const line = (ax, ay, bx, by) => result.push(...this.toWorld(ax, ay), ...this.toWorld(bx, by));
    for (let y = 1; y < h; y++) {
      let start = -1;
      for (let x = 0; x <= w; x++) {
        const edge = x < w && mask[y*w+x] !== mask[(y-1)*w+x];
        if (edge && start < 0) start = x;
        if (!edge && start >= 0) { line(start-0.5,y-0.5,x-0.5,y-0.5); start = -1; }
      }
    }
    for (let x = 1; x < w; x++) {
      let start = -1;
      for (let y = 0; y <= h; y++) {
        const edge = y < h && mask[y*w+x] !== mask[y*w+x-1];
        if (edge && start < 0) start = y;
        if (!edge && start >= 0) { line(x-0.5,start-0.5,x-0.5,y-0.5); start = -1; }
      }
    }
    this.boundary = new Float32Array(result); this.boundaryVersion = this.version;
    return this.boundary;
  }
  toGrid(x, y) { return [(x - this.origin[0]) / this.cellSize + 5, (y - this.origin[1]) / this.cellSize + 5]; }
  toWorld(x, y) { return [this.origin[0] + (x - 5) * this.cellSize, this.origin[1] + (y - 5) * this.cellSize]; }
}
