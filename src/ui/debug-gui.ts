/** ?debug panel: lil-gui for settings marked `debug: true`, plus exposure and quality. Lazy-loaded. */
import type { SettingDef, UiContext } from '../core/contracts';
import { QUALITY_PRESETS } from '../core/contracts';
import type { SettingsStoreImpl } from './settings';

export async function startDebugGui(ctx: UiContext, settings: SettingsStoreImpl): Promise<void> {
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'Cosmos debug' });
  gui.domElement.style.zIndex = '20';
  const state = {
    quality: ctx.quality.preset as string,
    compensation: ctx.render.exposure.compensation,
    ev: ctx.render.exposure.ev,
  };
  const eng = gui.addFolder('Engine');
  eng.add(state, 'quality', [...QUALITY_PRESETS]).onChange((v: string) => ctx.quality.set(v as never));
  eng
    .add(state, 'compensation', -8, 8, 0.25)
    .name('EV compensation')
    .onChange((v: number) => (ctx.render.exposure.compensation = v));
  const evCtl = eng.add(state, 'ev').name('EV100 (metered)').disable();
  ctx.render.onAfterFrame(() => {
    state.ev = Math.round(ctx.render.exposure.ev * 100) / 100;
    evCtl.updateDisplay();
  });
  const folders = new Map<string, ReturnType<typeof gui.addFolder>>();
  const added = new Set<string>();
  const add = (d: SettingDef) => {
    if (!d.debug || added.has(d.id)) return;
    added.add(d.id);
    let f = folders.get(d.group);
    if (!f) folders.set(d.group, (f = gui.addFolder(d.group)));
    const obj = { [d.id]: settings.get(d.id) ?? d.default };
    const set = (v: unknown) => settings.set(d.id, v as never);
    if (d.type === 'number') f.add(obj, d.id, d.min, d.max, d.step).name(d.label).onChange(set);
    else if (d.type === 'select')
      f.add(obj, d.id, Object.fromEntries((d.options ?? []).map((o) => [o.label, o.value])))
        .name(d.label)
        .onChange(set);
    else if (d.type === 'action') f.add({ run: () => settings.set(d.id, true) }, 'run').name(d.label);
    else f.add(obj, d.id).name(d.label).onChange(set);
  };
  for (const d of settings.definitions()) add(d);
  ctx.registry.subscribe((kind) => {
    if (kind === 'setting') for (const d of ctx.registry.settings()) add(d);
  });
}
