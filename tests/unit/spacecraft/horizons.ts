/**
 * Check values for the spacecraft position models, copied from JPL Horizons (API, vector tables,
 * geometric states, ICRF, km, TDB) on 2026-11-10. They are NOT inputs of the models: craft.json
 * holds one state per probe at 2026-Jan-01; these are other epochs of the same trajectories.
 *
 * Probes: heliocentric (centre 500@10). JWST: geocentric (centre 500@399).
 */
export interface Check {
  /** JD TDB. */
  jd: number;
  /** What the craft was doing (which model segment the epoch exercises). */
  phase: string;
  km: [number, number, number];
}

export const PROBE_CHECKS: Record<string, Check[]> = {
  voyager1: [
    {
      jd: 2443660.5,
      phase: 'Earth to Jupiter',
      km: [-1.470007853159734e8, 4.333760626572886e8, 1.960227979770572e8],
    },
    { jd: 2445800.5, phase: 'coast', km: [-1.875584045806707e9, -2.147256508048859e9, 4.888673397634324e8] },
    { jd: 2457388.5, phase: 'coast', km: [-4.11090959458007e9, -1.909709116374448e10, 4.218544802731166e9] },
  ],
  voyager2: [
    {
      jd: 2443660.5,
      phase: 'Earth to Jupiter',
      km: [-1.514187717961912e8, 4.026847279456772e8, 2.022111167047426e8],
    },
    {
      jd: 2444452.5,
      phase: 'Jupiter to Saturn',
      km: [-1.063817312943382e9, 1.108815983640014e8, 8.982711893062115e7],
    },
    {
      jd: 2445700.5,
      phase: 'Saturn to Uranus',
      km: [-1.003094962626847e9, -1.570600790138536e9, -6.499240719585831e8],
    },
    {
      jd: 2447161.5,
      phase: 'Uranus to Neptune',
      km: [2.326416203028398e8, -3.408059483529005e9, -1.437588435660579e9],
    },
    { jd: 2449718.5, phase: 'coast', km: [1.664663589439237e9, -4.916067067189365e9, -4.228627870617848e9] },
    { jd: 2457388.5, phase: 'coast', km: [4.531825065467176e9, -7.751087539380109e9, -1.378985399801551e10] },
  ],
  newhorizons: [
    {
      jd: 2453979.5,
      phase: 'Earth to Jupiter',
      km: [-3.050925454837697e8, -3.780070665275943e8, -1.56126871501866e8],
    },
    {
      jd: 2455562.5,
      phase: 'Jupiter to Pluto',
      km: [3.889662549811087e8, -2.581392629604279e9, -1.025533773396885e9],
    },
    { jd: 2457388.5, phase: 'coast', km: [1.27883979595706e9, -4.627917220270535e9, -1.818948097621447e9] },
    { jd: 2458484.5, phase: 'coast', km: [1.80185298252539e9, -5.789363402423389e9, -2.269443970803624e9] },
  ],
  pioneer10: [
    {
      jd: 2441683.5,
      phase: 'Earth to Jupiter',
      km: [2.061940739994569e8, -4.138528028194616e8, -1.943593787595005e8],
    },
    { jd: 2447892.5, phase: 'coast', km: [2.089312350532677e9, 6.149394594001906e9, 3.087860873284181e9] },
    { jd: 2457388.5, phase: 'coast', km: [3.177099350406613e9, 1.512995784862576e10, 7.541061033575828e9] },
  ],
  pioneer11: [
    {
      jd: 2442199.5,
      phase: 'Earth to Jupiter',
      km: [5.723405016721286e8, -1.854067298904046e8, -1.016002331259671e8],
    },
    {
      jd: 2442778.5,
      phase: 'Jupiter to Saturn',
      km: [3.664170148582793e8, 3.250302951003728e8, 2.714045759832177e8],
    },
    {
      jd: 2443660.5,
      phase: 'Jupiter to Saturn',
      km: [-9.132807500508091e8, 4.307398251222259e8, 3.16113485432657e8],
    },
    { jd: 2447892.5, phase: 'coast', km: [-4.438388957785662e8, -4.407162576594017e9, -5.549952324835026e8] },
    { jd: 2457388.5, phase: 'coast', km: [2.970738652711685e9, -1.338784168408439e10, -2.107824447358877e9] },
  ],
};

/** JWST relative to Earth's centre through 2026 (every second point of the table the halo was fitted to). */
export const JWST_CHECKS: Check[] = [
  { jd: 2461041.5, phase: 'halo', km: [9.054352085295379e4, 1.658426114520636e6, 3.464895842794345e5] },
  { jd: 2461071.5, phase: 'halo', km: [-2.818751114198603e5, 1.450423004095189e6, 5.184008380420611e5] },
  { jd: 2461101.5, phase: 'halo', km: [-9.889758946980308e5, 6.0977028485838e5, 5.002024949766231e5] },
  { jd: 2461131.5, phase: 'halo', km: [-1.087342909416996e6, -7.145455046907961e5, -6.921799070294229e4] },
  { jd: 2461161.5, phase: 'halo', km: [-5.51239611003169e5, -1.356990570692605e6, -6.777841893086466e5] },
  { jd: 2461191.5, phase: 'halo', km: [-2.445339392937933e5, -1.422829509315602e6, -9.763235959435141e5] },
  { jd: 2461221.5, phase: 'halo', km: [-1.540683450765905e5, -1.431742686346066e6, -9.911497000561354e5] },
  { jd: 2461251.5, phase: 'halo', km: [1.910297095591919e5, -1.435084092462814e6, -7.381826494561891e5] },
  { jd: 2461281.5, phase: 'halo', km: [9.049397685123183e5, -9.408995646548267e5, -1.869248825111543e5] },
  { jd: 2461311.5, phase: 'halo', km: [1.160202005738267e6, 3.411375484752816e5, 4.043919441731057e5] },
  { jd: 2461341.5, phase: 'halo', km: [6.649106314895344e5, 1.326060755657804e6, 5.100138449261314e5] },
  { jd: 2461371.5, phase: 'halo', km: [3.165842467309263e5, 1.629259748116796e6, 3.616865552553684e5] },
  { jd: 2461401.5, phase: 'halo', km: [2.162739969741481e5, 1.644139537635648e6, 3.556552955988725e5] },
];
