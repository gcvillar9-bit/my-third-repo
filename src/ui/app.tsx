/** @jsxImportSource preact */
/** Preact components of the UI shell: palette, info card, time bar, HUD, settings, toasts. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { QUALITY_PRESETS, type QualityPreset, type SettingDef } from '../core/contracts';
import { AUDIO_ENABLED_SETTING } from '../modules/audio/public';
import { photo } from '../modules/photo/public';
import { COSMIC_ZOOM_ID, tours } from '../modules/tours/public';
import type { UiController } from './controller';
import { LOG_SCALE_TICKS, logScaleFraction } from './format';

export const HELP_TEXT =
  '/ search · drag look · WASD fly · R/F up/down · Q/E roll · wheel or [ ] speed · , . time warp · K pause (or pause the tour) · N now · I info · G go to (walk when within 10 km of the ground: WASD walk, Shift run, Space jump) · O orbit · P photo mode · H hide UI · L copy link · M mute/unmute sound · Esc exit tour/photo';

function Palette({ ui }: { ui: UiController }) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => ui.search.search(text, 10), [text]);
  useEffect(() => input.current?.focus(), []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive((a) => Math.min(results.length - 1, a + 1));
    else if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
    else if (e.key === 'Enter') {
      const r = results[active] ?? results[0];
      if (r) ui.choose(r.entry);
    } else if (e.key === 'Escape') ui.paletteOpen.value = false;
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      class="cz-palette-wrap"
      onClick={(e) => e.target === e.currentTarget && (ui.paletteOpen.value = false)}
    >
      <div class="cz-panel cz-palette" role="dialog" aria-label="Search">
        <input
          ref={input}
          class="cz-palette-input"
          placeholder="Search planets, moons, stars, bookmarks…"
          value={text}
          onInput={(e) => {
            setText((e.target as HTMLInputElement).value);
            setActive(0);
          }}
          onKeyDown={onKey}
          spellcheck={false}
          autocomplete="off"
        />
        <ul class="cz-results" role="listbox">
          {results.map((r, i) => (
            <li
              key={r.entry.id}
              role="option"
              aria-selected={i === active}
              class={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onClick={() => ui.choose(r.entry)}
            >
              <span class="cz-result-name">{r.entry.name}</span>
              <span class="cz-result-sub">{r.entry.subtitle ?? r.entry.kind}</span>
            </li>
          ))}
          {results.length === 0 && <li class="cz-empty">No matches</li>}
        </ul>
      </div>
    </div>
  );
}

function InfoCardView({ ui }: { ui: UiController }) {
  const card = ui.infoCard.value;
  const id = ui.infoId.value;
  if (!card || !id) return null;
  const target = ui.targetOf(id);
  return (
    <div class="cz-panel cz-info" data-info-id={id}>
      <div class="cz-info-head">
        <div>
          <div class="cz-info-title">{card.title}</div>
          {card.subtitle && <div class="cz-info-sub">{card.subtitle}</div>}
        </div>
        <button class="cz-icon" title="Close (I)" onClick={() => ui.showInfo(null)}>
          ×
        </button>
      </div>
      {card.simulated && <div class="cz-badge warn">simulated</div>}
      <table class="cz-facts">
        <tbody>
          {card.facts.map((f, i) => (
            <tr key={i} title={f.source ?? ''}>
              <td>{f.label}</td>
              <td>
                {f.value}
                {f.unit ? ` ${f.unit}` : ''}
                {f.approximate && (
                  <span class="cz-approx" title="approximate">
                    ≈
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {card.description && <p class="cz-desc">{card.description}</p>}
      {card.links?.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noopener">
          {l.label}
        </a>
      ))}
      <div class="cz-info-foot">
        {target && (
          <button class="cz-btn" onClick={() => ui.fly(target)}>
            Fly there (G)
          </button>
        )}
        {card.credit && <span class="cz-credit">{card.credit}</span>}
      </div>
    </div>
  );
}

function TimeBar({ ui }: { ui: UiController }) {
  const t = ui.time.value;
  const { clock } = ui.ctx;
  // While editing, the picker keeps the value captured on click (the clock may be running).
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div class="cz-panel cz-timebar">
      <button class="cz-icon" title="Slower / reverse (,)" onClick={() => clock.warpStep(-1)}>
        ◀◀
      </button>
      <button
        class="cz-icon"
        title="Play / pause (P)"
        onClick={() => (t.paused ? (clock.rate === 0 ? clock.setRate(1) : clock.resume()) : clock.pause())}
      >
        {t.paused ? '▶' : '❚❚'}
      </button>
      <button class="cz-icon" title="Faster (.)" onClick={() => clock.warpStep(1)}>
        ▶▶
      </button>
      <span class="cz-rate" data-rate={clock.rate}>
        {t.rate}
      </span>
      {editing ? (
        <input
          class="cz-date-input"
          type="datetime-local"
          value={editing}
          onChange={(e) => {
            const v = (e.target as HTMLInputElement).value;
            if (v) clock.setTime(new Date(`${v}:00Z`));
            setEditing(null);
          }}
          onBlur={() => setEditing(null)}
        />
      ) : (
        <button
          class="cz-date"
          title="Set date and time (UTC)"
          onClick={() => setEditing(t.dateValue || null)}
        >
          {t.text}
        </button>
      )}
      <button class="cz-btn" title="Jump to the current time (N)" onClick={() => clock.setNow()}>
        Now
      </button>
      <span class="cz-badges">
        {t.badges.map((b) => (
          <span key={b.id} class={`cz-badge ${b.state === 'ok' ? 'ok' : 'warn'}`} title={b.title}>
            {b.label}
          </span>
        ))}
      </span>
    </div>
  );
}

function Hud({ ui }: { ui: UiController }) {
  const h = ui.hud.value;
  const { camera } = ui.ctx;
  return (
    <div
      class="cz-panel cz-hud"
      data-target={h.targetId ?? ''}
      data-traveling={h.traveling ? '1' : '0'}
      data-frame={h.frame}
    >
      <div class="cz-hud-row">
        <span class="cz-k">speed</span> <span class="cz-v">{h.speed}</span>
        {h.traveling && <span class="cz-badge ok">flying</span>}
      </div>
      {h.targetName && (
        <div class="cz-hud-row">
          <span class="cz-k">target</span>{' '}
          <button class="cz-link" onClick={() => h.targetId && ui.select(h.targetId)}>
            {h.targetName}
          </button>
          {h.distance && (
            <>
              {' '}
              <span class="cz-v">{h.distance}</span> <span class="cz-k">light</span>{' '}
              <span class="cz-v">{h.lightTime}</span>
            </>
          )}
        </div>
      )}
      <div class="cz-scale" title={`scale: ${h.scaleText}`}>
        <div class="cz-scale-bar">
          {LOG_SCALE_TICKS.map((tk) => (
            <span key={tk.label} class="cz-tick" style={{ left: `${logScaleFraction(tk.d) * 100}%` }}>
              {tk.label}
            </span>
          ))}
          <span class="cz-marker" style={{ left: `${h.scaleFrac * 100}%` }} />
        </div>
      </div>
      <div class="cz-crumbs">
        {h.crumbs.map((c, i) => (
          <span key={c.id}>
            {i > 0 && ' › '}
            <button
              class="cz-link"
              disabled={!ui.ctx.registry.body(c.id)}
              onClick={() => ui.ctx.registry.body(c.id) && ui.fly(c.id, c.id)}
            >
              {c.label}
            </button>
          </span>
        ))}
        <span class="cz-k"> · {camera.mode}</span>
      </div>
    </div>
  );
}

function SettingControl({ ui, def }: { ui: UiController; def: SettingDef }) {
  const v = ui.settings.get(def.id);
  const set = (x: boolean | number | string) => ui.settings.set(def.id, x);
  let control;
  if (def.type === 'boolean')
    control = (
      <input
        type="checkbox"
        checked={v === true}
        onChange={(e) => set((e.target as HTMLInputElement).checked)}
      />
    );
  else if (def.type === 'number')
    control = (
      <input
        type="range"
        min={def.min}
        max={def.max}
        step={def.step ?? 'any'}
        value={Number(v)}
        onInput={(e) => set(Number((e.target as HTMLInputElement).value))}
      />
    );
  else if (def.type === 'select')
    control = (
      <select value={String(v)} onChange={(e) => set((e.target as HTMLSelectElement).value)}>
        {def.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  else
    control = (
      <button class="cz-btn" onClick={() => set(true)}>
        Run
      </button>
    );
  return (
    <label class="cz-setting" title={def.description ?? ''}>
      <span>{def.label}</span>
      {control}
    </label>
  );
}

function SettingsPanel({ ui }: { ui: UiController }) {
  void ui.settingsVersion.value;
  const { quality } = ui.ctx;
  const [preset, setPreset] = useState<QualityPreset>(quality.preset);
  const groups = new Map<string, SettingDef[]>();
  for (const d of ui.settings.definitions()) {
    if (d.debug) continue;
    groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
  }
  return (
    <div class="cz-panel cz-settings">
      <div class="cz-info-head">
        <div class="cz-info-title">Settings</div>
        <button class="cz-icon" onClick={() => (ui.settingsOpen.value = false)}>
          ×
        </button>
      </div>
      <label class="cz-setting">
        <span>Quality</span>
        <select
          value={preset}
          onChange={(e) => {
            const p = (e.target as HTMLSelectElement).value as QualityPreset;
            quality.set(p);
            setPreset(p);
          }}
        >
          {QUALITY_PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      {[...groups].map(([g, defs]) => (
        <fieldset key={g}>
          <legend>{g}</legend>
          {defs.map((d) => (
            <SettingControl key={d.id} ui={ui} def={d} />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

/** Speaker button: toggles the audio module's Sound setting (hidden when that module is absent). */
function MuteButton({ ui }: { ui: UiController }) {
  void ui.settingsVersion.value;
  if (!ui.settings.definitions().some((d) => d.id === AUDIO_ENABLED_SETTING)) return null;
  const on = ui.settings.get(AUDIO_ENABLED_SETTING) === true;
  return (
    <button
      class="cz-btn cz-mute-btn"
      title={on ? 'Mute sound (M)' : 'Unmute sound (M)'}
      aria-label={on ? 'Mute sound' : 'Unmute sound'}
      aria-pressed={!on}
      onClick={() => ui.settings.set(AUDIO_ENABLED_SETTING, !on)}
    >
      <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" style="vertical-align:-1px">
        <path d="M1 4h3l4-3v10L4 8H1z" fill="currentColor" />
        {on ? (
          <path d="M10 3.5a3.5 3.5 0 0 1 0 5M11.5 1.5a6 6 0 0 1 0 9" stroke="currentColor" fill="none" />
        ) : (
          <path d="M9.5 4l4 4m0-4l-4 4" stroke="currentColor" fill="none" />
        )}
      </svg>
    </button>
  );
}

export function App({ ui }: { ui: UiController }) {
  const hud = ui.hudVisible.value;
  return (
    <div class="cz-root">
      {hud && (
        <>
          <div class="cz-topbar">
            <button class="cz-btn" title="Search (/ or Ctrl+K)" onClick={() => (ui.paletteOpen.value = true)}>
              ⌕ Search <kbd>/</kbd>
            </button>
            <button
              class="cz-btn cz-tour-btn"
              title="Take the Cosmic Zoom tour: from the Moon to the cosmic web (Esc exits)"
              onClick={() => {
                if (tours.status()) tours.stop();
                else tours.start(COSMIC_ZOOM_ID);
              }}
            >
              ▶ Tour
            </button>
            <button class="cz-btn cz-photo-btn" title="Photo mode (P)" onClick={() => photo.toggle()}>
              Photo
            </button>
            <button class="cz-btn" title="Copy a link to this view (L)" onClick={() => void ui.copyLink()}>
              Copy link
            </button>
            <MuteButton ui={ui} />
            <button
              class="cz-btn"
              title="Settings"
              onClick={() => (ui.settingsOpen.value = !ui.settingsOpen.value)}
            >
              ⚙
            </button>
            <button
              class="cz-btn"
              title="Keyboard help (?)"
              onClick={() => (ui.helpOpen.value = !ui.helpOpen.value)}
            >
              ?
            </button>
          </div>
          <Hud ui={ui} />
          <TimeBar ui={ui} />
          <InfoCardView ui={ui} />
          {ui.settingsOpen.value && <SettingsPanel ui={ui} />}
          <div class={`cz-help ${ui.helpOpen.value ? 'open' : ''}`}>{HELP_TEXT}</div>
        </>
      )}
      {ui.caption.value && <div class="cz-caption">{ui.caption.value}</div>}
      <div class="cz-toasts">
        {ui.toasts.value.map((t) => (
          <div key={t.id} class={`cz-panel cz-toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
      {ui.paletteOpen.value && <Palette ui={ui} />}
    </div>
  );
}
