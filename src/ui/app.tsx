/** @jsxImportSource preact */
/** Preact components of the UI shell: top bar, palette, Explore, tours, info card, time bar, HUD, settings, help. */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { QUALITY_PRESETS, type QualityPreset, type SettingDef } from '../core/contracts';
import { ERA_PRESETS, parseUserInstant } from '../core/geotime';
import { qualityControl } from '../app/auto-quality';
import { AUDIO_ENABLED_SETTING } from '../modules/audio/public';
import { photo } from '../modules/photo/public';
import { tours } from '../modules/tours/public';
import { landable, TOUCH_SETTING, type UiController } from './controller';
import { LOG_SCALE_TICKS, logScaleFraction } from './format';

/** Keyboard and mouse help, by theme (the help panel and the plain-text HELP_TEXT). */
export const HELP_SECTIONS: readonly { title: string; rows: readonly (readonly [string, string])[] }[] = [
  {
    title: 'Find your way',
    rows: [
      ['/', 'search and fly anywhere (also Ctrl+K)'],
      ['X', 'explore: browse places by theme'],
      ['T', 'guided tours'],
      ['Click', 'select a world or a label; double-click flies there'],
      ['G', 'go to the selection; near a surface: walk'],
      ['Shift+G', 'land on the selected or nearest world'],
      ['Home', 'back to Earth'],
    ],
  },
  {
    title: 'Fly',
    rows: [
      ['Drag', 'look around (arrow keys too)'],
      ['W A S D', 'fly forward, left, back and right'],
      ['R F', 'up and down'],
      ['Q E', 'roll'],
      ['Wheel or [ ]', 'change speed'],
      ['O', 'orbit the target, or free flight'],
    ],
  },
  {
    title: 'On the ground',
    rows: [
      ['W A S D', 'walk (Shift runs)'],
      ['Space', 'jump, under the real gravity of that world'],
      ['G', 'take off again'],
    ],
  },
  {
    title: 'Time',
    rows: [
      [', .', 'slower or faster time (and backwards)'],
      ['K', 'pause or play (pauses the tour while one runs)'],
      ['N', 'back to now'],
      ['Click the date', 'type 66 Ma, 21 ka, 500 BC, 1066 or 2026-01-01'],
    ],
  },
  {
    title: 'View',
    rows: [
      ['I', 'info card'],
      ['P', 'photo mode'],
      ['H', 'hide the interface'],
      ['Shift+C', 'constellation lines'],
      ['Shift+O', 'orbit lines'],
      ['Shift+L', 'labels'],
      ['Shift+F', 'full screen'],
      ['L', 'copy a link to this view'],
      ['M', 'mute or unmute sound'],
      ['Esc', 'close panels, leave the tour or photo mode'],
    ],
  },
  {
    title: 'Touch',
    rows: [
      ['One finger', 'look around'],
      ['Pinch', 'fly forward or back'],
      ['Stick', 'move; the arrows go up and down'],
      ['Tap', 'select; double-tap flies there'],
    ],
  },
];

export const HELP_TEXT = HELP_SECTIONS.flatMap((s) => s.rows.map(([k, t]) => `${k} ${t}`)).join(' · ');

const ICONS: Record<string, string> = {
  search:
    'M6.5 1.5a5 5 0 1 0 3.1 8.9l3.5 3.5 1.1-1.1-3.5-3.5A5 5 0 0 0 6.5 1.5zm0 1.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z',
  compass:
    'M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 1.4a5.6 5.6 0 1 1 0 11.2A5.6 5.6 0 0 1 8 2.4zm3 2.6L6.9 6.9 5 11l4.1-1.9L11 5zM8 7.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z',
  play: 'M4 2.5v11l9-5.5z',
  stop: 'M3.5 3.5h9v9h-9z',
  camera:
    'M5.5 3 4.6 4.5H2.5A1.5 1.5 0 0 0 1 6v6a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 15 12V6a1.5 1.5 0 0 0-1.5-1.5h-2.1L10.5 3h-5zM8 6.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z',
  link: 'M6.9 9.1a3 3 0 0 0 4.2 0l2.5-2.5a3 3 0 0 0-4.2-4.2L8.3 3.5l1 1 1.1-1.1a1.6 1.6 0 0 1 2.2 2.2l-2.5 2.5a1.6 1.6 0 0 1-2.2 0l-1 1zm2.2-2.2a3 3 0 0 0-4.2 0L2.4 9.4a3 3 0 0 0 4.2 4.2l1.1-1.1-1-1-1.1 1.1a1.6 1.6 0 0 1-2.2-2.2l2.5-2.5a1.6 1.6 0 0 1 2.2 0l1-1z',
  full: 'M2 2h4.5v1.5h-3v3H2V2zm7.5 0H14v4.5h-1.5v-3h-3V2zM2 9.5h1.5v3h3V14H2V9.5zm10.5 0H14V14H9.5v-1.5h3v-3z',
  gear: 'M6.8 1h2.4l.4 1.9 1.2.5 1.6-1.1 1.7 1.7-1.1 1.6.5 1.2 1.9.4v2.4l-1.9.4-.5 1.2 1.1 1.6-1.7 1.7-1.6-1.1-1.2.5-.4 1.9H6.8l-.4-1.9-1.2-.5-1.6 1.1-1.7-1.7 1.1-1.6-.5-1.2L.6 9.2V6.8l1.9-.4.5-1.2-1.1-1.6 1.7-1.7 1.6 1.1 1.2-.5L6.8 1zM8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z',
  land: 'M7 1.5h2v6h2.5L8 11.5 4.5 7.5H7zM2 13h12v1.5H2z',
  walk: 'M8 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM6.5 5.5h3l.8 4.5H9.1l.4 4.5H8.3L8 11l-.3 3.5H6.5l.4-4.5H5.7z',
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg class="cz-ico" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d={ICONS[name]} fill="currentColor" fill-rule="evenodd" />
    </svg>
  );
}

function PanelHead({ title, onClose, hint }: { title: string; onClose: () => void; hint?: string }) {
  return (
    <div class="cz-info-head">
      <div class="cz-info-title">{title}</div>
      <button class="cz-icon" title={hint ?? 'Close (Esc)'} aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

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
          placeholder="Search planets, moons, stars, galaxies, places…"
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

/** Explore: destinations by theme, one group open at a time. */
function ExplorePanel({ ui }: { ui: UiController }) {
  const groups = ui.explore();
  const first = groups.find((g) => g.group.id !== 'tours') ?? groups[0];
  const [open, setOpen] = useState<string>(first?.group.id ?? '');
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <div class="cz-panel cz-explore" role="dialog" aria-label="Explore" data-places={total}>
      <PanelHead title="Explore" onClose={() => (ui.exploreOpen.value = false)} hint="Close (Esc or X)" />
      <div class="cz-explore-body">
        {groups.map(({ group, items }) => (
          <section key={group.id} data-group={group.id}>
            <button
              class="cz-explore-group"
              aria-expanded={open === group.id}
              onClick={() => setOpen(open === group.id ? '' : group.id)}
            >
              <span>{group.title}</span>
              <span class="cz-count">{items.length}</span>
            </button>
            {open === group.id && (
              <>
                <p class="cz-explore-blurb">{group.blurb}</p>
                <ul>
                  {items.map(({ key, entry }) => (
                    <li key={entry.id}>
                      <button
                        class="cz-explore-item"
                        data-key={key}
                        onClick={() => {
                          ui.choose(entry);
                          if (window.innerWidth < 700) ui.exploreOpen.value = false;
                        }}
                      >
                        <span class="cz-result-name">{entry.name.replace(/^Tour: /, '')}</span>
                        {entry.subtitle && entry.subtitle !== 'Bookmark' && (
                          <span class="cz-result-sub">{entry.subtitle}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

/** Guided tours: start one, or stop the one that is running. */
function ToursMenu({ ui }: { ui: UiController }) {
  const list = ui.ctx.registry.tours();
  const running = tours.status();
  return (
    <div class="cz-panel cz-tours" role="dialog" aria-label="Guided tours">
      <PanelHead title="Guided tours" onClose={() => (ui.toursOpen.value = false)} />
      {running && (
        <button
          class="cz-btn cz-tours-stop"
          onClick={() => {
            tours.stop();
            ui.toursOpen.value = false;
          }}
        >
          <Icon name="stop" /> Stop “{running.title}”
        </button>
      )}
      <ul>
        {list.map((t) => (
          <li key={t.id}>
            <button
              class="cz-explore-item"
              data-tour={t.id}
              onClick={() => {
                ui.toursOpen.value = false;
                if (!tours.start(t.id)) ui.toast(`Tour ${t.title} is not available`, 'warn');
              }}
            >
              <span class="cz-result-name">
                <Icon name="play" /> {t.title}
              </span>
              {t.description && <span class="cz-result-sub">{t.description}</span>}
            </button>
          </li>
        ))}
      </ul>
      <p class="cz-explore-blurb">Pause with K, skip with Next, leave with Esc.</p>
    </div>
  );
}

function HelpPanel({ ui }: { ui: UiController }) {
  const close = () => (ui.helpOpen.value = false);
  return (
    <div class="cz-palette-wrap cz-help-wrap" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="cz-panel cz-help-panel" role="dialog" aria-label="Controls">
        <PanelHead title="Controls" onClose={close} hint="Close (Esc or ?)" />
        <div class="cz-help-grid">
          {HELP_SECTIONS.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              <table>
                <tbody>
                  {s.rows.map(([k, t]) => (
                    <tr key={k + t}>
                      <td>
                        <kbd>{k}</kbd>
                      </td>
                      <td>{t}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function InfoCardView({ ui }: { ui: UiController }) {
  const card = ui.infoCard.value;
  const id = ui.infoId.value;
  if (!card || !id) return null;
  const target = ui.targetOf(id);
  const body = ui.ctx.registry.body(id);
  return (
    <div class="cz-panel cz-info" data-info-id={id}>
      <div class="cz-info-head">
        <div>
          <div class="cz-info-title">{card.title}</div>
          {card.subtitle && <div class="cz-info-sub">{card.subtitle}</div>}
        </div>
        <button class="cz-icon" title="Close (I)" aria-label="Close" onClick={() => ui.showInfo(null)}>
          ×
        </button>
      </div>
      {card.simulated && <div class="cz-badge warn">simulated</div>}
      {card.description && <p class="cz-desc">{card.description}</p>}
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
      {card.links?.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noopener">
          {l.label}
        </a>
      ))}
      <div class="cz-info-foot">
        <span class="cz-info-actions">
          {target && (
            <button class="cz-btn" title="Fly there (G)" onClick={() => ui.fly(target)}>
              Fly there
            </button>
          )}
          {landable(body) && ui.ctx.camera.land && (
            <button
              class="cz-btn cz-land-btn"
              title="Set down on the surface and walk (Shift+G)"
              onClick={() => ui.land(body.id)}
            >
              <Icon name="land" /> Land
            </button>
          )}
        </span>
        {card.credit && <span class="cz-credit">{card.credit}</span>}
      </div>
    </div>
  );
}

/**
 * Typed date for the time bar: '66 Ma', '21 ka', '500 BC', '1066', an ISO date or 'now'
 * (parseUserInstant), with the era presets as suggestions; picking a suggestion jumps at once.
 */
function DateInput({ ui, current, onDone }: { ui: UiController; current: string; onDone: () => void }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { clock } = ui.ctx;
  useEffect(() => input.current?.focus(), []);
  const submit = (value: string) => {
    const v = value.trim();
    if (!v) return onDone();
    const jd = parseUserInstant(v, clock.jd);
    if (jd === null) {
      ui.toast(`Cannot read the date "${v}". Try 66 Ma, 21 ka, 500 BC, 1066 or 2026-01-01.`, 'warn');
      return;
    }
    if (jd === 'now') clock.setNow();
    else clock.setTime(jd);
    onDone();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') submit(text);
    else if (e.key === 'Escape') onDone();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <>
      <input
        ref={input}
        class="cz-date-input"
        list="cz-era-presets"
        aria-label="Date"
        placeholder={current}
        title="66 Ma, 21 ka, 500 BC, 1066, 2026-01-01 12:00 (UTC) or now; Enter to jump, Esc to cancel"
        value={text}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setText(v);
          // A suggestion picked from the list arrives as a replacement, not as typing.
          if (
            (e as InputEvent).inputType === 'insertReplacementText' &&
            ERA_PRESETS.some((p) => p.value === v)
          )
            submit(v);
        }}
        onKeyDown={onKey}
        onBlur={onDone}
        spellcheck={false}
        autocomplete="off"
      />
      <datalist id="cz-era-presets">
        {ERA_PRESETS.map((p) => (
          <option key={p.value} value={p.value} label={p.label} />
        ))}
      </datalist>
    </>
  );
}

/**
 * One chip sums up how far the scene can be trusted at this date ("accurate" while every model is
 * inside its validity range, else how many are approximate); clicking it lists each model.
 */
function Accuracy({ ui }: { ui: UiController }) {
  const badges = ui.time.value.badges;
  if (!badges.length) return null;
  const off = badges.filter((b) => b.state !== 'ok');
  const open = ui.accuracyOpen.value;
  return (
    <span class="cz-badges">
      <button
        class={`cz-badge cz-accuracy ${off.length ? 'warn' : 'ok'}`}
        aria-expanded={open}
        title="How far the scene can be trusted at this date (click for the list)"
        onClick={() => ui.openPanel('accuracy', !open)}
      >
        {off.length ? `≈ ${off.length} approximate` : '✓ real data'}
      </button>
      {open && (
        <div class="cz-panel cz-accuracy-panel" role="dialog" aria-label="Accuracy at this date">
          <PanelHead title="Accuracy at this date" onClose={() => (ui.accuracyOpen.value = false)} />
          <ul>
            {badges.map((b) => (
              <li key={b.id} class={b.state === 'ok' ? 'ok' : 'warn'} title={b.title}>
                <span class="cz-mark">{b.state === 'ok' ? '✓' : '≈'}</span>
                <span>{b.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}

function TimeBar({ ui }: { ui: UiController }) {
  const t = ui.time.value;
  const { clock } = ui.ctx;
  const [editing, setEditing] = useState(false);
  return (
    <div class="cz-panel cz-timebar">
      <button class="cz-icon" title="Slower / reverse (,)" onClick={() => clock.warpStep(-1)}>
        ◀◀
      </button>
      <button
        class="cz-icon"
        title="Play / pause (K)"
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
        <DateInput ui={ui} current={t.text} onDone={() => setEditing(false)} />
      ) : (
        <button
          class="cz-date"
          title="Set the date: 66 Ma, 21 ka, 500 BC, 1066, 2026-01-01 (UTC)…"
          onClick={() => setEditing(true)}
        >
          {t.text}
        </button>
      )}
      <button class="cz-btn" title="Jump to the current time (N)" onClick={() => clock.setNow()}>
        Now
      </button>
      <Accuracy ui={ui} />
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
      data-mode={h.mode}
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
      {h.position && (
        <div class="cz-hud-row cz-hud-pos" title="Latitude, east longitude and height above the ground">
          <span class="cz-k">over</span> <span class="cz-v">{h.position}</span>
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
      <div class="cz-hud-actions">
        {h.mode === 'walk' ? (
          <button class="cz-btn" title="Leave the ground and fly (G)" onClick={() => ui.toggleWalk()}>
            Take off
          </button>
        ) : h.canWalk ? (
          <button class="cz-btn cz-walk-btn" title="Walk on the surface (G)" onClick={() => ui.toggleWalk()}>
            <Icon name="walk" /> Walk
          </button>
        ) : (
          h.landOn && (
            <button
              class="cz-btn cz-land-btn"
              title="Set down on the surface and walk (Shift+G)"
              onClick={() => ui.land()}
            >
              <Icon name="land" /> Land
            </button>
          )
        )}
        {h.targetId && h.mode !== 'walk' && (
          <button
            class="cz-btn"
            title="Orbit the target, or fly freely (O)"
            onClick={() => camera.setMode(camera.mode === 'orbit' ? 'free' : 'orbit')}
          >
            {h.mode === 'orbit' ? 'Free flight' : 'Orbit'}
          </button>
        )}
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
  // The preset can change under the panel (automatic quality): follow it.
  const [, bump] = useState(0);
  useEffect(() => quality.subscribe(() => bump((n) => n + 1)), []);
  const groups = new Map<string, SettingDef[]>();
  for (const d of ui.settings.definitions()) {
    if (d.debug) continue;
    groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
  }
  return (
    <div class="cz-panel cz-settings">
      <PanelHead title="Settings" onClose={() => (ui.settingsOpen.value = false)} />
      <label
        class="cz-setting"
        title="Automatic lowers the quality when the frame rate stays low; a fixed choice is remembered."
      >
        <span>Quality</span>
        <select
          class="cz-quality"
          value={qualityControl.auto ? 'auto' : quality.preset}
          onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value as QualityPreset | 'auto';
            qualityControl.choose(v);
            // Before boot binds the control (tests), the preset is set directly.
            if (v !== 'auto' && quality.preset !== v) quality.set(v);
            bump((n) => n + 1);
          }}
        >
          <option value="auto">automatic ({quality.preset})</option>
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

const STICK_RADIUS = 44;
const STICK_DEAD = 0.12;

/**
 * On-screen flight controls for touch screens: a stick that moves (forward/back and sideways)
 * and two hold buttons for up and down (up jumps when walking). Looking is a one-finger drag on
 * the view and a pinch flies along it; both live in the camera controller.
 */
function TouchControls({ ui }: { ui: UiController }) {
  void ui.settingsVersion.value;
  const { camera } = ui.ctx;
  const [knob, setKnob] = useState<{ x: number; y: number } | null>(null);
  const base = useRef<HTMLDivElement>(null);
  const mode = ui.settings.get(TOUCH_SETTING);
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const show = mode === 'on' || (mode !== 'off' && (coarse || ui.touchSeen.value));
  useEffect(() => () => camera.setVirtualInput?.({ forward: 0, right: 0, up: 0 }), []);
  if (!show || !camera.setVirtualInput) return null;
  const steer = (e: PointerEvent) => {
    const r = base.current?.getBoundingClientRect();
    if (!r) return;
    let x = (e.clientX - (r.left + r.width / 2)) / STICK_RADIUS;
    let y = (e.clientY - (r.top + r.height / 2)) / STICK_RADIUS;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    setKnob({ x, y });
    const live = Math.min(1, m) > STICK_DEAD;
    camera.setVirtualInput?.({ right: live ? x : 0, forward: live ? -y : 0 });
  };
  const release = () => {
    setKnob(null);
    camera.setVirtualInput?.({ right: 0, forward: 0 });
  };
  const hold = (up: number) => ({
    onPointerDown: (e: PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      camera.setVirtualInput?.({ up });
    },
    onPointerUp: () => camera.setVirtualInput?.({ up: 0 }),
    onPointerCancel: () => camera.setVirtualInput?.({ up: 0 }),
    onLostPointerCapture: () => camera.setVirtualInput?.({ up: 0 }),
  });
  return (
    <div class="cz-touch" aria-label="Flight controls">
      <div class="cz-touch-vert">
        <button class="cz-touch-btn" aria-label="Up (jump when walking)" {...hold(1)}>
          ▲
        </button>
        <button class="cz-touch-btn" aria-label="Down" {...hold(-1)}>
          ▼
        </button>
      </div>
      <div
        ref={base}
        class="cz-stick"
        role="slider"
        aria-label="Move"
        aria-valuetext={knob ? 'moving' : 'centred'}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          steer(e);
        }}
        onPointerMove={(e) => knob && steer(e)}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <span
          class="cz-stick-knob"
          style={{
            transform: `translate(${(knob?.x ?? 0) * STICK_RADIUS}px, ${(knob?.y ?? 0) * STICK_RADIUS}px)`,
          }}
        />
      </div>
    </div>
  );
}

function TopButton(p: {
  cls?: string;
  title: string;
  icon?: keyof typeof ICONS;
  text?: string;
  pressed?: boolean;
  onClick: () => void;
  children?: ComponentChildren;
}) {
  return (
    <button
      class={`cz-btn ${p.cls ?? ''}`}
      title={p.title}
      aria-label={p.text ?? p.title}
      aria-pressed={p.pressed}
      onClick={p.onClick}
    >
      {p.icon && <Icon name={p.icon} />}
      {p.text && <span class="cz-btn-text">{p.text}</span>}
      {p.children}
    </button>
  );
}

const canFullscreen = (): boolean => {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: unknown };
  return typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function';
};

export function App({ ui }: { ui: UiController }) {
  const hud = ui.hudVisible.value;
  const touring = tours.status() !== null;
  void ui.hud.value; // the tour button follows the tour's state at HUD rate
  return (
    <div class="cz-root">
      {hud && (
        <>
          <div class="cz-topbar">
            <TopButton
              title="Search (/ or Ctrl+K)"
              icon="search"
              text="Search"
              onClick={() => (ui.paletteOpen.value = true)}
            >
              <kbd>/</kbd>
            </TopButton>
            <TopButton
              cls="cz-explore-btn"
              title="Explore: browse places by theme (X)"
              icon="compass"
              text="Explore"
              pressed={ui.exploreOpen.value}
              onClick={() => ui.openPanel('explore', !ui.exploreOpen.value)}
            />
            <TopButton
              cls="cz-tour-btn"
              title={touring ? 'Stop the tour (Esc)' : 'Guided tours (T)'}
              icon={touring ? 'stop' : 'play'}
              text={touring ? 'Stop tour' : 'Tours'}
              pressed={ui.toursOpen.value}
              onClick={() => {
                if (tours.status()) tours.stop();
                else ui.openPanel('tours', !ui.toursOpen.value);
              }}
            />
            <TopButton
              cls="cz-photo-btn"
              title="Photo mode (P)"
              icon="camera"
              text="Photo"
              onClick={() => photo.toggle()}
            />
            <TopButton
              cls="cz-link-btn"
              title="Copy a link to this view (L)"
              icon="link"
              text="Copy link"
              onClick={() => void ui.copyLink()}
            />
            <MuteButton ui={ui} />
            {canFullscreen() && (
              <TopButton
                cls="cz-full-btn"
                title="Full screen (Shift+F)"
                icon="full"
                pressed={ui.fullscreen.value}
                onClick={() => ui.toggleFullscreen()}
              />
            )}
            <button
              class="cz-btn"
              title="Settings"
              aria-pressed={ui.settingsOpen.value}
              onClick={() => ui.openPanel('settings', !ui.settingsOpen.value)}
            >
              <Icon name="gear" />
            </button>
            <button
              class="cz-btn cz-help-btn"
              title="Controls (?)"
              aria-pressed={ui.helpOpen.value}
              onClick={() => ui.openPanel('help', !ui.helpOpen.value)}
            >
              ?
            </button>
          </div>
          <Hud ui={ui} />
          <TimeBar ui={ui} />
          <InfoCardView ui={ui} />
          {ui.exploreOpen.value && <ExplorePanel ui={ui} />}
          {ui.toursOpen.value && <ToursMenu ui={ui} />}
          {ui.settingsOpen.value && <SettingsPanel ui={ui} />}
          <TouchControls ui={ui} />
        </>
      )}
      {ui.caption.value && <div class="cz-caption">{ui.caption.value}</div>}
      <div class="cz-toasts" role="status" aria-live="polite">
        {ui.toasts.value.map((t) => (
          <div key={t.id} class={`cz-panel cz-toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
      {hud && ui.helpOpen.value && <HelpPanel ui={ui} />}
      {ui.paletteOpen.value && <Palette ui={ui} />}
    </div>
  );
}
