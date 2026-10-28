import {
  MAX_BODIES, MAX_BODY_SHAPES, BODY_WORDS, RIGID_SHAPE_WORDS, RIGID_SHAPES_OFFSET,
  RIGID_WORDS, BUCKET_SIZE, IMPULSE_MULTIPLIER,
} from './layout.mjs';

const enumValue = value => typeof value === 'number' ? value : value.value;
const sameBody = (a, b) => a.index1 === b.index1 && a.world0 === b.world0 && a.generation === b.generation;

export class Box2DAdapter {
  constructor(box2d, worldId, domain, { native = true } = {}) {
    this.box2d = box2d; this.worldId = worldId; this.domain = domain;
    this.bodies = []; this.version = 0; this.geometryDirty = true;
    this.native = native && !!box2d.SmooshBox2DBridge;
    this.bridge = this.native ? new box2d.SmooshBox2DBridge(domain.cellSize, ...domain.origin) : null;
    this.data = new Float32Array(RIGID_WORDS);
    this.words = new Uint32Array(this.data.buffer);
    this.inertias = new Float32Array(MAX_BODIES);
    this.bucketX = Math.ceil(domain.gridWidth / BUCKET_SIZE); this.bucketY = Math.ceil(domain.gridHeight / BUCKET_SIZE);
    this.bucketCount = this.bucketX * this.bucketY;
    this.bucketInfo = new Uint32Array(this.bucketCount * 2);
    this.bucketIndices = new Uint32Array(this.bucketCount * MAX_BODIES);
    this.bucketCursor = new Uint32Array(this.bucketCount);
    this.impulseVector = new box2d.b2Vec2(0, 0);
  }
  get bodyCount() { return this.bodies.length; }
  addBody(bodyId) {
    if (this.bodies.some(id => sameBody(id, bodyId))) return;
    if (this.bodyCount >= MAX_BODIES) throw new RangeError(`Smoosh supports ${MAX_BODIES} registered bodies`);
    if (!this.box2d.b2Body_IsValid(bodyId)) throw new Error('Invalid Box2D body');
    const world = this.box2d.b2Body_GetWorld(bodyId);
    if (world.index1 !== this.worldId.index1 || world.generation !== this.worldId.generation) throw new Error('Body belongs to another Box2D world');
    this.bridge?.addBody(bodyId); this.bodies.push(bodyId); this.invalidateGeometry();
  }
  removeBody(bodyId) {
    const index = this.bodies.findIndex(id => sameBody(id, bodyId));
    if (index < 0) return;
    this.bodies.splice(index, 1);
    this.bridge?.clear(); for (const id of this.bodies) this.bridge?.addBody(id);
    this.invalidateGeometry();
  }
  invalidateGeometry() { this.geometryDirty = true; this.version++; this.bridge?.invalidateGeometry(); }

  refresh(bodyHorizon = 0) {
    if (this.native) {
      this.bridge.refresh();
      // A wasm allocation can grow memory and detach an earlier heap view.
      const data = this.bridge.getData();
      this.data.set(this.geometryDirty ? data : data.subarray(0, RIGID_SHAPES_OFFSET));
    } else {
      if (this.geometryDirty) this.packGeometry();
      const B = this.box2d, cell = this.domain.cellSize, [ox, oy] = this.domain.origin;
      for (let i = 0; i < this.bodyCount; i++) {
        const id = this.bodies[i], b = 4 + i * BODY_WORDS;
        if (!B.b2Body_IsValid(id)) { this.data[b] = 0; this.data[b + 10] = 0; continue; }
        const position = B.b2Body_GetPosition(id), center = (B.b2Body_GetWorldCenter ?? B.b2Body_GetWorldCenterOfMass)(id), velocity = B.b2Body_GetLinearVelocity(id), rotation = B.b2Body_GetRotation(id);
        this.data[b] = enumValue(B.b2Body_GetType(id)) === 2 ? B.b2Body_GetMass(id) : 0;
        this.data[b + 1] = (center.x - ox) / cell + 5; this.data[b + 5] = (center.y - oy) / cell + 5;
        this.data[b + 2] = (position.x - ox) / cell + 5; this.data[b + 3] = (position.y - oy) / cell + 5;
        this.data[b + 4] = B.b2Rot_GetAngle(rotation); this.data[b + 6] = velocity.x / cell; this.data[b + 7] = velocity.y / cell;
        this.data[b + 8] = B.b2Body_GetAngularVelocity(id);
        position.delete(); center.delete(); velocity.delete(); rotation.delete();
      }
    }
    for (let i = 0; i < this.bodyCount; i++) {
      const id = this.bodies[i];
      const dynamic = this.data[4 + i * BODY_WORDS] > 0 && this.box2d.b2Body_IsValid(id);
      const locks = dynamic ? this.box2d.b2Body_GetMotionLocks?.(id) : null;
      this.inertias[i] = dynamic && !locks?.angularZ ? this.box2d.b2Body_GetRotationalInertia(id) : 0;
      locks?.delete();
    }
    this.geometryDirty = false; this.buildBuckets(bodyHorizon);
    return this.data;
  }

  packGeometry() {
    const B = this.box2d, cell = this.domain.cellSize;
    this.data.fill(0); this.words[0] = this.bodyCount;
    let count = 0;
    for (let i = 0; i < this.bodyCount; i++) {
      const id = this.bodies[i], b = 4 + i * BODY_WORDS;
      this.data[b + 9] = count;
      if (!B.b2Body_IsValid(id)) continue;
      let radius = 0;
      for (const shapeId of B.b2Body_GetShapes(id, B.b2Body_GetShapeCount(id))) {
        if (B.b2Shape_IsSensor(shapeId)) continue;
        if (count >= MAX_BODY_SHAPES) throw new RangeError(`Smoosh supports ${MAX_BODY_SHAPES} registered shapes`);
        const type = enumValue(B.b2Shape_GetType(shapeId)), s = RIGID_SHAPES_OFFSET + count * RIGID_SHAPE_WORDS;
        this.data[s + 3] = type;
        let r = 0;
        if (type === 0) {
          const shape = B.b2Shape_GetCircle(shapeId), p = shape.center;
          this.data[s] = p.x / cell; this.data[s + 1] = p.y / cell; this.data[s + 2] = shape.radius / cell;
          this.data[s + 4] = shape.radius / cell; r = Math.hypot(p.x, p.y) / cell + shape.radius / cell;
          shape.delete();
        } else if (type === 3) {
          const shape = B.b2Shape_GetPolygon(shapeId);
          this.data[s + 2] = shape.radius / cell; this.data[s + 5] = shape.count;
          for (let v = 0; v < shape.count; v++) {
            const p = shape.GetVertex(v), n = shape.GetNormal(v);
            const x = p.x / cell, y = p.y / cell;
            this.data[s + 6 + v * 2] = x; this.data[s + 7 + v * 2] = y;
            this.data[s + 22 + v * 2] = n.x; this.data[s + 23 + v * 2] = n.y;
            this.data[s + 38 + v] = n.x * x + n.y * y;
            r = Math.max(r, Math.hypot(x, y) + shape.radius / cell);
            p.delete(); n.delete();
          }
          this.data[s + 4] = r; shape.delete();
        } else if (type === 1 || type === 2 || type === 4) {
          const shape = type === 1 ? B.b2Shape_GetCapsule(shapeId) : type === 4 ? B.b2Shape_GetChainSegment(shapeId) : B.b2Shape_GetSegment(shapeId);
          const segment = type === 4 ? shape.segment : shape;
          const p = type === 1 ? shape.center1 : segment.point1, q = type === 1 ? shape.center2 : segment.point2;
          this.data[s + 2] = type === 1 ? shape.radius / cell : 0.35;
          this.data[s + 6] = p.x / cell; this.data[s + 7] = p.y / cell;
          this.data[s + 8] = q.x / cell; this.data[s + 9] = q.y / cell;
          r = Math.max(Math.hypot(p.x, p.y), Math.hypot(q.x, q.y)) / cell + this.data[s + 2];
          this.data[s + 4] = r; shape.delete();
        } else continue;
        radius = Math.max(radius, r); this.data[b + 10]++; count++;
      }
      this.data[b + 11] = (radius + 2) ** 2;
    }
    this.words[1] = count;
  }

  buildBuckets(bodyHorizon = 0) {
    this.bucketInfo.fill(0);
    const visit = (index, callback) => {
      const b = 4 + index * BODY_WORDS, x = this.data[b + 2], y = this.data[b + 3];
      const r = Math.sqrt(this.data[b + 11]) + bodyHorizon * Math.hypot(this.data[b + 6], this.data[b + 7]);
      if (!this.data[b + 10]) return;
      const minX = Math.max(0, Math.floor((x - r) / BUCKET_SIZE)), maxX = Math.min(this.bucketX - 1, Math.floor((x + r) / BUCKET_SIZE));
      const minY = Math.max(0, Math.floor((y - r) / BUCKET_SIZE)), maxY = Math.min(this.bucketY - 1, Math.floor((y + r) / BUCKET_SIZE));
      for (let by = minY; by <= maxY; by++) for (let bx = minX; bx <= maxX; bx++) callback(by * this.bucketX + bx);
    };
    for (let i = 0; i < this.bodyCount; i++) visit(i, bucket => this.bucketInfo[bucket * 2]++);
    let offset = 0;
    for (let i = 0; i < this.bucketCount; i++) {
      this.bucketInfo[i * 2 + 1] = offset; this.bucketCursor[i] = offset; offset += this.bucketInfo[i * 2];
    }
    for (let i = 0; i < this.bodyCount; i++) visit(i, bucket => { this.bucketIndices[this.bucketCursor[bucket]++] = i; });
    this.usedBucketIndices = offset;
  }

  applyImpulses(values, version, maxVelocityChange = 3) {
    if (version !== this.version) return;
    if (this.native) {
      this.bridge.getImpulseBuffer().set(values.subarray(0, this.bodyCount * 4));
      this.bridge.applyImpulses(maxVelocityChange); return;
    }
    const B = this.box2d;
    for (let i = 0; i < this.bodyCount; i++) {
      const id = this.bodies[i];
      if (!B.b2Body_IsValid(id) || enumValue(B.b2Body_GetType(id)) !== 2) continue;
      let x = values[i * 4] / IMPULSE_MULTIPLIER, y = values[i * 4 + 1] / IMPULSE_MULTIPLIER;
      const limit = B.b2Body_GetMass(id) * maxVelocityChange, length = Math.hypot(x, y);
      const factor = length > limit && length > 0 ? limit / length : 1;
      x *= factor; y *= factor;
      const angularLimit = B.b2Body_GetRotationalInertia(id) * maxVelocityChange;
      const angular = Math.max(-angularLimit, Math.min(angularLimit, values[i * 4 + 2] / IMPULSE_MULTIPLIER * factor));
      this.impulseVector.Set(x, y);
      if (x || y) B.b2Body_ApplyLinearImpulseToCenter(id, this.impulseVector, true);
      if (angular) B.b2Body_ApplyAngularImpulse(id, angular, true);
    }
  }

  destroy() { this.version++; this.bridge?.delete(); this.impulseVector.delete(); this.bodies.length = 0; }
}
