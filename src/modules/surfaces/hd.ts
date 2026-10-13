/**
 * Optional 'HD Earth terrain' layer (off by default; setting 'surfaces.hdEarth' or URL ?hdterrain=1).
 * Below 300 km the main thread fetches the 3x3 block of AWS Terrarium tiles (z5-z12 by altitude)
 * around the camera's sub-point, each with an 8 s AbortController timeout, keeps them as blob: URLs
 * and registers a new Earth HeightSourceSpec (priority 6) whose params name those URLs; the terrain
 * workers and the collision function fetch the blobs, so the streamed heights replace the baked 2k
 * relief inside the block and fade into it at the edges. If every tile of a block fails, the baked
 * raster stays and a "HD layer unavailable" toast is shown once.
 */
import type { AssetLoader, Body, HeightSourceSpec, Registry, UiApi, ViewState } from '../../core/contracts';
import { qrotateInv, quat, v3len, vec3 } from '../../core/math64';
import { heightBound, type HdBlock, type SurfaceHeightParams } from './heightfield';
import { lonLatToTile, terrariumTileUrl } from './terrarium';

export const HD_SETTING_ID = 'surfaces.hdEarth';
export const HD_URL_PARAM = 'hdterrain';
export const HD_PRIORITY = 6;
export const HD_TIMEOUT_MS = 8000;
export const HD_MAX_ALTITUDE = 300e3;
export const HD_GRID = 3;

/** Terrarium zoom for a camera altitude (m): tiles roughly 12 altitudes wide, z5-z12. */
export const hdZoom = (alt: number): number =>
  Math.max(5, Math.min(12, Math.round(Math.log2(4e7 / (Math.max(alt, 100) * 12)))));

export interface HdDeps {
  registry: Registry;
  assets: AssetLoader;
  ui: Pick<UiApi, 'toast'>;
  body: Body;
  base: HeightSourceSpec;
}

export class HdEarthTerrain {
  private enabled = false;
  private busy = false;
  private key = '';
  private urls: string[] = [];
  private readonly failed = new Set<string>();
  private toasted = false;
  private readonly rel = vec3();
  private readonly q = quat();

  constructor(private readonly d: HdDeps) {}

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on && this.key) {
      this.key = '';
      this.d.registry.addHeightSource({ ...this.d.base, priority: HD_PRIORITY });
    }
  }

  onFrame(view: ViewState): void {
    if (!this.enabled || this.busy) return;
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
    const z = hdZoom(alt);
    const t = lonLatToTile(lon, lat, z);
    const max = 2 ** z - HD_GRID;
    const x0 = Math.max(0, Math.min(max, Math.floor(t.x) - 1));
    const y0 = Math.max(0, Math.min(max, Math.floor(t.y) - 1));
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
    if (!this.enabled) {
      for (const u of urls) if (u) URL.revokeObjectURL(u);
      return;
    }
    const old = this.urls;
    setTimeout(() => old.forEach((u) => URL.revokeObjectURL(u)), 60_000);
    this.urls = urls.filter((u): u is string => u !== null);
    this.key = key;
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
