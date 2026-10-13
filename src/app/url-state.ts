/**
 * URL state (DESIGN P1-A): `#f=<frame>&p=<x,y,z>&q=<x,y,z,w>&t=<ISO|JD>` or `#b=<bookmark>`.
 * Numbers use JS shortest round-trip formatting, so parse(format(s)) reproduces s exactly.
 * Outside test mode the hash follows the camera (history.replaceState, at most once per second),
 * so copying the address bar (or copyLink()) shares the current view.
 */
import type { CameraState, FrameId, JD, Quatd, Vec3d } from '../core/contracts';
import { jdToIso, parseInstant } from '../core/time';

export interface UrlState {
  /** Bookmark id (takes precedence over f/p/q). */
  b?: string;
  f?: FrameId;
  p?: Vec3d;
  q?: Quatd;
  /** Instant: ISO-8601 UTC, or a JD (TT) number as text outside the Date range. */
  t?: string;
}

/** Shortest round-trip text without '+' (which URLSearchParams would read as a space). */
const num = (v: number): string => String(v).replace('e+', 'e');

const nums = (s: string | null, n: number): number[] | null => {
  if (!s) return null;
  const v = s.split(',').map(Number);
  return v.length === n && v.every(Number.isFinite) ? v : null;
};

export function parseHash(hash: string): UrlState {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const out: UrlState = {};
  const b = params.get('b');
  if (b) out.b = b;
  const f = params.get('f');
  if (f) out.f = f;
  const p = nums(params.get('p'), 3);
  if (p) out.p = { x: p[0], y: p[1], z: p[2] };
  const q = nums(params.get('q'), 4);
  if (q) out.q = { x: q[0], y: q[1], z: q[2], w: q[3] };
  const t = params.get('t');
  if (t) out.t = t;
  return out;
}

export function formatHash(s: UrlState): string {
  const parts: string[] = [];
  if (s.b) parts.push(`b=${encodeURIComponent(s.b)}`);
  else {
    if (s.f) parts.push(`f=${encodeURIComponent(s.f)}`);
    if (s.p) parts.push(`p=${[s.p.x, s.p.y, s.p.z].map(num).join(',')}`);
    if (s.q) parts.push(`q=${[s.q.x, s.q.y, s.q.z, s.q.w].map(num).join(',')}`);
  }
  if (s.t) parts.push(`t=${encodeURIComponent(s.t)}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

/** Hash state of a camera pose at an instant (quaternion rounded to 1e-9). */
export function stateFromCamera(cam: CameraState, jd: JD): UrlState {
  const r = (v: number) => Math.round(v * 1e9) / 1e9;
  return {
    f: cam.frame,
    p: { ...cam.local },
    q: { x: r(cam.quat.x), y: r(cam.quat.y), z: r(cam.quat.z), w: r(cam.quat.w) },
    t: jdToIso(jd) ?? String(jd),
  };
}

/** JD (TT) of a `t` value, or null. */
export const instantOf = (t: string | undefined): JD | null => (t ? parseInstant(t) : null);

/** Full share URL for the current page and a state. */
export function shareUrl(loc: { origin: string; pathname: string; search: string }, s: UrlState): string {
  const search = new URLSearchParams(loc.search);
  // Test-only parameters never go into shared links.
  for (const k of ['test', 'b', 't', 'ev', 'seed']) search.delete(k);
  const qs = search.toString();
  return `${loc.origin}${loc.pathname}${qs ? `?${qs}` : ''}${formatHash(s)}`;
}

/** Copies text to the clipboard (falls back to a hidden textarea). */
export async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Keeps location.hash in sync with the view (throttled) and reports external hash edits. */
export class UrlSync {
  private last = '';
  private lastWrite = 0;

  constructor(
    private readonly read: () => UrlState,
    private readonly apply: (s: UrlState) => void,
  ) {
    window.addEventListener('hashchange', () => {
      if (location.hash === this.last) return;
      this.last = location.hash;
      this.apply(parseHash(location.hash));
    });
  }

  /** Call every frame; writes at most once per second when the state changed. */
  tick(nowMs: number): void {
    if (nowMs - this.lastWrite < 1000) return;
    this.lastWrite = nowMs;
    const h = formatHash(this.read());
    if (h === this.last) return;
    this.last = h;
    history.replaceState(history.state, '', h || location.pathname + location.search);
  }

  /** Current share URL. */
  url(): string {
    return shareUrl(location, this.read());
  }
}
