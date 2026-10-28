export interface BoxRegion { type?: 'box'; x: number; y: number; width: number; height: number; enabled?: boolean }
export interface CircleRegion { type: 'circle'; x: number; y: number; radius: number; enabled?: boolean }
export interface PolygonRegion { type: 'polygon'; points: [number, number][]; enabled?: boolean }
export type Region = BoxRegion | CircleRegion | PolygonRegion;
export type MaterialName = 'water' | 'syrup' | 'rubber' | 'sand' | 'putty';
export interface MaterialParameters { viscosity: number; relaxation: number; elasticity: number; plasticity: number; frictionAngle: number; stiffness: number; color?: readonly number[] }
export interface MaterialProfile extends MaterialParameters { name: MaterialName; label: string; model: number; density: number; color: readonly number[] }
export const MATERIALS: readonly Readonly<MaterialProfile>[];
export type MaterialRegion = Region & { material?: MaterialName; velocity?: [number, number]; rotation?: number; color?: readonly number[] };
export type LiquidShape = Region & { kind: 'fill' | 'emitter' | 'drain' | 'burst' | 'erase'; material: MaterialName; rate: number; velocity: [number, number]; rotation: number; spawnFrame: number; color?: readonly number[] };
export interface DomainOptions { width?: number; height?: number; cellSize?: number; origin?: [number, number] }
export interface LiquidSettings {
  hz: number; solidHz: number; rigidHz: number; iterations: number; gravity: number; viscosity: number; relaxation: number;
  friction: number; particlesPerCellAxis: number; density: number; depth: number; feedback: boolean;
  /** Passive liquid dye blending per second; zero disables its GPU passes. */
  colorMixing: number;
}
export interface LiquidStats {
  particles: number; highWater: number; emitted: number; drained: number; rejected: number;
  cpuMs: number; box2dMs: number; gpuMs: number | null; gpuMsPerStep?: number;
  rigidSteps: number;
  deferredFrames: number;
  gpuBytes: number; bufferCount: number; droppedSeconds: number; skippedReadbacks: number; errors: string[];
}
export class SimulationDomain {
  constructor(options?: DomainOptions);
  readonly width: number; readonly height: number; readonly cellSize: number; readonly origin: [number, number];
  readonly gridWidth: number; readonly gridHeight: number; readonly version: number;
  readonly areas: Map<string, Region>;
  addArea(id: string, options: Region): Region;
  updateArea(id: string, options: Partial<Region>): Region;
  removeArea(id: string): void;
  contains(x: number, y: number): boolean;
  compile(): Float32Array;
  /** Cached contour of the area union as x1, y1, x2, y2 segments. */
  boundarySegments(): Float32Array;
  toGrid(x: number, y: number): [number, number];
  toWorld(x: number, y: number): [number, number];
}
export interface SmooshOptions extends DomainOptions {
  domain?: SimulationDomain; maxParticles?: number; maxSubsteps?: number; settings?: Partial<LiquidSettings>;
  canvas?: HTMLCanvasElement;
  /** Optional existing WebGPU device; request maxStorageBuffersPerShaderStage >= 8. */
  device?: any;
  /** Box2D module and an existing world ID. The application retains ownership. */
  box2d?: any; worldId?: any; nativeBridge?: boolean;
  /** Create and maintain Box2D walls for the union of simulation areas. Default false. */
  domainWalls?: boolean;
  /** Override embedded shaders with files served from this URL. */
  shaderBaseURL?: URL; onError?: (error: Error) => void;
}
export interface Box2DAttachmentOptions { native?: boolean; domainWalls?: boolean }
/** Creates a static body; the caller must destroy it. Prefer managed DomainWalls for editable areas. */
export function createDomainWalls(box2d: any, worldId: any, domain: SimulationDomain): any;
export class DomainWalls {
  constructor(box2d: any, worldId: any, domain: SimulationDomain);
  readonly body: any;
  /** Rebuilds only when the domain changes; returns the current static body. */
  sync(): any;
  destroy(): void;
}
export class Box2DAdapter {
  constructor(box2d: any, worldId: any, domain: SimulationDomain, options?: { native?: boolean });
  readonly native: boolean; readonly bodyCount: number; readonly version: number; readonly data: Float32Array;
  addBody(bodyId: any): void; removeBody(bodyId: any): void;
  /** Call after changing a registered body's fixture geometry. */
  invalidateGeometry(): void;
  refresh(bodyHorizon?: number): Float32Array;
  destroy(): void;
}
export class Smoosh {
  static create(options?: SmooshOptions): Promise<Smoosh>;
  readonly domain: SimulationDomain; readonly stats: LiquidStats; readonly maxParticles: number;
  readonly settings: LiquidSettings; readonly adapter?: Box2DAdapter; readonly frame: number;
  readonly walls?: DomainWalls;
  /** Actual fluid rate; solidHz is a minimum when elastic/plastic particles exist. */
  readonly simulationHz: number;
  /** True while GPU feedback must complete before the next advance(). */
  readonly gpuBusy: boolean;
  /** Simulated seconds, continuous across rate changes. */
  readonly time: number;
  readonly pointer: { x: number; y: number; vx: number; vy: number; radius: number; active: boolean; mode: 'push' | 'grab' };
  readonly renderer?: { mode: 'surface' | 'velocity' | 'particles'; scale: number; viewTransform: Float32Array };
  readonly device: any; readonly timestamps: boolean;
  setSettings(changes: Partial<LiquidSettings>): void;
  readonly materials: MaterialProfile[];
  setMaterial(name: MaterialName, changes: Partial<MaterialParameters>): void;
  addArea(id: string, options: Region): Region;
  attachBox2D(box2d: any, worldId: any, options?: Box2DAttachmentOptions): Box2DAdapter;
  fill(options: MaterialRegion): LiquidShape;
  /** Adds a one-shot material region at the current simulation frame. */
  pour(options: MaterialRegion): LiquidShape;
  /** Erases material in this region during the next submitted simulation batch. */
  erase(options: Region): LiquidShape;
  addEmitter(options: MaterialRegion & { rate?: number }): LiquidShape;
  addDrain(options: Region): LiquidShape;
  updateShape(shape: LiquidShape, changes: Partial<LiquidShape>): void;
  removeShape(shape: LiquidShape): void;
  /** Fixed steps with bounded catch-up. Returns zero while GPU feedback is pending; deferred wall time is dropped. */
  advance(deltaSeconds: number, options?: { render?: boolean; stepRigidBodies?: boolean }): number;
  step(steps?: number, options?: { render?: boolean; stepRigidBodies?: boolean }): void;
  /** Clears liquid and statistics; retains areas, shapes and registered rigid bodies. */
  reset(): void;
  /** Diagnostic full particle readback. Keep outside the frame loop. Stride: 24 floats. */
  inspectParticles(): Promise<Float32Array>;
  /** Releases Smoosh resources. The application still owns its Box2D world and any supplied GPU device. */
  destroy(): void;
}
