/**
 * Deterministic Personal Color Classifier v2
 *
 * Classification based on 3 axes + hue angle:
 *   Axis 1: Skin Lightness (L*)
 *   Axis 2: Skin Chroma — sqrt(a*^2 + b*^2)
 *   Axis 3: Element Chroma — average sqrt(a*^2 + b*^2) of hair, eyebrows, iris
 *   Hue: atan2(b*, a*) for warm/cool distinction
 *
 * 14 personal color types classified using these measurements.
 * Paired types sharing the same 3-axis profile are distinguished
 * by hue angle (warm vs cool undertone).
 */

const { labChroma, labHueAngle } = require('./labUtils');

// ─── 14 Personal Color Type Definitions ───
// Each type: target ranges for [skinL, skinChroma, elemChroma] + hue tendency
// Paired types have identical 3-axis ranges, distinguished only by hue
const COLOR_TYPES = {
  // Spring (Warm)
  'Spring Light':  { skinL: [66, 76], skinC: [8, 14],  elemC: [4, 9],   hue: 'warm', pair: 'Summer Light' },
  'Spring Bright': { skinL: [66, 76], skinC: [18, 26], elemC: [14, 25], hue: 'warm', pair: 'Summer Bright' },
  'Spring Clear':  { skinL: [66, 76], skinC: [8, 14],  elemC: [14, 25], hue: 'warm', pair: 'Winter Clear' },
  'Spring Soft':   { skinL: [60, 68], skinC: [12, 18], elemC: [4, 9],   hue: 'neutral', pair: null },

  // Summer (Cool)
  'Summer Light':  { skinL: [66, 76], skinC: [8, 14],  elemC: [4, 9],   hue: 'cool', pair: 'Spring Light' },
  'Summer Bright': { skinL: [66, 76], skinC: [18, 26], elemC: [14, 25], hue: 'cool', pair: 'Spring Bright' },
  'Summer Mute':   { skinL: [50, 58], skinC: [12, 18], elemC: [4, 9],   hue: 'cool', pair: 'Autumn Mute' },

  // Autumn (Warm)
  'Autumn Mute':   { skinL: [50, 58], skinC: [12, 18], elemC: [4, 9],   hue: 'warm', pair: 'Summer Mute' },
  'Autumn Deep':   { skinL: [48, 54], skinC: [18, 26], elemC: [14, 25], hue: 'warm', pair: 'Winter Deep' },
  'Autumn Strong': { skinL: [52, 58], skinC: [18, 26], elemC: [14, 25], hue: 'warm', pair: 'Winter Strong' },

  // Winter (Cool)
  'Winter Clear':  { skinL: [66, 76], skinC: [8, 14],  elemC: [14, 25], hue: 'cool', pair: 'Spring Clear' },
  'Winter Deep':   { skinL: [48, 54], skinC: [18, 26], elemC: [14, 25], hue: 'cool', pair: 'Autumn Deep' },
  'Winter Strong': { skinL: [52, 58], skinC: [18, 26], elemC: [14, 25], hue: 'cool', pair: 'Autumn Strong' },
  'Winter Soft':   { skinL: [50, 58], skinC: [12, 18], elemC: [9, 14],  hue: 'neutral', pair: null }
};

const SEASON_MAP = {
  Spring: ['Spring Light', 'Spring Bright', 'Spring Clear', 'Spring Soft'],
  Summer: ['Summer Light', 'Summer Bright', 'Summer Mute'],
  Autumn: ['Autumn Mute', 'Autumn Deep', 'Autumn Strong'],
  Winter: ['Winter Clear', 'Winter Deep', 'Winter Strong', 'Winter Soft']
};

// Hue angle baseline for warm/cool distinction
// Human skin hue angle atan2(b*, a*) typically 50-80 degrees
// Above baseline = warm (yellow-leaning), below = cool (pink-leaning)
const HUE_BASELINE = 57;

// ─── Axis Calculators ───

/**
 * Axis 1: Skin Lightness from L*
 * Maps to Korean 27-level notation system
 */
function determineSkinLightness(skinLab) {
  const L = skinLab.l;

  let major, sub;
  if (L >= 66) {
    major = '\uace0';
    sub = L >= 76 ? '\uace0' : L >= 71 ? '\uc911' : '\uc800';
  } else if (L >= 50) {
    major = '\uc911';
    sub = L >= 60 ? '\uace0' : L >= 55 ? '\uc911' : '\uc800';
  } else {
    major = '\uc800';
    sub = L >= 46 ? '\uace0' : L >= 42 ? '\uc911' : '\uc800';
  }

  return { value: L, level: major + sub };
}

/**
 * Axis 2: Skin Chroma = sqrt(a*^2 + b*^2)
 */
function determineSkinChroma(skinLab) {
  const chroma = labChroma(skinLab.a, skinLab.b);

  let level;
  if (chroma >= 26) level = '\uace0\uace0';
  else if (chroma >= 18) level = '\uc911\uace0';
  else if (chroma >= 14) level = '\uc911\uc911';
  else if (chroma >= 12) level = '\uc911\uc800';
  else if (chroma >= 8) level = '\uc800\uc911';
  else level = '\uc800\uc800';

  return { value: chroma, level };
}

/**
 * Axis 3: Element Chroma = average sqrt(a*^2 + b*^2) of hair, eyebrows, iris
 */
function determineElementChroma(hairLab, eyebrowLab, eyeLab) {
  const elements = [];
  if (hairLab) elements.push(labChroma(hairLab.a, hairLab.b));
  if (eyebrowLab) elements.push(labChroma(eyebrowLab.a, eyebrowLab.b));
  if (eyeLab) elements.push(labChroma(eyeLab.a, eyeLab.b));

  if (elements.length === 0) return { value: 0, level: '\uc911\uc911', count: 0 };

  const avg = elements.reduce((s, v) => s + v, 0) / elements.length;

  let level;
  if (avg >= 20) level = '\uace0\uace0';
  else if (avg >= 14) level = '\uace0\uc911';
  else if (avg >= 9) level = '\uc911\uace0';
  else if (avg >= 4) level = '\uc911\uc800';
  else level = '\uc800\uc800';

  return { value: avg, level, count: elements.length };
}

/**
 * Hue angle for warm/cool determination
 * atan2(b*, a*) in degrees. Higher = warmer (yellow). Lower = cooler (pink).
 */
function determineHueAngle(skinLab) {
  const angle = labHueAngle(skinLab.a, skinLab.b);

  let tendency;
  if (angle > HUE_BASELINE + 5) tendency = 'warm';
  else if (angle < HUE_BASELINE - 5) tendency = 'cool';
  else tendency = 'neutral';

  // Map angle to warm probability (0..1)
  const warmScore = Math.min(1, Math.max(0, (angle - (HUE_BASELINE - 15)) / 30));
  const coolScore = 1 - warmScore;

  return { angle, tendency, warmScore, coolScore };
}

// ─── Scoring ───

/**
 * Score a value against a [min, max] range.
 * 1.0 inside range, decreasing outside with graceful falloff.
 */
function scoreRange(value, min, max) {
  if (value >= min && value <= max) return 1.0;
  const margin = Math.max((max - min) * 0.6, 3);
  if (value < min) return Math.max(0, 1 - (min - value) / margin);
  return Math.max(0, 1 - (value - max) / margin);
}

/**
 * Score how well measurements match a specific color type.
 */
function scoreTypeMatch(typeName, skinL, skinChromaVal, elemChromaVal, hue) {
  const t = COLOR_TYPES[typeName];
  if (!t) return { score: 0, detail: {} };

  const s1 = scoreRange(skinL, t.skinL[0], t.skinL[1]);
  const s2 = scoreRange(skinChromaVal, t.skinC[0], t.skinC[1]);
  const s3 = scoreRange(elemChromaVal, t.elemC[0], t.elemC[1]);

  let hueScore, hueWeight;
  if (t.hue === 'warm') {
    hueScore = hue.warmScore;
    hueWeight = t.pair ? 3 : 1;
  } else if (t.hue === 'cool') {
    hueScore = hue.coolScore;
    hueWeight = t.pair ? 3 : 1;
  } else {
    hueScore = 0.7;
    hueWeight = 0.5;
  }

  const w1 = 3, w2 = 2, w3 = 2;
  const total = (s1 * w1 + s2 * w2 + s3 * w3 + hueScore * hueWeight) / (w1 + w2 + w3 + hueWeight);

  return {
    score: Math.round(total * 100) / 100,
    detail: { skinLScore: s1, skinChromaScore: s2, elemChromaScore: s3, hueScore, hueWeight }
  };
}

// ─── Main Classifier ───

/**
 * Classify personal color type from measurements.
 *
 * @param {Object} m
 * @param {Object} m.skinColor    - { lab: { l, a, b } }  (required)
 * @param {Object} m.hairColor    - { lab: { l, a, b } }  (optional)
 * @param {Object} m.eyeColor     - { lab: { l, a, b } }  (optional)
 * @param {Object} m.eyebrowColor - { lab: { l, a, b } }  (optional)
 * @param {Object} m.contrast     - { skinHair }           (optional, for compatibility)
 * @returns {Object} classification result
 */
function classifyPersonalColor(m) {
  const { skinColor, hairColor, eyeColor, eyebrowColor, contrast } = m;

  if (!skinColor || !skinColor.lab) {
    throw new Error('skinColor.lab is required for classification');
  }

  const skinLab = skinColor.lab;
  const hairLab = hairColor ? hairColor.lab : null;
  const eyeLab = eyeColor ? eyeColor.lab : null;
  const browLab = eyebrowColor ? eyebrowColor.lab : null;

  // Calculate axes
  const axis1 = determineSkinLightness(skinLab);
  const axis2 = determineSkinChroma(skinLab);
  const axis3 = determineElementChroma(hairLab, browLab, eyeLab);
  const hue = determineHueAngle(skinLab);

  // Score all 14 types
  const scores = Object.keys(COLOR_TYPES).map(name => {
    const r = scoreTypeMatch(name, axis1.value, axis2.value, axis3.value, hue);
    return { type: name, ...r };
  });
  scores.sort((a, b) => b.score - a.score);

  // Primary type & season
  const primary = scores[0];
  let season = 'Spring';
  for (const [s, types] of Object.entries(SEASON_MAP)) {
    if (types.includes(primary.type)) { season = s; break; }
  }

  // Alternates
  const alternates = scores.slice(1, 4).map(s => ({ type: s.type, confidence: s.score }));

  // Human-readable characteristic labels (backward-compatible)
  const hueLabel = hue.tendency === 'warm' ? 'Warm' : hue.tendency === 'cool' ? 'Cool' : 'Neutral';
  const valueLabel = axis1.value >= 66 ? 'High' : axis1.value >= 50 ? 'Middle' : 'Low';
  const chromaLabel = axis2.value >= 18 ? 'High' : axis2.value >= 12 ? 'Medium' : 'Low';
  let contrastLabel = 'Middle';
  if (contrast && contrast.skinHair != null) {
    contrastLabel = contrast.skinHair > 200 ? 'High' : contrast.skinHair > 120 ? 'Middle' : 'Low';
  }

  return {
    type: primary.type,
    season,
    confidence: primary.score,
    alternates,
    characteristics: {
      hue: hueLabel,
      hueScore: Math.round(hue.warmScore * 100) / 100,
      value: valueLabel,
      valueScore: Math.round(scoreRange(axis1.value, 60, 80) * 100) / 100,
      chroma: chromaLabel,
      chromaScore: Math.round(scoreRange(axis2.value, 12, 20) * 100) / 100,
      contrast: contrastLabel,
      contrastScore: contrast && contrast.skinHair != null
        ? Math.round(scoreRange(contrast.skinHair, 120, 200) * 100) / 100
        : 0.5
    },
    debug: {
      skinL: Math.round(skinLab.l * 10) / 10,
      skinA: Math.round(skinLab.a * 10) / 10,
      skinB: Math.round(skinLab.b * 10) / 10,
      skinChromaValue: Math.round(axis2.value * 10) / 10,
      skinLightnessLevel: axis1.level,
      skinChromaLevel: axis2.level,
      elemChromaValue: Math.round(axis3.value * 10) / 10,
      elemChromaLevel: axis3.level,
      elemChromaCount: axis3.count,
      hueAngle: Math.round(hue.angle * 10) / 10,
      hueTendency: hue.tendency,
      warmScore: Math.round(hue.warmScore * 100) / 100,
      coolScore: Math.round(hue.coolScore * 100) / 100,
      allScores: scores.slice(0, 5).map(s => ({ type: s.type, score: s.score }))
    }
  };
}

module.exports = {
  classifyPersonalColor,
  determineSkinLightness,
  determineSkinChroma,
  determineElementChroma,
  determineHueAngle,
  scoreRange,
  COLOR_TYPES,
  SEASON_MAP,
  HUE_BASELINE
};
