/**
 * Background Color Neutralizer
 * Compensates for background/clothing color contamination on skin measurements
 *
 * Problem: Customer's clothing or wall color can shift skin LAB readings.
 * Solution: Detect background color influence and adjust skin LAB values.
 */

const { labChroma, deltaE76 } = require('./labUtils');

/**
 * Neutralize background color influence on skin measurements
 *
 * @param {Object} skinLab - Measured skin LAB { l, a, b }
 * @param {Object} backgroundLab - Detected background LAB { l, a, b } (nullable)
 * @param {Object} neckLab - Measured neck LAB { l, a, b } (nullable)
 * @returns {Object} - { original, corrected, adjustments, reason, confidence }
 */
function neutralizeBackground(skinLab, backgroundLab, neckLab) {
  if (!skinLab) {
    throw new Error('skinLab is required');
  }

  const result = {
    original: { ...skinLab },
    corrected: { ...skinLab },
    adjustments: { dL: 0, dA: 0, dB: 0 },
    reasons: [],
    confidence: 'none' // none | low | medium | high
  };

  // No background data — return as-is
  if (!backgroundLab) {
    result.confidence = 'none';
    result.reasons.push('No background data available');
    return result;
  }

  let totalAdjustment = 0;

  // --- Check 1: Warm background contamination ---
  // If background b* is high (yellow/warm wall or warm lighting),
  // skin b* is likely inflated
  if (backgroundLab.b > 20) {
    const influence = Math.min(3.0, (backgroundLab.b - 20) * 0.15);
    result.corrected.b -= influence;
    result.adjustments.dB -= influence;
    result.reasons.push(`Warm background compensation (b* -${influence.toFixed(1)})`);
    totalAdjustment += Math.abs(influence);
  }

  // --- Check 2: Cool background contamination ---
  // If background b* is very negative (blue wall or cool lighting),
  // skin b* is likely deflated
  if (backgroundLab.b < -5) {
    const influence = Math.min(2.5, (-5 - backgroundLab.b) * 0.12);
    result.corrected.b += influence;
    result.adjustments.dB += influence;
    result.reasons.push(`Cool background compensation (b* +${influence.toFixed(1)})`);
    totalAdjustment += Math.abs(influence);
  }

  // --- Check 3: Red/green background contamination ---
  // High |a*| background can shift skin a* reading
  if (Math.abs(backgroundLab.a) > 15) {
    const influence = Math.min(2.0, (Math.abs(backgroundLab.a) - 15) * 0.10);
    if (backgroundLab.a > 0) {
      result.corrected.a -= influence;
      result.adjustments.dA -= influence;
      result.reasons.push(`Red background compensation (a* -${influence.toFixed(1)})`);
    } else {
      result.corrected.a += influence;
      result.adjustments.dA += influence;
      result.reasons.push(`Green background compensation (a* +${influence.toFixed(1)})`);
    }
    totalAdjustment += Math.abs(influence);
  }

  // --- Check 4: Very bright/dark background lighting influence ---
  // Very bright background (L* > 90) can make skin appear darker
  // Very dark background (L* < 20) can make skin appear lighter
  if (backgroundLab.l > 90) {
    const influence = Math.min(2.0, (backgroundLab.l - 90) * 0.2);
    result.corrected.l += influence;
    result.adjustments.dL += influence;
    result.reasons.push(`Bright background compensation (L* +${influence.toFixed(1)})`);
    totalAdjustment += Math.abs(influence);
  } else if (backgroundLab.l < 20) {
    const influence = Math.min(2.0, (20 - backgroundLab.l) * 0.15);
    result.corrected.l -= influence;
    result.adjustments.dL -= influence;
    result.reasons.push(`Dark background compensation (L* -${influence.toFixed(1)})`);
    totalAdjustment += Math.abs(influence);
  }

  // --- Check 5: Neck-skin consistency validation ---
  // If neck and skin have very different colors, lighting may be uneven
  if (neckLab) {
    const skinNeckDelta = deltaE76(skinLab, neckLab);

    if (skinNeckDelta > 10) {
      // Large difference — trust neck color more (less direct lighting influence)
      const blendWeight = Math.min(0.3, (skinNeckDelta - 10) / 30);

      const blendedL = skinLab.l * (1 - blendWeight) + neckLab.l * blendWeight;
      const blendedA = skinLab.a * (1 - blendWeight) + neckLab.a * blendWeight;
      const blendedB = skinLab.b * (1 - blendWeight) + neckLab.b * blendWeight;

      result.corrected.l = blendedL;
      result.corrected.a = blendedA;
      result.corrected.b = blendedB;

      result.adjustments.dL = blendedL - skinLab.l;
      result.adjustments.dA = blendedA - skinLab.a;
      result.adjustments.dB = blendedB - skinLab.b;

      result.reasons.push(`Skin-neck blending (weight: ${(blendWeight * 100).toFixed(0)}%, deltaE: ${skinNeckDelta.toFixed(1)})`);
      totalAdjustment += skinNeckDelta * blendWeight;
    }
  }

  // --- Determine confidence level ---
  if (totalAdjustment === 0) {
    result.confidence = 'none';
    result.reasons.push('No correction needed');
  } else if (totalAdjustment < 2) {
    result.confidence = 'high';
  } else if (totalAdjustment < 5) {
    result.confidence = 'medium';
  } else {
    result.confidence = 'low'; // Large corrections = less reliable
  }

  // Round corrected values
  result.corrected.l = Math.round(result.corrected.l * 10) / 10;
  result.corrected.a = Math.round(result.corrected.a * 10) / 10;
  result.corrected.b = Math.round(result.corrected.b * 10) / 10;
  result.adjustments.dL = Math.round(result.adjustments.dL * 10) / 10;
  result.adjustments.dA = Math.round(result.adjustments.dA * 10) / 10;
  result.adjustments.dB = Math.round(result.adjustments.dB * 10) / 10;

  return result;
}

/**
 * Detect if background is likely contaminating skin readings
 * @param {Object} backgroundLab - Background LAB values
 * @returns {Object} - { contaminated, level, description }
 */
function detectContamination(backgroundLab) {
  if (!backgroundLab) {
    return { contaminated: false, level: 'unknown', description: 'No background data' };
  }

  const chroma = labChroma(backgroundLab.a, backgroundLab.b);
  const issues = [];

  if (backgroundLab.b > 20) issues.push('warm wall/lighting');
  if (backgroundLab.b < -5) issues.push('cool wall/lighting');
  if (Math.abs(backgroundLab.a) > 15) issues.push('colored wall');
  if (chroma > 25) issues.push('highly saturated background');
  if (backgroundLab.l > 90) issues.push('very bright background');
  if (backgroundLab.l < 20) issues.push('very dark background');

  if (issues.length === 0) {
    return { contaminated: false, level: 'clean', description: 'Neutral background' };
  }

  const level = issues.length >= 3 ? 'high' : issues.length >= 2 ? 'medium' : 'low';

  return {
    contaminated: true,
    level,
    description: issues.join(', ')
  };
}

module.exports = {
  neutralizeBackground,
  detectContamination
};
