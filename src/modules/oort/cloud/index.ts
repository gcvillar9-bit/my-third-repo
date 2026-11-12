/** Cloud part of the oort module (placeholder until the cloud package lands). */
import type { ModuleContext } from '../../../core/contracts';
import type { OortShared } from '../shared';

export async function initCloud(_ctx: ModuleContext, _shared: OortShared): Promise<() => void> {
  return () => {};
}
