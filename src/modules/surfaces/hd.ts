/**
 * 'HD Earth terrain' layer: on by default outside test mode, off at potato quality (setting
 * 'surfaces.hdEarth'); ?hdterrain=1 forces it on (test mode and potato included), ?hdterrain=0 turns it
 * off. Below 300 km the main thread fetches the 3x3 block of AWS Terrarium tiles (z5-z12 by altitude)
 * around the camera's sub-point, each with an 8 s AbortController timeout, keeps them as blob: URLs
 * and registers a new Earth HeightSourceSpec (priority 6) whose params name those URLs; the terrain
 * workers and the collision function fetch the blobs, so the streamed heights replace the baked 2k
 * relief inside the block and fade into it at the edges. If every tile of a block fails, the baked
 * raster stays and a "HD layer unavailable" toast is shown once. The zoom and the block keep a little
 * hysteresis (HD_ZOOM_HYSTERESIS, HD_TILE_MARGIN), so a camera hovering at a zoom threshold or a tile
 * edge does not swap the Earth height function back and forth.
 */
import type {
  AssetLoader,
  Body,
  HeightSourceSpec,
  QualityPreset,
  Registry,
  UiApi,
  ViewState,
} from '../../core/contracts';
import { qrotateInv, quat, v3len, vec3 } from '../../core/math64';
import { heightBound, type HdBlock, type SurfaceHeightParams } from './heightfield';
import { lonLatToTile, terrariumTileUrl } from './terrarium';

export const HD_SETTING_ID = 'surfaces.hdEarth';
export const HD_URL_PARAM = 'hdterrain';
export const HD_PRIORITY = 6;
export const HD_TIMEOUT_MS = 8000;
export const HD_MAX_ALTITUDE = 300e3;
export const HD_GRID = 3;
/** Zoom levels the altitude must pass a threshold by (about 11 %) before the current zoom changes. */
export const HD_ZOOM_HYSTERESIS = 0.15;
/** Tiles the camera may stray past the current block's middle tile before the block moves. */
export const HD_TILE_MARGIN = 0.2;
/** How long (ms) a replaced or dropped block's blob: URLs live on for worker builds still fetching them. */
const REVOKE_DELAY_MS = 60_000;

/**
 * Terrarium zoom for a camera altitude (m): tiles roughly 12 altitudes wide, z5-z12. With the current
 * zoom `prev`, that zoom is kept until the altitude is HD_ZOOM_HYSTERESIS zoom levels past a threshold.
 */
export const hdZoom = (alt: number, prev?: number): number => {
  const v = Math.log2(4e7 / (Math.max(alt, 100) * 12));
  const z = prev !== undefined && Math.abs(v - prev) < 0.5 + HD_ZOOM_HYSTERESIS ? prev : Math.round(v);
  return Math.max(5, Math.min(12, z));
};

/** First tile of the block on one axis: the current one while the camera (tile t) is near its middle. */
const blockStart = (t: number, max: number, cur: number | null): number => {
  if (cur !== null && t > cur + 1 - HD_TILE_MARGIN && t < cur + 2 + HD_TILE_MARGIN) return cur;
  return Math.max(0, Math.min(max, Math.floor(t) - 1));
};

/** Setting gate: ?hdterrain=1 forces the layer on, ?hdterrain=0 off; else the setting, never in test mode. */
export const hdTerrainAllowed = (flag: string | null, test: boolean, setting: unknown): boolean =>
  flag === '1' || (flag !== '0' && !test && setting !== false);

/** Quality gate (per frame): off at potato unless ?hdterrain=1. */
export const hdTerrainQualityOk = (flag: string | null, quality: QualityPreset): boolean =>
  flag === '1' || quality !== 'potato';

export interface HdDeps {
  registry: Registry;
  assets: AssetLoader;
  ui: Pick<UiApi, 'toast'>;
  body: Body;
  base: HeightSourceSpec;
  /** Per-frame gate on top of setEnabled (quality preset); open when omitted. */
  gate?: (view: ViewState) => boolean;
}

export class HdEarthTerrain {
  private enabled = false;
  /** Last result of HdDeps.gate. */
  private gateOpen = true;
  private busy = false;
  private key = '';
  /** Zoom and first tile of the registered block (valid while key is set). */
  private z = 0;
  private x0 = 0;
  private y0 = 0;
  private urls: string[] = [];
  private readonly failed = new Set<string>();
  private toasted = false;
  private readonly rel = vec3();
  private readonly q = quat();

  constructor(private readonly d: HdDeps) {}

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this.dropBlock();
  }

  /** Back to the baked relief (a spec at the HD priority with the base parameters). */
  private dropBlock(): void {
    if (!this.key) return;
    this.key = '';
    retire(this.urls);
    this.urls = [];
    this.d.registry.addHeightSource({ ...this.d.base, priority: HD_PRIORITY });
  }

  onFrame(view: ViewState): void {
    if (!this.enabled) return;
    this.gateOpen = this.d.gate?.(view) ?? true;
    if (!this.gateOpen) {
      this.dropBlock();
      return;
    }
    if (this.busy) return;
    const b = this.d.body;
    // Camera in body-fixed axes: -(body - camera), rotated into the fixed frame.
    view.toCamera(b.frame, vec3(), this.rel);
    this.rel.x = -this.rel.x;
    this.rel.y = -this.rel.y;
    this.rel.z = -this.rel.z;
    view.frameQuat(b.fixedFrame ?? b.frame, this.q);
    const c = qrotateInv(vec3(), this.q, this.rel);
    const r = v3len(c);
    const a = b.radius;
    const cc = a * (1 - (b.oblateness ?? 0));
    const alt =
      r - 1 / Math.sqrt((c.x * c.x + c.y * c.y) / (r * r * a * a) + (c.z * c.z) / (r * r * cc * cc));
    if (alt > HD_MAX_ALTITUDE || r === 0) return;
    const lon = (Math.atan2(c.y, c.x) * 180) / Math.PI;
    const lat = (Math.asin(c.z / r) * 180) / Math.PI;
    const z = hdZoom(alt, this.key ? this.z : undefined);
    const t = lonLatToTile(lon, lat, z);
    const max = 2 ** z - HD_GRID;
    const same = this.key !== '' && z === this.z;
    const x0 = blockStart(t.x, max, same ? this.x0 : null);
    const y0 = blockStart(t.y, max, same ? this.y0 : null);
    const key = `${z}/${x0}/${y0}`;
    if (key === this.key || this.failed.has(key)) return;
    this.busy = true;
    const work = this.load(z, x0, y0, key).finally(() => {
      this.busy = false;
    });
    void this.d.assets.track(work, 'surfaces:hd-earth');
  }

  private async load(z: number, x0: number, y0: number, key: string): Promise<void> {
    const jobs: Promise<string | null>[] = [];
    for (let j = 0; j < HD_GRID; j++)
      for (let i = 0; i < HD_GRID; i++) jobs.push(fetchTile(terrariumTileUrl(z, x0 + i, y0 + j)));
    const urls = await Promise.all(jobs);
    if (urls.every((u) => u === null)) {
      this.failed.add(key);
      if (!this.toasted) {
        this.toasted = true;
        this.d.ui.toast('HD layer unavailable: using the built-in Earth terrain', { kind: 'warn' });
      }
      return;
    }
    if (!this.enabled || !this.gateOpen) {
      for (const u of urls) if (u) URL.revokeObjectURL(u);
      return;
    }
    retire(this.urls);
    this.urls = urls.filter((u): u is string => u !== null);
    this.key = key;
    this.z = z;
    this.x0 = x0;
    this.y0 = y0;
    const hd: HdBlock = { z, x0, y0, n: HD_GRID, urls };
    const base = this.d.base.params as SurfaceHeightParams;
    const params: SurfaceHeightParams = { ...base, hd };
    params.maxAbs = heightBound(params);
    this.d.registry.addHeightSource({
      ...this.d.base,
      params,
      maxAbsHeight: params.maxAbs,
      priority: HD_PRIORITY,
    });
  }
}

/** Revokes a replaced block's blob: URLs once worker builds still fetching them are done. */
function retire(urls: string[]): void {
  if (urls.length) setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), REVOKE_DELAY_MS);
}

/** One tile as a blob: URL, or null on HTTP error, network error or timeout. */
async function fetchTile(url: string): Promise<string | null> {
  const ctl = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => ctl.abort(), HD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, mode: 'cors' });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
