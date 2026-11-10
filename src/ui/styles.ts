/** UI stylesheet (dark, glassy, unobtrusive). Injected once by mountUi. */
export const UI_CSS = `
.cz-root, .cz-labels { position: absolute; inset: 0; pointer-events: none; font: 12px/1.35 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #cdd6e4;
  -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; }
.cz-root button, .cz-root input, .cz-root select { font: inherit; color: inherit; }
.cz-root button:focus-visible, .cz-root input:focus-visible, .cz-root select:focus-visible { outline: 2px solid #9cc3ff; outline-offset: 1px; }
.cz-panel { pointer-events: auto; background: rgba(14, 18, 28, 0.58); border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px; backdrop-filter: blur(10px) saturate(1.2); -webkit-backdrop-filter: blur(10px) saturate(1.2);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35); }
.cz-btn, .cz-icon, .cz-date, .cz-link { pointer-events: auto; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px; padding: 3px 8px; cursor: pointer; }
.cz-btn:hover, .cz-icon:hover, .cz-date:hover { background: rgba(255, 255, 255, 0.14); }
.cz-btn[aria-pressed="true"] { background: rgba(156, 195, 255, 0.2); border-color: rgba(156, 195, 255, 0.4); }
.cz-icon { padding: 2px 7px; min-width: 26px; }
.cz-ico { vertical-align: -2px; }
.cz-link { background: none; border: none; padding: 0; color: #9cc3ff; }
.cz-link:disabled { color: #aab4c4; cursor: default; }
kbd { font: 10px ui-monospace, monospace; opacity: 0.7; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 0 4px; }
.cz-topbar { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; pointer-events: none; }
.cz-topbar .cz-btn { background: rgba(14, 18, 28, 0.55); backdrop-filter: blur(8px); display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; min-height: 26px; }
.cz-topbar .cz-btn[aria-pressed="true"] { background: rgba(60, 90, 150, 0.6); }
.cz-hud { position: absolute; left: 10px; bottom: 58px; padding: 8px 10px; min-width: 220px; max-width: min(380px, 70vw); }
.cz-hud-row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cz-hud-actions { display: flex; gap: 6px; margin-top: 6px; }
.cz-hud-actions:empty { display: none; }
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
.cz-date-input { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color-scheme: dark; color: inherit; font: inherit; padding: 2px 6px; width: 15em; max-width: 40vw;
  -webkit-user-select: text; user-select: text; }
.cz-badges { position: relative; display: flex; gap: 4px; }
.cz-badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.15);
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
.cz-badge.ok { color: #8fd6a8; border-color: rgba(143, 214, 168, 0.35); }
.cz-badge.warn { color: #ffc56e; border-color: rgba(255, 197, 110, 0.45); }
button.cz-accuracy { pointer-events: auto; cursor: pointer; background: none; padding: 2px 8px; }
button.cz-accuracy:hover { background: rgba(255, 255, 255, 0.1); }
.cz-accuracy-panel { position: absolute; right: 0; bottom: 30px; width: min(360px, calc(100vw - 20px)); padding: 10px 12px; white-space: normal; }
.cz-accuracy-panel ul, .cz-tours ul, .cz-explore ul { list-style: none; margin: 0; padding: 0; }
.cz-accuracy-panel li { display: flex; gap: 6px; padding: 2px 0; }
.cz-accuracy-panel li.ok .cz-mark { color: #8fd6a8; }
.cz-accuracy-panel li.warn { color: #ffc56e; }
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
.cz-info-actions { display: flex; gap: 6px; flex: none; }
.cz-credit { font-size: 10px; color: #6f7a90; text-align: right; }
.cz-desc { color: #b5bfd0; margin: 4px 0 6px; -webkit-user-select: text; user-select: text; }
.cz-settings { position: absolute; top: 48px; right: 10px; width: min(280px, calc(100vw - 20px)); padding: 10px 12px; max-height: calc(100vh - 140px); overflow: auto; }
.cz-settings fieldset { border: none; border-top: 1px solid rgba(255,255,255,0.08); margin: 8px 0 0; padding: 6px 0 0; }
.cz-settings legend { color: #8f9ab0; font-size: 11px; padding: 0 4px 0 0; }
.cz-setting { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 3px 0; }
.cz-setting select { background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; color-scheme: dark; max-width: 150px; }
.cz-explore { position: absolute; top: 10px; left: 10px; width: min(300px, calc(100vw - 20px)); max-height: calc(100vh - 170px); display: flex; flex-direction: column; padding: 10px 12px; }
.cz-explore-body { overflow: auto; margin: 0 -4px; padding: 0 4px; }
.cz-explore-group { pointer-events: auto; display: flex; justify-content: space-between; align-items: center; width: 100%; text-align: left; cursor: pointer;
  background: none; border: none; border-top: 1px solid rgba(255,255,255,0.08); padding: 7px 2px; color: #dfe6f2 !important; font-weight: 600 !important; }
.cz-explore-group:hover, .cz-explore-group[aria-expanded="true"] { color: #fff !important; }
.cz-explore-group[aria-expanded="true"] { color: #9cc3ff !important; }
.cz-count { font-weight: 400; font-size: 10px; color: #7f8aa0; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 0 6px; }
.cz-explore-blurb { margin: 0 2px 6px; color: #8f9ab0; font-size: 11px; }
.cz-explore-item { pointer-events: auto; display: flex; flex-direction: column; gap: 1px; width: 100%; text-align: left; cursor: pointer;
  background: none; border: none; border-radius: 6px; padding: 5px 8px; }
.cz-explore-item:hover { background: rgba(156, 195, 255, 0.16); }
.cz-explore-item .cz-result-sub { white-space: normal; }
.cz-tours { position: absolute; top: 48px; right: 10px; width: min(320px, calc(100vw - 20px)); max-height: calc(100vh - 140px); overflow: auto; padding: 10px 12px; }
.cz-tours-stop { width: 100%; margin-bottom: 6px; }
.cz-palette-wrap { position: absolute; inset: 0; pointer-events: auto; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; background: rgba(0,0,0,0.25); }
.cz-palette { width: min(520px, calc(100vw - 24px)); padding: 6px; }
.cz-palette-input { width: 100%; box-sizing: border-box; padding: 9px 10px; font-size: 15px !important; background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,255,255,0.12); border-radius: 7px; outline: none; -webkit-user-select: text; user-select: text; }
.cz-results { list-style: none; margin: 6px 0 0; padding: 0; max-height: 50vh; overflow: auto; }
.cz-results li { display: flex; justify-content: space-between; gap: 10px; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
.cz-results li.active { background: rgba(156, 195, 255, 0.16); }
.cz-result-name { color: #eef3fa; }
.cz-result-sub { color: #7f8aa0; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cz-empty { color: #7f8aa0; }
.cz-help-wrap { padding-top: 7vh; background: rgba(0,0,0,0.4); z-index: 8; }
.cz-help-panel { width: min(760px, calc(100vw - 24px)); max-height: 86vh; overflow: auto; padding: 12px 16px; }
.cz-help-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px 22px; }
.cz-help-grid h3 { margin: 8px 0 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #8f9ab0; }
.cz-help-grid table { border-collapse: collapse; width: 100%; }
.cz-help-grid td { padding: 2px 0; vertical-align: top; }
.cz-help-grid td:first-child { white-space: nowrap; padding-right: 10px; width: 1%; }
.cz-help-grid kbd { font-size: 11px; opacity: 1; color: #9cc3ff; border-color: rgba(156, 195, 255, 0.3); padding: 1px 5px; }
.cz-help-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08); }
.cz-credits { list-style: none; margin: 0; padding: 0; max-height: 60vh; overflow: auto; -webkit-user-select: text; user-select: text; }
.cz-credits li { display: flex; flex-direction: column; gap: 1px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.05); }
.cz-credits .cz-result-sub { white-space: normal; }
.cz-credits a { color: #9cc3ff; }
.cz-caption { position: absolute; left: 50%; bottom: 96px; transform: translateX(-50%); max-width: 70vw; text-align: center; font-size: 16px;
  text-shadow: 0 1px 6px #000; color: #f1f5fb; }
.cz-toasts { position: absolute; top: 48px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 6px; align-items: center; z-index: 9; }
.cz-toast { padding: 6px 12px; max-width: min(520px, calc(100vw - 24px)); }
.cz-toast.warn { border-color: rgba(255, 197, 110, 0.5); }
.cz-toast.error { border-color: rgba(255, 120, 120, 0.6); }
.cz-label { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: pointer; white-space: nowrap; font-size: 11px; line-height: 15px;
  padding: 0 3px; color: #c9d4e6; text-shadow: 0 0 3px #000, 0 0 2px #000; opacity: 0.85; will-change: transform; }
.cz-label:hover { opacity: 1; color: #fff; }
.cz-label-emph { color: #9cc3ff !important; opacity: 1; }
.cz-touch { position: absolute; right: 14px; bottom: 62px; display: flex; align-items: flex-end; gap: 10px; pointer-events: none; touch-action: none; }
.cz-touch-vert { display: flex; flex-direction: column; gap: 8px; }
.cz-touch-btn { pointer-events: auto; width: 44px; height: 44px; border-radius: 50%; cursor: pointer; touch-action: none;
  background: rgba(14, 18, 28, 0.5); border: 1px solid rgba(255, 255, 255, 0.18); color: #cdd6e4 !important; }
.cz-touch-btn:active { background: rgba(156, 195, 255, 0.3); }
.cz-stick { pointer-events: auto; position: relative; width: 120px; height: 120px; border-radius: 50%; touch-action: none; cursor: grab;
  background: rgba(14, 18, 28, 0.38); border: 1px solid rgba(255, 255, 255, 0.16); }
.cz-stick-knob { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%;
  background: rgba(156, 195, 255, 0.35); border: 1px solid rgba(156, 195, 255, 0.6); }
@media (max-width: 900px) {
  .cz-topbar .cz-btn-text, .cz-topbar kbd { display: none; }
  .cz-topbar .cz-btn { padding: 5px 9px; min-height: 30px; }
}
@media (max-width: 640px) {
  .cz-topbar { left: 10px; justify-content: flex-end; flex-wrap: wrap; }
  .cz-rate { min-width: 0; padding: 0 4px; }
  .cz-hud { bottom: 54px; min-width: 0; max-width: calc(100vw - 20px); padding: 6px 8px; }
  .cz-scale, .cz-crumbs { display: none; }
  .cz-timebar { gap: 4px; padding: 4px 6px; }
  .cz-timebar .cz-btn { display: none; }
  .cz-explore, .cz-info, .cz-settings, .cz-tours { top: 48px; left: 10px; right: 10px; width: auto; max-height: calc(100vh - 204px); }
  /* Tall and narrow (phones held upright): the stick sits above the HUD instead of beside it. */
  .cz-touch { bottom: 156px; }
  .cz-caption { font-size: 14px; max-width: 92vw; bottom: 150px; }
  .cz-accuracy-panel { position: fixed; left: 10px; right: 10px; bottom: 52px; width: auto; }
}
@media (max-height: 420px) {
  /* Short screens (phones held sideways): HUD on the left half, panels on the right half. */
  .cz-scale, .cz-crumbs { display: none; }
  .cz-hud { min-width: 0; max-width: calc(50vw - 20px); }
  .cz-touch { bottom: 62px; }
  .cz-explore, .cz-info, .cz-settings, .cz-tours { top: 48px; left: auto; right: 10px; width: min(300px, calc(50vw - 10px));
    max-height: calc(100vh - 106px); }
}
html[data-photo] .cz-shell, html[data-photo] .cz-labels { display: none; }
`;
