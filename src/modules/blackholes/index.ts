/**
 * blackholes (P4-B): Schwarzschild lensing ScreenPass (reduced-resolution RK4 near the hole, weak
 * LUT lensing further out, background cube captured in-module), Novikov-Thorne disks with g-factor
 * beaming, the catalogue (Sgr A*, M87*, Cyg X-1 with HDE 226868 and a stream, Gaia BH1-3, V404 Cyg,
 * A0620-00), S-stars with Schwarzschild precession, settings, search/info and bookmarks.
 * See docs/modules/blackholes.md.
 */
import type { ModuleContext, SettingValue, UniverseModule } from '../../core/contracts';
import { AU } from '../../core/units';
import { diskLuminance, starSurface } from '../sun/public';
import {
  buildHole,
  companionOrbit,
  companionPosition,
  holeBody,
  holeFrame,
  type Catalogue,
  type Hole,
} from './catalog';
import { boundRadius, createLensingPass } from './lensing';
import { buildBookmarks, createInfo, createSearch, sstarBodyId } from './providers';
import { SSTAR_RADIUS, createDiskMesh, createSStars, createStream } from './renderables';
import { makeOrbit, skyBasis, sstarPosition, yearToJd } from './sstars';
import { defaultState, type BlackholeState } from './state';
import { BLACKHOLES_MODULE_ID, CATALOGUE_PATH } from './public';

function addSettings(ctx: ModuleContext, state: BlackholeState): void {
  const bool = (id: keyof BlackholeState, label: string, description: string) =>
    ctx.registry.addSetting({
      id: `blackholes.${id}`,
      label,
      group: 'Black holes',
      type: 'boolean',
      default: true,
      persist: true,
      description,
      onChange: (v: SettingValue) => {
        (state as unknown as Record<string, boolean>)[id] = Boolean(v);
      },
    });
  bool('lensing', 'Gravitational lensing', 'Bend light around black holes (off: straight rays).');
  bool(
    'beaming',
    'Doppler beaming',
    'Approaching gas looks brighter and bluer, receding gas dimmer and redder.',
  );
  bool('redshift', 'Gravitational redshift', 'Light climbing out of the well loses energy (redder, dimmer).');
  bool('disk', 'Accretion disks', 'Show accretion disks, glows and streams.');
  ctx.registry.addSetting({
    id: 'blackholes.mode',
    label: 'Disk style',
    group: 'Black holes',
    type: 'select',
    default: 'illustrative',
    persist: true,
    options: [
      { value: 'illustrative', label: 'Illustrative (bright thin disk)' },
      { value: 'realistic', label: 'Realistic (dim hot flow, Sgr A* as it is)' },
    ],
    onChange: (v: SettingValue) => {
      state.mode = v === 'realistic' ? 'realistic' : 'illustrative';
    },
  });
  bool('orbits', 'S-star orbits', 'Draw the orbits of the stars around Sgr A*.');
}

const blackholes: UniverseModule = {
  id: BLACKHOLES_MODULE_ID,
  dependsOn: ['sun'],
  async init(ctx: ModuleContext) {
    const { registry, frames, render } = ctx;
    const cat = await ctx.assets.json<Catalogue>(CATALOGUE_PATH);
    const state = defaultState();
    addSettings(ctx, state);
    const jd0 = ctx.clock.jd;
    const holes: Hole[] = cat.holes.map(buildHole);
    for (const h of holes) {
      registry.addFrame(holeFrame(h, frames, jd0));
      registry.addBody(holeBody(h));
    }

    // S-stars around Sgr A*.
    const sgra = holes.find((h) => h.row.atMwOrigin);
    const orbits = sgra ? cat.sstars.map((r) => makeOrbit(r, sgra.row.massMsun, sgra.rs)) : [];
    if (sgra) {
      const basis = skyBasis(sgra.row.raDeg, sgra.row.decDeg);
      const ids: string[] = [];
      for (const o of orbits) {
        const id = sstarBodyId(o.row.id);
        ids.push(id);
        registry.addFrame({
          id,
          parent: sgra.frame,
          influenceRadius: 2 * AU,
          positionAt: (jd, out) => sstarPosition(o, basis, jd, out),
        });
        registry.addBody({
          id,
          name: o.row.name,
          kind: 'star',
          frame: id,
          parent: sgra.id,
          radius: SSTAR_RADIUS,
          teff: o.row.teffK,
          absMag: o.row.absMagV,
          influenceRadius: 2 * AU,
          labelPriority: o.row.id === 's2' ? 50 : 30,
        });
        registry.setSurfaceShading(starSurface(o.row.teffK, SSTAR_RADIUS, { bodyId: id }));
      }
      for (const r of createSStars({
        orbits,
        frames: ids,
        basis,
        holeFrame: sgra.frame,
        exposure: render.uniforms.uExposure,
        state,
      }))
        registry.addRenderable(r);
      registry.addValidity({
        id: 'blackholes.s-stars',
        appliesTo: 's-stars',
        model: 'Kepler + Schwarzschild precession',
        jdMin: yearToJd(1992),
        jdMax: yearToJd(2100),
        beyond: 'extrapolated',
        source: 'Gillessen et al. 2017; GRAVITY Collaboration 2020, 2022',
      });
    }

    const lens = createLensingPass(render, holes, state);
    registry.addScreenPass(lens);

    // Companions, disk meshes and streams (X-ray binaries).
    const small = ctx.quality.preset === 'potato' || ctx.quality.preset === 'low';
    const bookmarks = buildBookmarks(holes, orbits);
    for (const h of holes) {
      const innerCut = () => {
        const t = lens.target();
        return t && t.hole === h ? boundRadius(h, state.disk) : 3;
      };
      if (h.disk.meshOutRs)
        registry.addRenderable(
          createDiskMesh(
            h,
            render.uniforms,
            state,
            small ? { radial: 48, angular: 96 } : { radial: 96, angular: 192 },
            innerCut,
          ),
        );
      const orbit = companionOrbit(h);
      if (!orbit) continue;
      const c = orbit.row;
      registry.addFrame({
        id: c.id,
        parent: h.frame,
        influenceRadius: 20 * orbit.radius,
        positionAt: (jd, out) => companionPosition(orbit, jd, out),
      });
      registry.addBody({
        id: c.id,
        name: c.name,
        kind: 'star',
        frame: c.id,
        parent: h.id,
        radius: orbit.radius,
        teff: c.teffK,
        influenceRadius: 20 * orbit.radius,
        labelPriority: 45,
      });
      registry.setSurfaceShading(starSurface(c.teffK, orbit.radius, { bodyId: c.id }));
      const lComp = diskLuminance(c.teffK);
      registry.addRenderable(createStream(h, orbit, state, small ? 600 : 1500, 0.12 * lComp));
      // Test/photo exposure for the Cyg X-1 bookmark: companion's mean disk at about 3 (pre-exposed).
      for (const b of bookmarks)
        if (b.frame === h.frame && b.ev === 0) b.ev = Math.round(Math.log2(lComp / (1.2 * 3)) * 2) / 2;
    }

    registry.addSearch(createSearch(holes, orbits));
    registry.addInfo(createInfo(holes, orbits));
    registry.addBookmarks(bookmarks);
  },
};

export default blackholes;
