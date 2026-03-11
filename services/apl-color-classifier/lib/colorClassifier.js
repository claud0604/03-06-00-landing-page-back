/**
 * Deterministic Personal Color Classifier
 * LAB-based 14-type classification engine
 */

const referenceData = require('../data/colorReferenceData.json');
const { labChroma } = require('./labUtils');

// Season groups and their subtypes
const SEASON_MAP = {
  Spring: ['Spring Light', 'Spring Bright', 'Spring Soft', 'Spring Clear'],
  Summer: ['Summer Light', 'Summer Bright', 'Summer Mute'],
  Autumn: ['Autumn Mute', 'Autumn Deep', 'Autumn Strong'],
  Winter: ['Winter Clear', 'Winter Strong', 'Winter Deep', 'Winter Soft']
};

/**
 * Determine warm/cool undertone from skin LAB values
 * a* > 5 AND b* > 15 → Warm
 * a* < 5 AND b* < 10 → Cool
 * Between → Neutral (lean based on weighted score)
 */
function determineUndertone(skinLab) {
  const { a, b } = skinLab;

  // Warm score: higher a* and b* = more warm
  const warmScore = (Math.max(0, a) / 20) * 0.4 + (Math.max(0, b) / 30) * 0.6;
  // Cool score: lower a* and b* = more cool
  const coolScore = (Math.max(0, 10 - a) / 10) * 0.4 + (Math.max(0, 15 - b) / 15) * 0.6;

  if (a > 5 && b > 15) {
    return { type: 'Warm', score: Math.min(1, warmScore), warmScore, coolScore };
  }
  if (a < 5 && b < 10) {
    return { type: 'Cool', score: Math.min(1, coolScore), warmScore, coolScore };
  }

  // Neutral zone
  if (warmScore > coolScore) {
    return { type: 'Warm-Neutral', score: Math.min(1, warmScore), warmScore, coolScore };
  }
  return { type: 'Cool-Neutral', score: Math.min(1, coolScore), warmScore, coolScore };
}

/**
 * Determine value (brightness) level
 * Based on skin L* primarily, with hair and eye as secondary
 */
function determineValue(skinLab, hairLab, eyeLab) {
  const skinL = skinLab.l;

  // Primary classification from skin lightness
  let level, score;
  if (skinL > 70) {
    level = 'High';
    score = Math.min(1, (skinL - 70) / 15);
  } else if (skinL > 55) {
    level = 'Middle';
    // Distance from center of middle range (62.5)
    score = 1 - Math.abs(skinL - 62.5) / 7.5;
  } else {
    level = 'Low';
    score = Math.min(1, (55 - skinL) / 15);
  }

  return { level, score, skinL };
}

/**
 * Determine chroma (saturation) level
 * Chroma = sqrt(a*² + b*²) distance from neutral gray
 */
function determineChroma(skinLab) {
  const chromaValue = labChroma(skinLab.a, skinLab.b);

  let level, score;
  if (chromaValue > 20) {
    level = 'High';
    score = Math.min(1, (chromaValue - 20) / 15);
  } else if (chromaValue > 12) {
    level = 'Medium';
    score = 1 - Math.abs(chromaValue - 16) / 4;
  } else {
    level = 'Low';
    score = Math.min(1, (12 - chromaValue) / 8);
  }

  return { level, score, chromaValue };
}

/**
 * Determine contrast level from RGB distances
 */
function determineContrast(contrast) {
  if (!contrast || contrast.skinHair == null) {
    return { level: 'Middle', score: 0.5, value: 0 };
  }

  const val = contrast.skinHair;

  let level, score;
  if (val > 200) {
    level = 'High';
    score = Math.min(1, (val - 200) / 130);
  } else if (val > 120) {
    level = 'Middle';
    score = 1 - Math.abs(val - 160) / 40;
  } else {
    level = 'Low';
    score = Math.min(1, (120 - val) / 60);
  }

  return { level, score, value: val };
}

/**
 * Map characteristics to season group
 */
function mapToSeason(undertone, value, chroma) {
  const isWarm = undertone.type.startsWith('Warm');

  if (isWarm) {
    // Warm + High brightness or High chroma → Spring
    // Warm + Low brightness or Low chroma → Autumn
    if (value.level === 'High' || (value.level === 'Middle' && chroma.level === 'High')) {
      return 'Spring';
    }
    return 'Autumn';
  } else {
    // Cool + High brightness or Low chroma → Summer
    // Cool + High chroma or Low brightness → Winter
    if (value.level === 'High' || (value.level === 'Middle' && chroma.level === 'Low')) {
      return 'Summer';
    }
    return 'Winter';
  }
}

/**
 * Score how well measurements fit a specific color type
 * Returns 0-1 score (1 = perfect match)
 */
function scoreTypeMatch(typeName, skinLab, hairLab, eyeLab, contrast) {
  const ref = referenceData[typeName];
  if (!ref) return 0;

  let totalScore = 0;
  let totalWeight = 0;

  // Skin LAB match (weight: 5)
  const skinScore = scoreLabRange(skinLab, ref.skinLab);
  totalScore += skinScore * 5;
  totalWeight += 5;

  // Hair LAB match (weight: 2)
  if (hairLab && ref.hairLab) {
    const hairScore = scoreLabRange(hairLab, ref.hairLab);
    totalScore += hairScore * 2;
    totalWeight += 2;
  }

  // Eye LAB match (weight: 1)
  if (eyeLab && ref.eyeLab) {
    const eyeScore = scoreLabRange(eyeLab, ref.eyeLab);
    totalScore += eyeScore * 1;
    totalWeight += 1;
  }

  // Contrast match (weight: 2)
  if (contrast && contrast.skinHair != null && ref.contrast && ref.contrast.skinHair) {
    const contrastScore = scoreRange(contrast.skinHair, ref.contrast.skinHair[0], ref.contrast.skinHair[1]);
    totalScore += contrastScore * 2;
    totalWeight += 2;
  }

  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

/**
 * Score how well a LAB value fits within a reference range
 */
function scoreLabRange(lab, refRange) {
  const lScore = scoreRange(lab.l, refRange.l[0], refRange.l[1]);
  const aScore = scoreRange(lab.a, refRange.a[0], refRange.a[1]);
  const bScore = scoreRange(lab.b, refRange.b[0], refRange.b[1]);

  // L* is most important for classification
  return lScore * 0.5 + aScore * 0.25 + bScore * 0.25;
}

/**
 * Score how well a value fits within [min, max] range
 * Returns 1.0 if within range, decreases as distance increases
 */
function scoreRange(value, min, max) {
  if (value >= min && value <= max) return 1.0;

  const range = max - min;
  const margin = range * 0.5; // Allow 50% margin outside range

  if (value < min) {
    const distance = min - value;
    return Math.max(0, 1 - distance / margin);
  } else {
    const distance = value - max;
    return Math.max(0, 1 - distance / margin);
  }
}

/**
 * Main classification function
 * @param {Object} measurements - { skinColor: {lab}, hairColor: {lab}, eyeColor: {lab}, contrast: {skinHair, skinEye} }
 * @returns {Object} - { type, season, confidence, alternates, characteristics }
 */
function classifyPersonalColor(measurements) {
  const { skinColor, hairColor, eyeColor, contrast } = measurements;

  if (!skinColor || !skinColor.lab) {
    throw new Error('skinColor.lab is required for classification');
  }

  const skinLab = skinColor.lab;
  const hairLab = hairColor ? hairColor.lab : null;
  const eyeLab = eyeColor ? eyeColor.lab : null;

  // Step 1: Determine characteristics
  const undertone = determineUndertone(skinLab);
  const value = determineValue(skinLab, hairLab, eyeLab);
  const chroma = determineChroma(skinLab);
  const contrastLevel = determineContrast(contrast);

  // Step 2: Map to season
  const season = mapToSeason(undertone, value, chroma);

  // Step 3: Score all 14 types (not just the primary season)
  const allScores = [];
  for (const typeName in referenceData) {
    const score = scoreTypeMatch(typeName, skinLab, hairLab, eyeLab, contrast);
    allScores.push({ type: typeName, score });
  }

  // Sort by score descending
  allScores.sort((a, b) => b.score - a.score);

  // Step 4: Primary type and alternates
  const primaryType = allScores[0];
  const alternates = allScores.slice(1, 4).map(s => ({
    type: s.type,
    confidence: Math.round(s.score * 100) / 100
  }));

  // Determine actual season from primary type
  let actualSeason = season;
  for (const [s, types] of Object.entries(SEASON_MAP)) {
    if (types.includes(primaryType.type)) {
      actualSeason = s;
      break;
    }
  }

  return {
    type: primaryType.type,
    season: actualSeason,
    confidence: Math.round(primaryType.score * 100) / 100,
    alternates,
    characteristics: {
      hue: undertone.type,
      hueScore: Math.round(undertone.score * 100) / 100,
      value: value.level,
      valueScore: Math.round(value.score * 100) / 100,
      chroma: chroma.level,
      chromaScore: Math.round(chroma.score * 100) / 100,
      contrast: contrastLevel.level,
      contrastScore: Math.round(contrastLevel.score * 100) / 100
    },
    debug: {
      skinL: skinLab.l,
      skinA: skinLab.a,
      skinB: skinLab.b,
      chromaValue: Math.round(chroma.chromaValue * 10) / 10,
      contrastValue: contrastLevel.value,
      warmScore: Math.round(undertone.warmScore * 100) / 100,
      coolScore: Math.round(undertone.coolScore * 100) / 100,
      ruleSeason: season,
      allScores: allScores.slice(0, 5).map(s => ({
        type: s.type,
        score: Math.round(s.score * 100) / 100
      }))
    }
  };
}

module.exports = {
  classifyPersonalColor,
  determineUndertone,
  determineValue,
  determineChroma,
  determineContrast,
  mapToSeason,
  SEASON_MAP
};
