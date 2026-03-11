/**
 * Deterministic Face Shape Classifier
 * Rules-based 7-type face shape classification
 *
 * Face Types:
 * 1. Oval (타원형)
 * 2. Round (둥근형)
 * 3. Square (사각형)
 * 4. Oblong (긴형)
 * 5. Heart (하트형)
 * 6. Diamond (다이아몬드형)
 * 7. Inverted Triangle (역삼각형)
 */

// Reference ranges for each face shape
const FACE_REFERENCE = {
  Oval: {
    heightRatio: [1.3, 1.5],
    foreheadRatio: [0.85, 0.95],
    jawRatio: [0.75, 0.85],
    description: 'Balanced proportions, slightly longer than wide, gentle jaw curve'
  },
  Round: {
    heightRatio: [1.0, 1.3],
    foreheadRatio: [0.85, 1.0],
    jawRatio: [0.85, 1.0],
    description: 'Nearly equal width and height, soft rounded jaw'
  },
  Square: {
    heightRatio: [1.0, 1.3],
    foreheadRatio: [0.90, 1.05],
    jawRatio: [0.90, 1.05],
    description: 'Strong angular jaw, forehead and jaw similar width'
  },
  Oblong: {
    heightRatio: [1.5, 2.0],
    foreheadRatio: [0.80, 0.95],
    jawRatio: [0.75, 0.90],
    description: 'Noticeably longer than wide, balanced forehead and jaw'
  },
  Heart: {
    heightRatio: [1.2, 1.6],
    foreheadRatio: [0.95, 1.15],
    jawRatio: [0.60, 0.75],
    description: 'Wide forehead, narrow pointed chin'
  },
  Diamond: {
    heightRatio: [1.2, 1.6],
    foreheadRatio: [0.70, 0.85],
    jawRatio: [0.65, 0.80],
    description: 'Narrow forehead and jaw, widest at cheekbones'
  },
  'Inverted Triangle': {
    heightRatio: [1.1, 1.5],
    foreheadRatio: [1.0, 1.2],
    jawRatio: [0.60, 0.78],
    description: 'Very wide forehead, very narrow jaw'
  }
};

/**
 * Score how well proportions fit a face shape reference range
 * @param {number} value - Measured value
 * @param {number[]} range - [min, max] reference range
 * @returns {number} 0-1 score
 */
function scoreRange(value, range) {
  const [min, max] = range;
  if (value >= min && value <= max) return 1.0;

  const rangeSize = max - min;
  const margin = rangeSize * 0.6; // 60% margin outside range

  if (value < min) {
    const distance = min - value;
    return Math.max(0, 1 - distance / margin);
  } else {
    const distance = value - max;
    return Math.max(0, 1 - distance / margin);
  }
}

/**
 * Classify face shape from proportions
 * @param {Object} faceProportions - { foreheadRatio, jawRatio, heightRatio, cheekboneWidth?, jawAngle? }
 *   foreheadRatio: forehead width / face max width (0.6-1.2)
 *   jawRatio: jaw width / face max width (0.5-1.1)
 *   heightRatio: face height / face width (0.9-2.0)
 * @returns {Object} - { type, confidence, alternates, proportions }
 */
function classifyFaceShape(faceProportions) {
  if (!faceProportions) {
    throw new Error('faceProportions is required');
  }

  const {
    foreheadRatio = 0.9,
    jawRatio = 0.8,
    heightRatio = 1.35
  } = faceProportions;

  // Score each face type
  const scores = [];

  for (const [type, ref] of Object.entries(FACE_REFERENCE)) {
    const heightScore = scoreRange(heightRatio, ref.heightRatio);
    const foreheadScore = scoreRange(foreheadRatio, ref.foreheadRatio);
    const jawScore = scoreRange(jawRatio, ref.jawRatio);

    // Height ratio is most discriminating, then jaw, then forehead
    const totalScore = heightScore * 0.35 + jawScore * 0.35 + foreheadScore * 0.30;

    scores.push({
      type,
      score: totalScore,
      detail: {
        heightScore: Math.round(heightScore * 100) / 100,
        foreheadScore: Math.round(foreheadScore * 100) / 100,
        jawScore: Math.round(jawScore * 100) / 100
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

  // Apply Square vs Round disambiguation
  // Both have similar height ratios but jaw shape differs
  if (primary.type === 'Square' || primary.type === 'Round') {
    const jawAngle = faceProportions.jawAngle;
    if (jawAngle != null) {
      // Sharp jaw angle (< 125°) favors Square
      // Soft jaw angle (> 140°) favors Round
      if (jawAngle < 125 && primary.type === 'Round') {
        // Swap if jaw is actually angular
        const squareIdx = scores.findIndex(s => s.type === 'Square');
        if (squareIdx > 0 && scores[squareIdx].score > 0.5) {
          scores[0] = scores[squareIdx];
          scores[squareIdx] = primary;
        }
      }
    }
  }

  // Apply Heart vs Inverted Triangle disambiguation
  if (primary.type === 'Heart' || primary.type === 'Inverted Triangle') {
    // Heart has a more gradual taper; Inverted Triangle is more extreme
    const ratio = foreheadRatio / jawRatio;
    if (ratio > 1.6 && primary.type === 'Heart') {
      const invIdx = scores.findIndex(s => s.type === 'Inverted Triangle');
      if (invIdx > 0) {
        scores[0] = scores[invIdx];
        scores[invIdx] = primary;
      }
    }
  }

  const finalPrimary = scores[0];

  return {
    type: finalPrimary.type,
    confidence: Math.round(finalPrimary.score * 100) / 100,
    alternates,
    proportions: {
      foreheadRatio: Math.round(foreheadRatio * 100) / 100,
      jawRatio: Math.round(jawRatio * 100) / 100,
      heightRatio: Math.round(heightRatio * 100) / 100
    },
    debug: {
      allScores: scores.slice(0, 5).map(s => ({
        type: s.type,
        score: Math.round(s.score * 100) / 100
      }))
    }
  };
}

module.exports = {
  classifyFaceShape,
  FACE_REFERENCE
};
