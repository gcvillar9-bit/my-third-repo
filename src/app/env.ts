/** Boot environment from the URL (AppEnv). */
import type { AppEnv } from '../core/contracts';

export function parseEnv(search: string, baseUrl: string, dev = false): AppEnv {
  const params = new URLSearchParams(search);
  const seed = Number(params.get('seed') ?? '1');
  return {
    test: params.get('test') === '1',
    debug: params.has('debug') || dev,
    perf: params.get('perf') === '1',
    seed: Number.isFinite(seed) ? seed : 1,
    baseUrl,
    params,
  };
}
