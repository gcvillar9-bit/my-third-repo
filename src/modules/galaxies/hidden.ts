/**
 * Catalogue galaxies that another module draws itself (the milkyway module draws the dwarf
 * satellites of the Milky Way as resolved star clouds). A hidden row gets neither a point nor an
 * impostor here. Requests made before the catalogue has loaded are kept and applied on load.
 */
/** Called with a galaxy's position in the `universe` frame (Mpc) and its catalogue row. */
export type GalaxyPredicate = (x: number, y: number, z: number, row: number) => boolean;

const pending: GalaxyPredicate[] = [];
let apply: ((pred: GalaxyPredicate) => void) | null = null;

/** Hides every catalogue galaxy for which `pred` is true, now or as soon as the catalogue loads. */
export function hideGalaxies(pred: GalaxyPredicate): void {
  pending.push(pred);
  apply?.(pred);
}

/** The catalogue layer registers how to hide rows; earlier requests are replayed. */
export function attachGalaxyHider(fn: (pred: GalaxyPredicate) => void): void {
  apply = fn;
  for (const p of pending) fn(p);
}
