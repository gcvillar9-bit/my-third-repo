/**
 * The `nebula:m42` frame: origin θ¹ Ori C at 400 pc from the Sun, axes east, north and the line of sight away from
 * Earth (model.ts). It hangs off 'mw' like the promoted star frames (starsystems), placed exactly like them, so
 * the Trapezium stars and the volume stay aligned.
 */
import {
  MW_FRAME,
  SSB_FRAME,
  type FrameDef,
  type FrameTree,
  type Quatd,
  type Vec3d,
} from '../../core/contracts';
import { qconj, qfromMatrix, qmul, qnormalize, qrotate, quat, vec3 } from '../../core/math64';
import { PC } from '../../core/units';
import { CENTER, D_PC } from './model';

export const NEBULA_FRAME = 'nebula:m42';
/** Camera anchoring radius of the frame, pc. */
export const NEBULA_INFLUENCE_PC = 12;

const DEG = Math.PI / 180;

/** ICRS unit vectors of the local axes at θ¹ Ori C: east, north, line of sight (east × north = sight). */
export function localAxesIcrs(
  raDeg = CENTER.raDeg,
  decDeg = CENTER.decDeg,
): { e: Vec3d; n: Vec3d; l: Vec3d } {
  const a = raDeg * DEG;
  const d = decDeg * DEG;
  return {
    e: vec3(-Math.sin(a), Math.cos(a), 0),
    n: vec3(-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)),
    l: vec3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)),
  };
}

const AX = localAxesIcrs();
/** Rotation taking local axes into ICRS (v_icrs = Q · v_local). */
export const Q_LOCAL_TO_ICRS: Readonly<Quatd> = qnormalize(
  quat(),
  qfromMatrix(quat(), [AX.e.x, AX.n.x, AX.l.x, AX.e.y, AX.n.y, AX.l.y, AX.e.z, AX.n.z, AX.l.z]),
);
const Q_ICRS_TO_LOCAL: Readonly<Quatd> = qconj(quat(), Q_LOCAL_TO_ICRS);

/** World (ICRS) vector -> local axes. */
export const toLocal = (v: Vec3d, out: Vec3d): Vec3d => qrotate(out, Q_ICRS_TO_LOCAL, v);
/** Local vector -> world (ICRS) axes. */
export const toWorld = (v: Vec3d, out: Vec3d): Vec3d => qrotate(out, Q_LOCAL_TO_ICRS, v);

/** Sun-centred ICRS position of θ¹ Ori C (the frame origin), pc. */
export const ORIGIN_PC: Readonly<Vec3d> = vec3(AX.l.x * D_PC, AX.l.y * D_PC, AX.l.z * D_PC);

export function nebulaFrame(frames: FrameTree): FrameDef {
  const ssb = frames.get(SSB_FRAME);
  if (!ssb) throw new Error('nebulae: no ssb frame');
  const q = quat();
  const p = vec3();
  return {
    id: NEBULA_FRAME,
    parent: MW_FRAME,
    influenceRadius: NEBULA_INFLUENCE_PC * PC,
    positionAt: (jd, out) => {
      p.x = ORIGIN_PC.x * PC;
      p.y = ORIGIN_PC.y * PC;
      p.z = ORIGIN_PC.z * PC;
      if (ssb.orientationAt) ssb.orientationAt(jd, q);
      else q.x = q.y = q.z = 0;
      if (!ssb.orientationAt) q.w = 1;
      qrotate(out, q, p);
      const o = ssb.positionAt(jd, p);
      out.x += o.x;
      out.y += o.y;
      out.z += o.z;
      return out;
    },
    orientationAt: (jd, out) => {
      if (ssb.orientationAt) ssb.orientationAt(jd, q);
      else {
        q.x = q.y = q.z = 0;
        q.w = 1;
      }
      return qmul(out, q, Q_LOCAL_TO_ICRS);
    },
  };
}
