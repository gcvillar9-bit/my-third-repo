/**
 * Download helpers (DESIGN 4.1). All network access goes through curl, which is configured for the
 * container proxy and CA bundle; Node's fetch ignores HTTPS_PROXY. Downloads land in .cache/raw/
 * (gitignored). Only processed outputs under public/ are committed.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
export const CACHE_RAW = join(ROOT, '.cache', 'raw');
export const PUBLIC = join(ROOT, 'public');

/** Downloads `url` to `dest` with `curl -fsSL --retry 3` (atomic rename). Returns `dest`. */
export function curlDownload(url, dest, { retries = 3 } = {}) {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  rmSync(tmp, { force: true });
  try {
    execFileSync(
      'curl',
      ['-fsSL', '--retry', String(retries), '--retry-delay', '2', '--connect-timeout', '30', '-o', tmp, url],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
  } catch (err) {
    rmSync(tmp, { force: true });
    throw new Error(`curl failed for ${url}: ${err.message}`);
  }
  if (isLfsPointer(tmp)) {
    rmSync(tmp, { force: true });
    throw new Error(`${url} returned a Git LFS pointer; use media.githubusercontent.com for LFS files`);
  }
  renameSync(tmp, dest);
  return dest;
}

/** True when the file is a Git LFS pointer text instead of the real payload. */
export function isLfsPointer(path) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(64);
    const n = readSync(fd, buf, 0, 64, 0);
    return buf.subarray(0, n).toString('latin1').startsWith('version https://git-lfs');
  } finally {
    closeSync(fd);
  }
}

/** Hex sha256 of a file. */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Downloads only when missing (or `force`). Returns the local path. */
export function cachedDownload(url, dest, { force = false } = {}) {
  if (force || !existsSync(dest)) curlDownload(url, dest);
  return dest;
}
