/**
 * APL Color Classifier — Standalone Module
 *
 * Deterministic personal color, face shape, and body type classification engine.
 * Pure JavaScript — zero external dependencies.
 *
 * Usage:
 *   const { classifyPersonalColor, classifyFaceShape, classifyBodyType,
 *           neutralizeBackground, calculateConfidence, labUtils } = require('./apl-color-classifier');
 *
 *   const colorResult = classifyPersonalColor({
 *     skinColor: { lab: { l: 72.5, a: 8.2, b: 18.3 } },
 *     hairColor: { lab: { l: 12.3, a: 1.5, b: -0.8 } },
 *     eyeColor: { lab: { l: 15.2, a: 3.1, b: 2.0 } },
 *     eyebrowColor: { lab: { l: 18.5, a: 2.3, b: 3.1 } },
 *     contrast: { skinHair: 268, skinEye: 262 }
 *   });
 *   // → { type: 'Spring Light', season: 'Spring', confidence: 0.82, ... }
 */

const {
  classifyPersonalColor,
  determineSkinLightness,
  determineSkinChroma,
  determineElementChroma,
  determineHueAngle,
  COLOR_TYPES,
  SEASON_MAP,
  HUE_BASELINE
} = require('./lib/colorClassifier');
const { classifyFaceShape, FACE_REFERENCE } = require('./lib/faceClassifier');
const { classifyBodyType, BODY_REFERENCE } = require('./lib/bodyClassifier');
const { neutralizeBackground, detectContamination } = require('./lib/backgroundNeutralizer');
const { calculateConfidence, determineStrategy } = require('./lib/confidenceScorer');
const labUtils = require('./lib/labUtils');

/**
 * Full diagnosis pipeline — runs all classifiers with background correction
 *
 * @param {Object} input
 * @param {Object} input.skinColor - { lab: { l, a, b } }
 * @param {Object} input.hairColor - { lab: { l, a, b } } (optional)
 * @param {Object} input.eyeColor - { lab: { l, a, b } } (optional)
 * @param {Object} input.eyebrowColor - { lab: { l, a, b } } (optional)
 * @param {Object} input.contrast - { skinHair, skinEye } (optional)
 * @param {Object} input.backgroundColor - { lab: { l, a, b } } (optional)
 * @param {Object} input.neckColor - { lab: { l, a, b } } (optional)
 * @param {Object} input.faceProportions - { foreheadRatio, jawRatio, heightRatio } (optional)
 * @param {Object} input.bodyProportions - { shoulderHipRatio, waistHipRatio, torsoLegRatio } (optional)
 * @returns {Object} Complete diagnosis result
 */
function fullDiagnosis(input) {
  const {
    skinColor,
    hairColor,
    eyeColor,
    eyebrowColor,
    contrast,
    backgroundColor,
    neckColor,
    faceProportions,
    bodyProportions
  } = input;

  // Step 1: Background neutralization
  let backgroundResult = null;
  let effectiveSkinLab = skinColor.lab;

  if (backgroundColor && backgroundColor.lab) {
    backgroundResult = neutralizeBackground(
      skinColor.lab,
      backgroundColor.lab,
      neckColor ? neckColor.lab : null
    );
    effectiveSkinLab = backgroundResult.corrected;
  }

  // Step 2: Personal color classification (using corrected skin values)
  const colorMeasurements = {
    skinColor: { lab: effectiveSkinLab },
    hairColor,
    eyeColor,
    eyebrowColor,
    contrast
  };
  const colorResult = classifyPersonalColor(colorMeasurements);

  // Step 3: Face shape classification (if proportions available)
  let faceResult = null;
  if (faceProportions) {
    faceResult = classifyFaceShape(faceProportions);
  }

  // Step 4: Body type classification (if proportions available)
  let bodyResult = null;
  if (bodyProportions) {
    bodyResult = classifyBodyType(bodyProportions);
  }

  // Step 5: Confidence scoring
  const confidence = calculateConfidence({
    colorResult,
    faceResult,
    bodyResult,
    backgroundResult,
    measurements: input
  });

  const strategy = determineStrategy(confidence.overall);

  return {
    personalColor: colorResult,
    faceShape: faceResult,
    bodyType: bodyResult,
    backgroundCorrection: backgroundResult,
    confidence,
    strategy // 'internal' | 'hybrid' | 'gemini'
  };
}

module.exports = {
  // Main pipeline
  fullDiagnosis,

  // Individual classifiers
  classifyPersonalColor,
  classifyFaceShape,
  classifyBodyType,

  // Background correction
  neutralizeBackground,
  detectContamination,

  // Confidence scoring
  calculateConfidence,
  determineStrategy,

  // Color classifier internals (for testing/debugging)
  determineSkinLightness,
  determineSkinChroma,
  determineElementChroma,
  determineHueAngle,

  // LAB utilities
  labUtils,

  // Reference data
  COLOR_TYPES,
  SEASON_MAP,
  HUE_BASELINE,
  FACE_REFERENCE,
  BODY_REFERENCE
};
