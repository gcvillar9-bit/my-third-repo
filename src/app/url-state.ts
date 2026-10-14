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

/** Canonical text of a hash (so encodings of the same state compare equal). */
export const canonicalHash = (h: string): string => formatHash(parseHash(h));

/** Minimal window surface UrlSync needs (injectable for unit tests). */
export interface UrlSyncHost {
  location: { hash: string; pathname: string; search: string; origin: string };
  history: { state: unknown; replaceState(data: unknown, unused: string, url?: string | null): void };
  addEventListener(type: 'hashchange', cb: () => void): void;
}

/**
 * Keeps location.hash in sync with the view (throttled) and applies external hash edits.
 *
 * P4-P fix (owner report: "the view throws me back to the same spot"): the hash that boot applied
 * (typically `#b=<bookmark>`) used to stay in the address bar for up to a second and was then only
 * remembered as `last`; any hashchange that brought back an earlier hash (a history step, a
 * trackpad back-swipe, a re-focused tab restoring the URL) re-ran the bookmark and snapped the
 * camera back. Now boot calls commit() right after the initial view, which replaces the hash
 * with the live state at once, and hashchange only applies a hash that is canonically different
 * from every hash this session wrote recently and from the one already applied.
 */
export class UrlSync {
  private last = '';
  private lastWrite = -Infinity;
  private readonly written: string[] = [];
  private readonly host: UrlSyncHost;

  constructor(
    private readonly read: () => UrlState,
    private readonly apply: (s: UrlState) => void,
    host?: UrlSyncHost,
  ) {
    this.host = host ?? (window as unknown as UrlSyncHost);
    this.last = canonicalHash(this.host.location.hash);
    this.host.addEventListener('hashchange', () => this.onHashChange());
  }

  private onHashChange(): void {
    const h = canonicalHash(this.host.location.hash);
    if (!h || h === this.last || this.written.includes(h)) return;
    this.last = h;
    this.apply(parseHash(h));
    // The user's hash has been applied: show the live state from now on (a bookmark id would
    // otherwise be re-applied by the next history step).
    this.lastWrite = -Infinity;
  }

  /** Writes the live state now (after boot applied the initial view). */
  commit(): void {
    this.write();
  }

  /** Call every frame; writes at most once per second when the state changed. */
  tick(nowMs: number): void {
    if (nowMs - this.lastWrite < 1000) return;
    this.lastWrite = nowMs;
    this.write();
  }

  private write(): void {
    const h = formatHash(this.read());
    if (h === this.last) return;
    this.last = h;
    this.written.push(h);
    if (this.written.length > 16) this.written.shift();
    const { location: loc, history } = this.host;
    history.replaceState(history.state, '', h || loc.pathname + loc.search);
  }

  /** Current share URL. */
  url(): string {
    return shareUrl(this.host.location, this.read());
  }
}
