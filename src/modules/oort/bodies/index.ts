/** Bodies part of the oort module (placeholder until the bodies package lands). */
import type { ModuleContext } from '../../../core/contracts';
import type { OortShared } from '../shared';

export async function initBodies(_ctx: ModuleContext, _shared: OortShared): Promise<() => void> {
  return () => {};
}
