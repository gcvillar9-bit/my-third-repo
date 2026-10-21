# Life through time (Phase 2) status

Work: `claude/eloquent-meitner-tqq1zc` (PR gcvillar9-bit/my-third-repo#12). Docs: `docs/modules/life.md`.

## Done

- Module `src/modules/life`: plants and animals of the clock's era within 3 km of Earth's ground; procedural
  stylised low-poly models (47 creature models for 47 species, incl. dinosaurs, Permian synapsids, Cenozoic mammals, apes, hominins;
  18 plants from mosses to grasses) with gaits in the vertex shader; one program, one draw per model.
- Ranges from Paleobiology Database finds (CC BY 4.0, paleo-coordinates) and hand-entered regions (hominins,
  humans, apes, living animals); plants by era and biome; biomes from the paleo climate map.
- Paleo `paleoClimate`, terrain `terrainHeightAt`, ground-level label occlusion fix (`src/ui/labels.ts`).
- Five walk bookmarks, four e2e tests, unit tests.
- Phase 3 people: townspeople in town streets, farmers (sapiens younger than 8 ka) and livestock on the
  farmland around towns (`docs/modules/cities.md`). Buildings, walls with four gates, monuments clear of
  houses.
- Review fixes: the cell grid wraps at the antimeridian; a species' own range is never widened by the find
  slack; exposed shelf is land, per point too (paleo `ClimateMap.shelfAt`: coastal land, sea, sea ice).
- Height function swaps (HD block moves, zoom steps): checked every frame (anchor, 16 probes, and each
  landmark or monument past the houses, where a block's rim moves the ground); stale seats are replaced
  within 1 ms a frame, nearest first; cells rebuilt only for a median shift over 10 m. A block move went
  from 0.66 s to 17 `heightAt` (ultra, Rome). Animals: one sample plane each, sampled again after 2 m,
  new herds start level at one `heightAt` each (ultra steady frame 6.8 ms to 0.3 ms).

## Gaps

- Quaternius CC0 models unreachable (Google Drive quota), so models are procedural.
- No shadows, no animal avoidance or migration; sparse grass; one mesh variant per plant kind.
- People are generic (townspeople in the streets, farmers in the fields); livestock is cattle and sheep only.
- The base heights replaced by HD tiles after a jump still cost one full pick (0.2-0.5 s at ultra).
