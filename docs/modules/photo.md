# photo (P5-B)

`src/modules/photo/`: photo mode.

- **Toggle:** `P` (photo module key handler, works with the UI hidden too) or the UI's Photo button
  (`photo.toggle()` from `public.ts`). Esc leaves it (capture-phase handler, so Esc does not also exit a tour or
  close the info card).
- **Hiding:** `ui.setHudVisible(false)` plus the `data-photo` attribute on `<html>` (`PHOTO_ATTR`). CSS rules in
  the UI shell, the tour overlay and the onboarding card hide everything else (topbar, caption, toasts, labels).
- **Panel** (bottom centre, translucent until hovered): FOV slider 5-120° (`camera.setState({ fovY })`), exposure
  −/+ in 0.5-stop steps (`render.exposure.compensation`, ±6 stops; shown with brighter = positive), Save PNG, Exit.
  Leaving photo mode restores the FOV and the compensation from before.
- **Save PNG:** waits for the next frame; in `render.onAfterFrame` (same task as the render, so no
  `preserveDrawingBuffer`) the WebGL canvas is drawn into a 2D canvas at drawing-buffer size, a credits line
  (`creditsLine`: date UTC and data sources, see CREDITS.md) is drawn in the bottom-right corner, then
  `toBlob('image/png')`. The file downloads as `cosmos-YYYY-MM-DD-HHMM.png` (not in test mode). The panel's
  `data-last-size` holds the last PNG size for e2e.
- `PhotoState` (`photo.ts`) holds the logic without DOM or three.js.

Cut from DESIGN: 2× tiled super-resolution.

## Tests

- Unit `tests/unit/photo/photo.test.ts`: enter/exit hides and restores the UI flags, FOV and exposure clamps and
  restore, credits line and file name.
- E2E `tests/e2e/photo.spec.ts` (@smoke): `?ui=1`, P hides HUD and topbar, Save PNG gives a PNG over 1 kB, Esc
  restores the UI, no errors.
