/**
 * LAB Color Utilities
 * CIE LAB color space conversions and distance calculations
 */

/**
 * Convert CIE LAB to XYZ (D65 illuminant)
 */
function labToXyz(l, a, b) {
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;

  const delta = 6 / 29;
  const delta3 = delta * delta * delta;

  const xr = fx > delta ? fx * fx * fx : (fx - 16 / 116) * 3 * delta * delta;
  const yr = l > 8 ? fy * fy * fy : l / (24389 / 27);
  const zr = fz > delta ? fz * fz * fz : (fz - 16 / 116) * 3 * delta * delta;

  // D65 illuminant reference
  return {
    x: xr * 95.047,
    y: yr * 100.0,
    z: zr * 108.883
  };
}

/**
 * Convert XYZ to linear sRGB
 */
function xyzToLinearRgb(x, y, z) {
  x /= 100;
  y /= 100;
  z /= 100;

  return {
    r: x * 3.2406 + y * -1.5372 + z * -0.4986,
    g: x * -0.9689 + y * 1.8758 + z * 0.0415,
    b: x * 0.0557 + y * -0.2040 + z * 1.0570
  };
}

/**
 * Apply sRGB gamma correction
 */
function linearToSrgb(c) {
  return c <= 0.0031308
    ? 12.92 * c
    : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * Convert CIE LAB to sRGB {r, g, b} (0-255)
 */
function labToRgb(l, a, b) {
  const xyz = labToXyz(l, a, b);
  const linear = xyzToLinearRgb(xyz.x, xyz.y, xyz.z);

  return {
    r: Math.round(Math.min(255, Math.max(0, linearToSrgb(linear.r) * 255))),
    g: Math.round(Math.min(255, Math.max(0, linearToSrgb(linear.g) * 255))),
    b: Math.round(Math.min(255, Math.max(0, linearToSrgb(linear.b) * 255)))
  };
}

/**
 * Convert LAB to CSS color string
 */
function labToCssColor(l, a, b) {
  const rgb = labToRgb(l, a, b);
  return `rgb(${rgb.r},${rgb.g},${rgb.b})`;
}

/**
 * Convert sRGB (0-255) to CIE LAB
 */
function rgbToLab(r, g, b) {
  // sRGB to linear
  let rl = r / 255;
  let gl = g / 255;
  let bl = b / 255;

  rl = rl > 0.04045 ? Math.pow((rl + 0.055) / 1.055, 2.4) : rl / 12.92;
  gl = gl > 0.04045 ? Math.pow((gl + 0.055) / 1.055, 2.4) : gl / 12.92;
  bl = bl > 0.04045 ? Math.pow((bl + 0.055) / 1.055, 2.4) : bl / 12.92;

  // Linear RGB to XYZ (D65)
  let x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  let y = (rl * 0.2126 + gl * 0.7152 + bl * 0.0722) / 1.00000;
  let z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;

  const epsilon = 0.008856;
  const kappa = 903.3;

  x = x > epsilon ? Math.cbrt(x) : (kappa * x + 16) / 116;
  y = y > epsilon ? Math.cbrt(y) : (kappa * y + 16) / 116;
  z = z > epsilon ? Math.cbrt(z) : (kappa * z + 16) / 116;

  return {
    l: 116 * y - 16,
    a: 500 * (x - y),
    b: 200 * (y - z)
  };
}

/**
 * CIE76 Delta E (Euclidean distance in LAB space)
 */
function deltaE76(lab1, lab2) {
  const dL = lab1.l - lab2.l;
  const dA = lab1.a - lab2.a;
  const dB = lab1.b - lab2.b;
  return Math.sqrt(dL * dL + dA * dA + dB * dB);
}

/**
 * Euclidean distance in RGB space (for contrast measurement)
 */
function rgbDistance(rgb1, rgb2) {
  const dr = rgb1.r - rgb2.r;
  const dg = rgb1.g - rgb2.g;
  const db = rgb1.b - rgb2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Calculate chroma from LAB a* and b*
 * Chroma = sqrt(a*² + b*²)
 */
function labChroma(a, b) {
  return Math.sqrt(a * a + b * b);
}

/**
 * Calculate hue angle from LAB a* and b* (in degrees)
 */
function labHueAngle(a, b) {
  let h = Math.atan2(b, a) * (180 / Math.PI);
  if (h < 0) h += 360;
  return h;
}

module.exports = {
  labToRgb,
  labToCssColor,
  rgbToLab,
  labToXyz,
  deltaE76,
  rgbDistance,
  labChroma,
  labHueAngle
};
