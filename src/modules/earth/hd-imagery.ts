/**
 * HD imagery near the ground: below 1200 km above Earth, a 4 x 4 block of NASA GIBS Blue Marble Next
 * Generation tiles (EPSG:4326, 512 px, about 490 m per pixel at level 7; public domain) around the
 * camera's sub-point is fetched in the browser, composited off-screen and blended into the day map
 * (uEarthHd*, shading-earth.glsl) with feathered edges. The block re-centres when the sub-point leaves
 * its middle; the old block stays until the new one is complete. Off in test mode unless
 * ?hdimagery=1 (e2e routes the tile URLs to a fixture), and on potato.
 */
import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Vector4,
  type IUniform,
} from 'three';
import type { AssetLoader, BudgetEntry, ResourceBudget, ViewState } from '../../core/contracts';
import { qrotateInv, quat, vec3 } from '../../core/math64';

export const GIBS_TEMPLATE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_NextGeneration/default/500m/{z}/{y}/{x}.jpeg';
/** Tile size of GIBS EPSG:4326 matrices, px; level 0 tiles span 288 degrees. */
export const GIBS_TILE_PX = 512;
export const GIBS_MAX_LEVEL = 7;
/** Tiles per block side. */
export const BLOCK = 4;
/** Active below this altitude above the ground, m. */
export const HD_IMAGERY_ALTITUDE_M = 1.2e6;

/** Degrees spanned by one tile at a level. */
export const tileDeg = (level: number) => 288 / 2 ** level;

/** Level for an altitude: about one tile pixel per screen pixel at 1080p (finest from 600 km down). */
export function levelFor(altitudeM: number): number {
  return altitudeM < 6e5 ? 7 : 6;
}

export interface Block {
  level: number;
  /** Top-left tile column and row. */
  col0: number;
  row0: number;
  /** Extent: west longitude, south latitude, width and height, degrees. */
  lon0: number;
  lat0: number;
  dLon: number;
  dLat: number;
}

/** The 4 x 4 block centred on (lat, lon) at a level (columns wrap; rows clamp at the poles). */
export function blockAt(latDeg: number, lonDeg: number, level: number): Block {
  const t = tileDeg(level);
  const cols = Math.ceil(360 / t);
  const rows = Math.ceil(180 / t);
  const col = Math.floor((lonDeg + 180) / t);
  const row = Math.floor((90 - latDeg) / t);
  const col0 = (((col - BLOCK / 2 + 1) % cols) + cols) % cols;
  const row0 = Math.min(Math.max(0, row - BLOCK / 2 + 1), Math.max(0, rows - BLOCK));
  return {
    level,
    col0,
    row0,
    lon0: -180 + col0 * t,
    lat0: 90 - (row0 + BLOCK) * t,
    dLon: BLOCK * t,
    dLat: BLOCK * t,
  };
}

/**
 * Is the point inside the middle half of the block (no re-centre needed)? Bounds are inclusive, so a point on
 * a tile edge is inside the block just centred on it (no reload every frame).
 */
export function insideMiddle(b: Block, latDeg: number, lonDeg: number): boolean {
  const eps = 1e-9;
  // Longitude offset from the block centre, wrapped to [-180, 180): aliases every 360 degrees, not
  // every block.
  let dx = lonDeg - b.lon0 - b.dLon / 2;
  dx -= 360 * Math.floor((dx + 180) / 360);
  if (Math.abs(dx) > b.dLon / 4 + eps) return false;
  // Rows clamp at the poles: a block touching a pole drops only its bound on that side.
  const dy = latDeg - b.lat0 - b.dLat / 2;
  const q = b.dLat / 4 + eps;
  return (dy >= -q || b.lat0 <= -89.9) && (dy <= q || b.lat0 + b.dLat >= 89.9);
}

export function tileUrl(level: number, row: number, col: number): string {
  return GIBS_TEMPLATE.replace('{z}', String(level)).replace('{y}', String(row)).replace('{x}', String(col));
}

export interface HdImageryDeps {
  assets: AssetLoader;
  budget: ResourceBudget;
  /** Enabled at all (URL flag, quality, test mode). */
  enabled(view: ViewState): boolean;
  /** Called once when tiles cannot be loaded. */
  onUnavailable?(): void;
}

/** Uniforms for shading-earth.glsl: sampler, rect (u0, v0, du, dv in equirect uv) and mix. */
const HD_PLACEHOLDER = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
HD_PLACEHOLDER.needsUpdate = true;

export function createHdUniforms(): Record<string, IUniform> {
  return {
    uEarthHd: { value: HD_PLACEHOLDER },
    uEarthHdRect: { value: new Vector4(0, 0, 1, 1) },
    uEarthHdMix: { value: 0 },
  };
}

export class HdImagery {
  private block: Block | null = null;
  private loading: Block | null = null;
  private failedKey = '';
  private texture: CanvasTexture | null = null;
  private entry: BudgetEntry | null = null;
  private warned = false;
  private q = quat();

  constructor(
    private deps: HdImageryDeps,
    private uniforms: Record<string, IUniform>,
  ) {}

  update(view: ViewState, frame: string): void {
    const near = view.nearestSurface();
    const on =
      this.deps.enabled(view) && !!near && near.bodyId === 'earth' && near.altitude < HD_IMAGERY_ALTITUDE_M;
    this.uniforms.uEarthHdMix.value = on && this.block ? 1 : 0;
    if (!on) return;
    const o = view.toCamera(frame, vec3(), vec3());
    view.frameQuat(frame, this.q);
    const p = qrotateInv(vec3(), this.q, vec3(-o.x, -o.y, -o.z));
    const r = Math.hypot(p.x, p.y, p.z);
    const lat = (Math.asin(p.z / r) * 180) / Math.PI;
    const lon = (Math.atan2(p.y, p.x) * 180) / Math.PI;
    const level = levelFor(near!.altitude);
    const cur = this.loading ?? this.block;
    if (cur && cur.level === level && insideMiddle(cur, lat, lon)) return;
    const want = blockAt(lat, lon, level);
    const key = `${want.level}/${want.row0}/${want.col0}`;
    if (key === this.failedKey) return;
    this.load(want, key);
  }

  private load(b: Block, key: string): void {
    this.loading = b;
    const cols = Math.ceil(360 / tileDeg(b.level));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = BLOCK * GIBS_TILE_PX;
    const ctx = canvas.getContext('2d')!;
    const jobs: Promise<void>[] = [];
    for (let j = 0; j < BLOCK; j++)
      for (let i = 0; i < BLOCK; i++) {
        const url = tileUrl(b.level, b.row0 + j, (b.col0 + i) % cols);
        jobs.push(
          fetch(url)
            .then((res) => {
              if (!res.ok) throw new Error(`GIBS ${res.status} for ${url}`);
              return res.blob();
            })
            .then((blob) => createImageBitmap(blob))
            .then((img) => {
              ctx.drawImage(img, i * GIBS_TILE_PX, j * GIBS_TILE_PX, GIBS_TILE_PX, GIBS_TILE_PX);
              img.close();
            }),
        );
      }
    const done = Promise.all(jobs).then(
      () => {
        if (this.loading !== b) return;
        this.loading = null;
        this.swap(canvas, b);
      },
      (e: unknown) => {
        if (this.loading !== b) return;
        this.loading = null;
        this.failedKey = key;
        if (!this.warned) {
          this.warned = true;
          console.warn('[earth] HD imagery unavailable; keeping the base map', e);
          this.deps.onUnavailable?.();
        }
      },
    );
    this.deps.assets.track(done, 'earth.hd-imagery');
  }

  private swap(canvas: HTMLCanvasElement, b: Block): void {
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = 4;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    this.texture?.dispose();
    this.texture = t;
    this.block = b;
    this.uniforms.uEarthHd.value = t;
    (this.uniforms.uEarthHdRect.value as Vector4).set(
      (b.lon0 + 180) / 360,
      (b.lat0 + 90) / 180,
      b.dLon / 360,
      b.dLat / 180,
    );
    if (!this.entry)
      this.entry = this.deps.budget.alloc('earth', 'hd-imagery', (canvas.width * canvas.height * 4 * 4) / 3);
  }

  dispose(): void {
    this.texture?.dispose();
    this.texture = null;
    this.entry?.free();
    this.entry = null;
  }
}
