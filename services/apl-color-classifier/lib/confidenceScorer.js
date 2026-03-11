/**
 * Confidence Score Calculator
 * Evaluates overall diagnosis reliability based on multiple factors
 */

/**
 * Calculate overall confidence score for a complete diagnosis
 *
 * @param {Object} params
 * @param {Object} params.colorResult - From classifyPersonalColor()
 * @param {Object} params.faceResult - From classifyFaceShape() (nullable)
 * @param {Object} params.bodyResult - From classifyBodyType() (nullable)
 * @param {Object} params.backgroundResult - From neutralizeBackground() (nullable)
 * @param {Object} params.measurements - Original input measurements
 * @returns {Object} - { overall, factors, recommendation }
 */
function calculateConfidence(params) {
  const {
    colorResult,
    faceResult,
    bodyResult,
    backgroundResult,
    measurements
  } = params;

  const factors = [];
  let totalScore = 0;
  let totalWeight = 0;

  // Factor 1: Color classification confidence (weight: 4)
  if (colorResult) {
    const score = colorResult.confidence || 0;
    factors.push({
      name: 'colorClassification',
      score,
      weight: 4,
      status: score > 0.75 ? 'good' : score > 0.5 ? 'moderate' : 'low'
    });
    totalScore += score * 4;
    totalWeight += 4;
  }

  // Factor 2: Color type margin (distance from 2nd best)
  if (colorResult && colorResult.alternates && colorResult.alternates.length > 0) {
    const margin = colorResult.confidence - colorResult.alternates[0].confidence;
    const marginScore = Math.min(1, margin / 0.15); // 0.15 gap = full score
    factors.push({
      name: 'typeMargin',
      score: Math.round(marginScore * 100) / 100,
      weight: 2,
      status: marginScore > 0.6 ? 'good' : marginScore > 0.3 ? 'moderate' : 'low',
      detail: `Gap to alternate: ${Math.round(margin * 100)}%`
    });
    totalScore += marginScore * 2;
    totalWeight += 2;
  }

  // Factor 3: Background quality
  if (backgroundResult) {
    let bgScore;
    switch (backgroundResult.confidence) {
      case 'high': bgScore = 1.0; break;
      case 'medium': bgScore = 0.7; break;
      case 'low': bgScore = 0.4; break;
      case 'none': bgScore = 0.8; break; // No correction needed = good
      default: bgScore = 0.5;
    }
    factors.push({
      name: 'backgroundQuality',
      score: bgScore,
      weight: 2,
      status: bgScore > 0.7 ? 'good' : bgScore > 0.4 ? 'moderate' : 'low'
    });
    totalScore += bgScore * 2;
    totalWeight += 2;
  }

  // Factor 4: Data completeness
  if (measurements) {
    let fieldsPresent = 0;
    let fieldsTotal = 5; // skin, hair, eye, contrast, background
    if (measurements.skinColor && measurements.skinColor.lab) fieldsPresent++;
    if (measurements.hairColor && measurements.hairColor.lab) fieldsPresent++;
    if (measurements.eyeColor && measurements.eyeColor.lab) fieldsPresent++;
    if (measurements.contrast && measurements.contrast.skinHair != null) fieldsPresent++;
    if (measurements.backgroundColor && measurements.backgroundColor.lab) fieldsPresent++;

    const completeness = fieldsPresent / fieldsTotal;
    factors.push({
      name: 'dataCompleteness',
      score: completeness,
      weight: 1,
      status: completeness > 0.8 ? 'good' : completeness > 0.5 ? 'moderate' : 'low',
      detail: `${fieldsPresent}/${fieldsTotal} fields`
    });
    totalScore += completeness * 1;
    totalWeight += 1;
  }

  // Factor 5: LAB values in plausible range
  if (measurements && measurements.skinColor && measurements.skinColor.lab) {
    const skin = measurements.skinColor.lab;
    let plausible = true;
    const issues = [];

    // Human skin L* typically 35-85
    if (skin.l < 35 || skin.l > 85) { plausible = false; issues.push('L* out of range'); }
    // Human skin a* typically -2 to 25
    if (skin.a < -2 || skin.a > 25) { plausible = false; issues.push('a* out of range'); }
    // Human skin b* typically -5 to 35
    if (skin.b < -5 || skin.b > 35) { plausible = false; issues.push('b* out of range'); }

    const plausibilityScore = plausible ? 1.0 : 0.3;
    factors.push({
      name: 'valuePlausibility',
      score: plausibilityScore,
      weight: 2,
      status: plausible ? 'good' : 'low',
      detail: plausible ? 'All values in human skin range' : issues.join(', ')
    });
    totalScore += plausibilityScore * 2;
    totalWeight += 2;
  }

  // Factor 6: Face classification (if available)
  if (faceResult) {
    const score = faceResult.confidence || 0;
    factors.push({
      name: 'faceClassification',
      score,
      weight: 1,
      status: score > 0.7 ? 'good' : score > 0.4 ? 'moderate' : 'low'
    });
    totalScore += score * 1;
    totalWeight += 1;
  }

  // Factor 7: Body classification (if available)
  if (bodyResult) {
    const score = bodyResult.confidence || 0;
    factors.push({
      name: 'bodyClassification',
      score,
      weight: 1,
      status: score > 0.7 ? 'good' : score > 0.4 ? 'moderate' : 'low'
    });
    totalScore += score * 1;
    totalWeight += 1;
  }

  // Overall score
  const overall = totalWeight > 0 ? totalScore / totalWeight : 0;
  const roundedOverall = Math.round(overall * 100) / 100;

  // Recommendation
  let recommendation;
  if (roundedOverall >= 0.75) {
    recommendation = 'high_confidence';
  } else if (roundedOverall >= 0.50) {
    recommendation = 'use_with_gemini_verification';
  } else {
    recommendation = 'defer_to_gemini';
  }

  return {
    overall: roundedOverall,
    recommendation,
    factors
  };
}

/**
 * Determine whether to trust internal classification or defer to Gemini
 * @param {number} confidence - Overall confidence score (0-1)
 * @returns {string} - 'internal' | 'hybrid' | 'gemini'
 */
function determineStrategy(confidence) {
  if (confidence >= 0.75) return 'internal';   // Trust internal classification
  if (confidence >= 0.50) return 'hybrid';     // Use internal + verify with Gemini
  return 'gemini';                              // Defer type decision to Gemini
}

module.exports = {
  calculateConfidence,
  determineStrategy
};
