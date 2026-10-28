// Box2D walls follow the same rasterized area union as the GPU boundary.
// Shared edges between touching or overlapping areas remain open.
export function createDomainWalls(B, world, domain) {
  domain.compile();
  const bd = B.b2DefaultBodyDef();
  let ground;
  try { ground = B.b2CreateBody(world, bd); } finally { bd.delete(); }
  let sd, segment;
  try {
    sd = B.b2DefaultShapeDef(); sd.material.friction = 0.5;
    segment = new B.b2Segment();
    const edges = domain.boundarySegments();
    for (let i = 0; i < edges.length; i += 4) {
      segment.point1.Set(edges[i], edges[i+1]);
      segment.point2.Set(edges[i+2], edges[i+3]);
      B.b2CreateSegmentShape(ground, sd, segment);
    }
    return ground;
  } catch (error) {
    if (B.b2Body_IsValid(ground)) B.b2DestroyBody(ground);
    throw error;
  } finally { segment?.delete(); sd?.delete(); }
}

export class DomainWalls {
  constructor(box2d, worldId, domain) {
    this.box2d = box2d; this.worldId = worldId; this.domain = domain;
    this.version = -1; this.body = null; this.destroyed = false;
    this.sync();
  }
  sync() {
    if (this.destroyed) throw new Error('DomainWalls has been destroyed');
    const B = this.box2d;
    if (this.version === this.domain.version && B.b2Body_IsValid(this.body)) return this.body;
    const body = createDomainWalls(B, this.worldId, this.domain);
    if (this.body && B.b2Body_IsValid(this.body)) B.b2DestroyBody(this.body);
    this.body = body; this.version = this.domain.version;
    return body;
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.body && this.box2d.b2Body_IsValid(this.body)) this.box2d.b2DestroyBody(this.body);
    this.body = null;
  }
}
