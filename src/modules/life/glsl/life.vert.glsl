// Life module: instanced low-poly creatures and plants (kit/mesh.ts). Prepended: DEPTH_GLSL.
// Model space: metres, +x forward, +y up, +z right. Each vertex hangs from a joint (aJoint, aBend)
// and is posed by a procedural gait; instances sit in the anchor's tangent frame (body-fixed axes).
attribute vec3 aColor;
attribute vec4 aJoint; // xyz pivot, w part (kit/mesh.ts PART)
attribute vec4 aBend;  // xyz knee pivot, w bend weight / below-knee flag
attribute vec3 iPos;    // body-fixed offset from the anchor, m
attribute vec4 iFrame;  // heading cos, heading sin (north, east), scale, colour variation
attribute vec4 iMotion; // gait phase (cycles), move 0..1, graze 0..1, height above ground (flyers), m

uniform mat3 uBodyToWorld;
uniform vec3 uAnchorRel;  // anchor, camera-relative, world axes, m
uniform vec3 uEast;       // anchor tangent frame, body-fixed axes
uniform vec3 uNorth;
uniform vec3 uUp;
uniform vec4 uGait;       // swing (rad), knee (rad), kind (0 walk, 1 biped, 2 upright, 3 fly, 4 plant), sway
uniform float uLifeTime;  // real seconds (idle motion and wind)

varying vec3 vColor;
varying vec3 vWorld;
varying float vAo;

const float TAU = 6.28318530718;

vec3 rotZ(vec3 p, vec3 c, float a) {
  vec3 d = p - c;
  float s = sin(a), k = cos(a);
  return c + vec3(k * d.x - s * d.y, s * d.x + k * d.y, d.z);
}
vec3 rotX(vec3 p, vec3 c, float a) {
  vec3 d = p - c;
  float s = sin(a), k = cos(a);
  return c + vec3(d.x, k * d.y - s * d.z, s * d.y + k * d.z);
}
vec3 rotY(vec3 p, vec3 c, float a) {
  vec3 d = p - c;
  float s = sin(a), k = cos(a);
  return c + vec3(k * d.x + s * d.z, d.y, -s * d.x + k * d.z);
}

// Phase offset (cycles) of a limb in the gait.
float limbOffset(int part, int kind) {
  if (kind == 0) { // lateral-sequence walk: BL, FL, BR, FR
    if (part == 3) return 0.0;
    if (part == 1) return 0.25;
    if (part == 4) return 0.5;
    return 0.75;
  }
  // bipeds and uprights: legs in antiphase, arms against the opposite leg
  if (part == 3 || part == 10) return 0.0;
  return 0.5;
}

vec3 pose(vec3 p, float phase, float move, float graze, float seed) {
  int part = int(aJoint.w + 0.5);
  int kind = int(uGait.z + 0.5);
  if (kind == 4) {
    // Plants: wind sway grows with height (aBend.w), two incommensurate frequencies.
    float w = aBend.w;
    float t = uLifeTime * 0.9 + seed * 17.0;
    p.x += uGait.w * w * (sin(t) + 0.4 * sin(2.3 * t + 1.0));
    p.z += uGait.w * w * 0.6 * sin(1.3 * t + 2.0);
    return p;
  }
  if ((part >= 1 && part <= 4) || part == 9 || part == 10) {
    float off = limbOffset(part, kind);
    float a = TAU * (phase + off);
    bool arm = part >= 9;
    float amp = uGait.x * (arm ? (kind == 2 ? 0.7 : 0.25) : 1.0);
    // Arms swing against the legs.
    float swing = (arm ? -1.0 : 1.0) * amp * move * sin(a);
    float knee = uGait.y * move * max(0.0, sin(a + 1.5708));
    if (aBend.w > 0.5) p = rotZ(p, aBend.xyz, arm ? 0.3 * knee + 0.25 : -knee);
    p = rotZ(p, aJoint.xyz, swing);
  } else if (part == 5) {
    // Neck and head: nod with the stride, lower to graze when standing.
    float nod = 0.05 * move * sin(TAU * phase * 2.0);
    float idle = 0.06 * sin(uLifeTime * 0.7 + seed * 11.0) * (1.0 - move);
    p = rotZ(p, aJoint.xyz, (nod + idle - 0.75 * graze) * aBend.w);
  } else if (part == 6) {
    // Tail: sways side to side with the stride, slowly when idle.
    float sway = 0.12 * move * sin(TAU * phase) + 0.08 * sin(uLifeTime * 0.9 + seed * 7.0);
    p = rotY(p, aJoint.xyz, sway * aBend.w);
  } else if (part == 7 || part == 8) {
    float side = part == 7 ? -1.0 : 1.0;
    float flap = uGait.x * sin(TAU * phase) * (0.35 + 0.65 * aBend.w);
    p = rotX(p, aJoint.xyz, side * flap);
  }
  // Body bob: twice per stride.
  if (kind != 3) p.y += 0.015 * uGait.x * move * aJoint.y * cos(TAU * phase * 2.0);
  return p;
}

void main() {
  float scale = iFrame.z;
  float seed = fract(iPos.x * 0.0131 + iPos.y * 0.0173 + iPos.z * 0.0119);
  vec3 p = pose(position, iMotion.x, iMotion.y, iMotion.z, seed) * scale;
  p.y += iMotion.w;
  vec3 fwd = iFrame.x * uNorth + iFrame.y * uEast;
  vec3 right = cross(fwd, uUp);
  vec3 body = iPos + fwd * p.x + uUp * p.y + right * p.z;
  vec3 world = uBodyToWorld * body + uAnchorRel;
  vWorld = world;
  // Colour variation per individual, and contact darkening near the ground.
  vColor = aColor * (1.0 + 0.18 * (iFrame.w - 0.5));
  vAo = 0.55 + 0.45 * smoothstep(0.0, 0.6, position.y / max(0.3, aJoint.y + 0.3));
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  LOG_DEPTH_VERTEX();
}
