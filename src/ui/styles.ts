/** UI stylesheet (dark, glassy, unobtrusive). Injected once by mountUi. */
export const UI_CSS = `
.cz-root, .cz-labels { position: absolute; inset: 0; pointer-events: none; font: 12px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #cdd6e4; }
.cz-root button, .cz-root input, .cz-root select { font: inherit; color: inherit; }
.cz-panel { pointer-events: auto; background: rgba(14, 18, 28, 0.58); border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px; backdrop-filter: blur(10px) saturate(1.2); -webkit-backdrop-filter: blur(10px) saturate(1.2);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35); }
.cz-btn, .cz-icon, .cz-date, .cz-link { pointer-events: auto; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px; padding: 3px 8px; cursor: pointer; }
.cz-btn:hover, .cz-icon:hover, .cz-date:hover { background: rgba(255, 255, 255, 0.14); }
.cz-icon { padding: 2px 7px; min-width: 26px; }
.cz-link { background: none; border: none; padding: 0; color: #9cc3ff; }
.cz-link:disabled { color: #aab4c4; cursor: default; }
kbd { font: 10px ui-monospace, monospace; opacity: 0.7; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 0 4px; }
.cz-topbar { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; pointer-events: none; }
.cz-topbar .cz-btn { background: rgba(14, 18, 28, 0.55); backdrop-filter: blur(8px); }
.cz-hud { position: absolute; left: 10px; bottom: 58px; padding: 8px 10px; min-width: 220px; max-width: min(380px, 70vw); }
.cz-hud-row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cz-k { color: #7f8aa0; }
.cz-v { color: #e8eef8; font-variant-numeric: tabular-nums; }
.cz-scale { margin: 6px 0 2px; }
.cz-scale-bar { position: relative; height: 16px; border-bottom: 1px solid rgba(255,255,255,0.25); }
.cz-tick { position: absolute; bottom: 2px; transform: translateX(-50%); font-size: 9px; color: #7f8aa0; }
.cz-tick::after { content: ''; position: absolute; left: 50%; bottom: -3px; height: 4px; border-left: 1px solid rgba(255,255,255,0.3); }
.cz-marker { position: absolute; bottom: -4px; width: 7px; height: 7px; margin-left: -4px; border-radius: 50%; background: #9cc3ff; box-shadow: 0 0 6px #9cc3ff; }
.cz-crumbs { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cz-timebar { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: flex; align-items: center; gap: 6px;
  padding: 5px 8px; max-width: calc(100vw - 20px); white-space: nowrap; }
.cz-rate { min-width: 64px; text-align: center; font-variant-numeric: tabular-nums; }
.cz-date { font-variant-numeric: tabular-nums; }
.cz-date-input { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color-scheme: dark; color: inherit; font: inherit; padding: 2px 6px; width: 15em; max-width: 40vw; }
.cz-badges { display: flex; gap: 4px; overflow: hidden; }
.cz-badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.15);
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.cz-badge.ok { color: #8fd6a8; border-color: rgba(143, 214, 168, 0.35); }
.cz-badge.warn { color: #ffc56e; border-color: rgba(255, 197, 110, 0.45); }
.cz-info { position: absolute; top: 48px; right: 10px; width: min(300px, calc(100vw - 20px)); max-height: calc(100vh - 140px); overflow: auto; padding: 10px 12px; }
.cz-info-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px; }
.cz-info-title { font-size: 15px; font-weight: 600; color: #f1f5fb; }
.cz-info-sub { color: #8f9ab0; }
.cz-facts { width: 100%; border-collapse: collapse; margin: 4px 0; }
.cz-facts td { padding: 2px 0; vertical-align: top; }
.cz-facts td:first-child { color: #8f9ab0; padding-right: 8px; }
.cz-facts td:last-child { text-align: right; color: #e8eef8; font-variant-numeric: tabular-nums; }
.cz-approx { margin-left: 3px; color: #ffc56e; cursor: help; }
.cz-info-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 6px; }
.cz-credit { font-size: 10px; color: #6f7a90; text-align: right; }
.cz-desc { color: #b5bfd0; }
.cz-settings { position: absolute; top: 48px; right: 10px; width: min(280px, calc(100vw - 20px)); padding: 10px 12px; max-height: calc(100vh - 140px); overflow: auto; }
.cz-settings fieldset { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 8px 0 0; padding: 6px 0 0; }
.cz-settings legend { color: #8f9ab0; font-size: 11px; padding: 0 4px 0 0; }
.cz-setting { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 3px 0; }
.cz-setting select { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color-scheme: dark; }
.cz-palette-wrap { position: absolute; inset: 0; pointer-events: auto; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; background: rgba(0,0,0,0.25); }
.cz-palette { width: min(520px, calc(100vw - 24px)); padding: 6px; }
.cz-palette-input { width: 100%; box-sizing: border-box; padding: 9px 10px; font-size: 15px !important; background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,255,255,0.12); border-radius: 7px; outline: none; }
.cz-results { list-style: none; margin: 6px 0 0; padding: 0; max-height: 50vh; overflow: auto; }
.cz-results li { display: flex; justify-content: space-between; gap: 10px; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.cz-results li.active { background: rgba(156, 195, 255, 0.16); }
.cz-result-name { color: #eef3fa; }
.cz-result-sub { color: #7f8aa0; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cz-empty { color: #7f8aa0; }
.cz-help { position: absolute; left: 50%; bottom: 46px; transform: translateX(-50%); font-size: 10px; color: rgba(205, 214, 228, 0.35);
  white-space: nowrap; max-width: calc(100vw - 20px); overflow: hidden; text-overflow: ellipsis; }
.cz-help.open { color: #cdd6e4; white-space: normal; text-align: center; width: min(640px, calc(100vw - 20px)); }
.cz-caption { position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%); max-width: 70vw; text-align: center; font-size: 16px;
  text-shadow: 0 1px 6px #000; color: #f1f5fb; }
.cz-toasts { position: absolute; top: 48px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; align-items: center; }
.cz-toast { padding: 6px 12px; }
.cz-toast.warn { border-color: rgba(255, 197, 110, 0.5); }
.cz-toast.error { border-color: rgba(255, 120, 120, 0.6); }
.cz-label { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: pointer; white-space: nowrap; font-size: 11px; line-height: 15px;
  padding: 0 3px; color: #c9d4e6; text-shadow: 0 0 3px #000, 0 0 2px #000; opacity: 0.85; will-change: transform; }
.cz-label:hover { opacity: 1; color: #fff; }
.cz-label-emph { color: #9cc3ff !important; opacity: 1; }
@media (max-width: 640px) { .cz-badges, .cz-help { display: none; } .cz-hud { bottom: 54px; } }
html[data-photo] .cz-shell, html[data-photo] .cz-labels { display: none; }
`;
