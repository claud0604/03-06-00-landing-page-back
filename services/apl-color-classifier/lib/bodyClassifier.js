/**
 * Deterministic Body Type Classifier
 * Rules-based 5-type body shape classification
 *
 * Body Types:
 * 1. Straight (스트레이트) — balanced, minimal curves
 * 2. Wave (웨이브) — defined waist, curvy
 * 3. Natural (내추럴) — broad frame, angular
 * 4. Romantic (로맨틱) — soft, rounded curves
 * 5. Dramatic (드라마틱) — elongated, sharp angles
 */

// Reference ranges for each body type
const BODY_REFERENCE = {
  Straight: {
    shoulderHipRatio: [0.95, 1.10],   // shoulders ≈ hips
    waistHipRatio: [0.80, 0.95],      // less defined waist
    torsoLegRatio: [0.90, 1.10],      // balanced proportions
    description: 'Balanced proportions, minimal waist definition, clean straight lines'
  },
  Wave: {
    shoulderHipRatio: [0.85, 1.00],   // hips slightly wider or equal
    waistHipRatio: [0.65, 0.80],      // defined waist
    torsoLegRatio: [0.85, 1.05],      // slightly longer legs
    description: 'Defined waist curve, softer lines, hip emphasis'
  },
  Natural: {
    shoulderHipRatio: [1.00, 1.20],   // broader shoulders
    waistHipRatio: [0.78, 0.92],      // moderate waist
    torsoLegRatio: [0.95, 1.15],      // slightly longer torso
    description: 'Broad frame, angular bone structure, relaxed silhouette'
  },
  Romantic: {
    shoulderHipRatio: [0.88, 1.02],   // rounded shoulders, balanced
    waistHipRatio: [0.62, 0.78],      // very defined waist
    torsoLegRatio: [0.88, 1.08],      // balanced
    description: 'Soft rounded curves, very defined waist, gentle proportions'
  },
  Dramatic: {
    shoulderHipRatio: [1.05, 1.25],   // strong shoulders
    waistHipRatio: [0.75, 0.90],      // moderate waist
    torsoLegRatio: [0.85, 1.00],      // longer legs
    description: 'Elongated frame, sharp angular lines, prominent bone structure'
  }
};

/**
 * Score how well a value fits within [min, max] range
 */
function scoreRange(value, range) {
  const [min, max] = range;
  if (value >= min && value <= max) return 1.0;

  const rangeSize = max - min;
  const margin = rangeSize * 0.7; // 70% margin

  if (value < min) {
    return Math.max(0, 1 - (min - value) / margin);
  } else {
    return Math.max(0, 1 - (value - max) / margin);
  }
}

/**
 * Classify body type from proportions
 * @param {Object} bodyProportions - { shoulderHipRatio, waistHipRatio, torsoLegRatio }
 *   shoulderHipRatio: shoulder width / hip width (0.7-1.3)
 *   waistHipRatio: waist width / hip width (0.5-1.0)
 *   torsoLegRatio: torso length / leg length (0.7-1.3)
 * @returns {Object} - { type, confidence, alternates, proportions }
 */
function classifyBodyType(bodyProportions) {
  if (!bodyProportions) {
    throw new Error('bodyProportions is required');
  }

  const {
    shoulderHipRatio = 1.0,
    waistHipRatio = 0.8,
    torsoLegRatio = 1.0
  } = bodyProportions;

  const scores = [];

  for (const [type, ref] of Object.entries(BODY_REFERENCE)) {
    const shoulderScore = scoreRange(shoulderHipRatio, ref.shoulderHipRatio);
    const waistScore = scoreRange(waistHipRatio, ref.waistHipRatio);
    const torsoScore = scoreRange(torsoLegRatio, ref.torsoLegRatio);

    // Waist-hip ratio is most discriminating for body type
    const totalScore = shoulderScore * 0.30 + waistScore * 0.40 + torsoScore * 0.30;

    scores.push({
      type,
      score: totalScore,
      detail: {
        shoulderScore: Math.round(shoulderScore * 100) / 100,
        waistScore: Math.round(waistScore * 100) / 100,
        torsoScore: Math.round(torsoScore * 100) / 100
      }
    });
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  const primary = scores[0];
  const alternates = scores.slice(1, 3).map(s => ({
    type: s.type,
    confidence: Math.round(s.score * 100) / 100
  }));

  return {
    type: primary.type,
    confidence: Math.round(primary.score * 100) / 100,
    alternates,
    proportions: {
      shoulderHipRatio: Math.round(shoulderHipRatio * 100) / 100,
      waistHipRatio: Math.round(waistHipRatio * 100) / 100,
      torsoLegRatio: Math.round(torsoLegRatio * 100) / 100
    },
    debug: {
      allScores: scores.map(s => ({
        type: s.type,
        score: Math.round(s.score * 100) / 100
      }))
    }
  };
}

module.exports = {
  classifyBodyType,
  BODY_REFERENCE
};
