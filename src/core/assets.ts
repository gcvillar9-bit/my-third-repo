/**
 * BASE_URL-aware asset loader (src/core/assets.ts). Paths are relative to public/, e.g.
 * 'data/stars/stars.bin'. Every load (and any work passed to `track`) counts towards
 * progress() and keeps whenIdle() / __universe.ready() pending.
 */
import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  MirroredRepeatWrapping,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from 'three';
import type { AssetLoader, AssetProgress, ResourceBudget, TextureOptions } from './contracts';

/** Joins the public base and a public-relative path. Absolute URLs pass through. */
export function joinBase(base: string, path: string): string {
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) return path;
  const b = base.endsWith('/') ? base : `${base}/`;
  return b + path.replace(/^\/+/, '');
}

export class AssetLoaderImpl implements AssetLoader {
  private loaded = 0;
  private total = 0;
  private bytes = 0;
  private inflight = new Set<Promise<unknown>>();
  private listeners = new Set<(p: AssetProgress) => void>();

  constructor(
    private readonly base: string = import.meta.env.BASE_URL,
    private readonly budget?: ResourceBudget,
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  url(path: string): string {
    return joinBase(this.base, path);
  }

  progress(): AssetProgress {
    return { loaded: this.loaded, total: this.total, bytes: this.bytes };
  }

  subscribe(listener: (p: AssetProgress) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const p = this.progress();
    for (const l of this.listeners) l(p);
  }

  track<T>(work: Promise<T>, _label?: string): Promise<T> {
    this.total++;
    this.inflight.add(work);
    this.emit();
    const done = () => {
      this.inflight.delete(work);
      this.loaded++;
      this.emit();
    };
    work.then(done, done);
    return work;
  }

  async whenIdle(): Promise<void> {
    // Loop: settled work may have scheduled more work.
    for (let i = 0; i < 1000; i++) {
      if (this.inflight.size === 0) {
        await new Promise<void>((r) => setTimeout(r, 0));
        if (this.inflight.size === 0) return;
      }
      await Promise.allSettled([...this.inflight]);
    }
  }

  private async fetchOk(path: string): Promise<Response> {
    const res = await this.fetchFn(this.url(path));
    if (!res.ok) throw new Error(`assets: ${res.status} ${res.statusText} for ${path}`);
    return res;
  }

  json<T = unknown>(path: string): Promise<T> {
    return this.track(
      this.fetchOk(path).then(async (r) => {
        const text = await r.text();
        this.bytes += text.length;
        return JSON.parse(text) as T;
      }),
      path,
    );
  }

  binary(path: string): Promise<ArrayBuffer> {
    return this.track(
      this.fetchOk(path)
        .then((r) => r.arrayBuffer())
        .then((b) => {
          this.bytes += b.byteLength;
          return b;
        }),
      path,
    );
  }

  text(path: string): Promise<string> {
    return this.track(
      this.fetchOk(path)
        .then((r) => r.text())
        .then((t) => {
          this.bytes += t.length;
          return t;
        }),
      path,
    );
  }

  texture(path: string, opts: TextureOptions = {}): Promise<Texture> {
    const work = new Promise<Texture>((resolve, reject) => {
      new TextureLoader().load(
        this.url(path),
        (tex) => {
          configureTexture(tex, opts);
          const img = tex.image as { width?: number; height?: number } | undefined;
          const px = (img?.width ?? 0) * (img?.height ?? 0);
          const bytes = Math.round(px * 4 * (opts.mipmaps === false ? 1 : 4 / 3));
          this.bytes += px * 4;
          if (this.budget && opts.owner) {
            const entry = this.budget.alloc(opts.owner, path, bytes);
            tex.addEventListener('dispose', () => entry.free());
          }
          resolve(tex);
        },
        undefined,
        () => reject(new Error(`assets: failed to load texture ${path}`)),
      );
    });
    return this.track(work, path);
  }
}

export function configureTexture(tex: Texture, opts: TextureOptions): void {
  tex.colorSpace = opts.colorSpace === 'linear' ? NoColorSpace : SRGBColorSpace;
  const wrap =
    opts.wrap === 'repeat'
      ? RepeatWrapping
      : opts.wrap === 'mirror'
        ? MirroredRepeatWrapping
        : ClampToEdgeWrapping;
  tex.wrapS = tex.wrapT = wrap;
  tex.generateMipmaps = opts.mipmaps !== false;
  tex.minFilter = tex.generateMipmaps ? LinearMipmapLinearFilter : LinearFilter;
  tex.magFilter = LinearFilter;
  if (opts.anisotropy) tex.anisotropy = opts.anisotropy;
  if (opts.flipY !== undefined) tex.flipY = opts.flipY;
  tex.needsUpdate = true;
}
