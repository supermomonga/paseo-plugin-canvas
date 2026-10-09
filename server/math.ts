// MathJax is bundled from renderer/math.ts during setup and packing. Paseo's
// compiler rejects MathJax's package-internal imports once npm hoists it
// outside the plugin directory (ADR 14).
export { mathSvg } from "./generated/math";
