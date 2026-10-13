// Phase functions (normalised over the sphere unless noted). cosTheta = dot(view, light) with the
// convention that cosTheta = 1 is forward scattering.
#ifndef COSMOS_PHASE_GLSL
#define COSMOS_PHASE_GLSL
#define COSMOS_PI 3.14159265358979
float phaseRayleigh(float cosTheta) { return 3.0 / (16.0 * COSMOS_PI) * (1.0 + cosTheta * cosTheta); }
float phaseHG(float cosTheta, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * COSMOS_PI * pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-6), 1.5));
}
// Cornette-Shanks (Mie, used by the Hillaire atmosphere).
float phaseCornetteShanks(float cosTheta, float g) {
  float g2 = g * g;
  float k = 3.0 / (8.0 * COSMOS_PI) * (1.0 - g2) / (2.0 + g2);
  return k * (1.0 + cosTheta * cosTheta) / pow(max(1.0 + g2 - 2.0 * g * cosTheta, 1e-6), 1.5);
}
// Lambert sphere integral phase, normalised to 1 at alpha = 0 (alpha = Sun-body-observer angle).
float phaseLambertSphere(float alpha) {
  return (sin(alpha) + (COSMOS_PI - alpha) * cos(alpha)) / COSMOS_PI;
}
// Lommel-Seeliger BRDF factor for airless regolith: mu0 / (mu0 + mu).
float lommelSeeliger(float mu0, float mu) { return mu0 > 0.0 ? mu0 / max(mu0 + mu, 1e-4) : 0.0; }
#endif
