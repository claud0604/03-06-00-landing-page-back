/**
 * 4-Season Classifier
 *
 * 하이브리드 방식: 웜/쿨 기반 sigmoid + centroid 거리
 * 359건 실제 진단 데이터 그리드 서치 최적화 (2026.03)
 *
 * 최적 정확도: ~44.6% (4계절, 피부 LAB만)
 * 피부 LAB만으로의 이론적 한계:
 *   Spring(L*=62.1, b*=13.4)와 Winter(L*=62.1, b*=13.4) 평균이 거의 동일
 *   → 피부 LAB만으로는 Spring/Winter 구분 불가
 *   → 헤어/눈/입술 추가 시 ~70-80% 예상
 */

const { chroma, sigmoid, round } = require('./labUtils');
const { classifyWarmCool } = require('./warmCoolClassifier');

// ─── 359건 데이터에서 계산된 계절별 centroid (평균 LAB) ───
const SEASON_CENTROIDS = {
  Spring: { l: 62.1, a: 9.4, b: 13.4 },
  Summer: { l: 62.9, a: 9.2, b: 12.1 },
  Autumn: { l: 60.6, a: 9.9, b: 14.9 },
  Winter: { l: 62.1, a: 9.1, b: 13.4 },
};

// centroid 거리 계산 가중치 (a*, b* 차이 강조)
const CENTROID_WEIGHTS = { l: 1.0, a: 1.5, b: 1.5 };

// ─── Warm 내부: Spring vs Autumn sigmoid 기준 ───
const WARM_THRESHOLDS = {
  lightness: { center: 61.3, steepness: 0.5, weight: 0.45 },
  chroma:    { center: 17.3, steepness: 0.6, weight: 0.35 },
  bStar:     { center: 14.2, steepness: 0.5, weight: 0.20 },
};

// ─── Cool 내부: Summer vs Winter sigmoid 기준 ───
const COOL_THRESHOLDS = {
  lightness: { center: 62.5, steepness: 0.4, weight: 0.30 },
  chroma:    { center: 15.8, steepness: 0.5, weight: 0.40 },
  bStar:     { center: 12.8, steepness: 0.5, weight: 0.30 },
};

// 하이브리드 비율 (그리드 서치 최적: W/C 90% + Centroid 10%)
const HYBRID_WC_RATIO = 0.9;
const HYBRID_CENTROID_RATIO = 0.1;

/**
 * Spring 점수 (Warm 내부)
 * Spring = 밝고(L* 높) + 채도 낮고 + b* 낮음
 */
function springScore(skin) {
  const th = WARM_THRESHOLDS;
  const lightnessS = sigmoid(skin.l, th.lightness.center, th.lightness.steepness);
  const chromaS = 1 - sigmoid(chroma(skin.a, skin.b), th.chroma.center, th.chroma.steepness);
  const bStarS = 1 - sigmoid(skin.b, th.bStar.center, th.bStar.steepness);

  return (
    lightnessS * th.lightness.weight +
    chromaS * th.chroma.weight +
    bStarS * th.bStar.weight
  );
}

function autumnScore(skin) {
  return 1 - springScore(skin);
}

/**
 * Summer 점수 (Cool 내부)
 * Summer = 밝고(L* 높) + 채도 낮고 + b* 낮음
 */
function summerScore(skin) {
  const th = COOL_THRESHOLDS;
  const lightnessS = sigmoid(skin.l, th.lightness.center, th.lightness.steepness);
  const chromaS = 1 - sigmoid(chroma(skin.a, skin.b), th.chroma.center, th.chroma.steepness);
  const bStarS = 1 - sigmoid(skin.b, th.bStar.center, th.bStar.steepness);

  return (
    lightnessS * th.lightness.weight +
    chromaS * th.chroma.weight +
    bStarS * th.bStar.weight
  );
}

function winterScore(skin) {
  return 1 - summerScore(skin);
}

/**
 * Centroid 기반 점수 (역거리 가중)
 */
function centroidScores(skin) {
  const scores = {};
  for (const [season, centroid] of Object.entries(SEASON_CENTROIDS)) {
    const dL = (skin.l - centroid.l) * CENTROID_WEIGHTS.l;
    const dA = (skin.a - centroid.a) * CENTROID_WEIGHTS.a;
    const dB = (skin.b - centroid.b) * CENTROID_WEIGHTS.b;
    const dist = Math.sqrt(dL * dL + dA * dA + dB * dB);
    scores[season] = 1 / (1 + dist);
  }

  // 정규화
  const total = Object.values(scores).reduce((s, v) => s + v, 0);
  for (const season of Object.keys(scores)) {
    scores[season] /= total;
  }
  return scores;
}

/**
 * 4계절 분류 (하이브리드)
 *
 * @param {Object} skin - { l, a, b } 피부 LAB 값
 * @param {Object} [extra] - 미래 확장용 (hair, eye, lip, neck)
 * @returns {Object} {
 *   primary: 'Spring' | 'Summer' | 'Autumn' | 'Winter',
 *   scores: { Spring, Summer, Autumn, Winter } (합 = 1.0),
 *   warmCool: warmCoolClassifier 결과,
 *   confidence: 'high' | 'medium' | 'low',
 *   reliability: number
 * }
 */
function classifySeason(skin, extra) {
  // 1단계: 웜/쿨 판정
  const warmCool = classifyWarmCool(skin, extra);

  if (warmCool.score === 0.5 && warmCool.tendency === 'Neutral') {
    return {
      primary: null,
      scores: { Spring: 0.25, Summer: 0.25, Autumn: 0.25, Winter: 0.25 },
      warmCool,
      confidence: 'low',
      reliability: 0,
    };
  }

  const warmProb = warmCool.score;
  const coolProb = 1 - warmProb;

  // 2단계: Sigmoid 기반 점수 (기존 2단계 방식)
  const sprS = springScore(skin);
  const autS = autumnScore(skin);
  const sumS = summerScore(skin);
  const winS = winterScore(skin);

  const sigmoidRaw = {
    Spring: warmProb * sprS,
    Autumn: warmProb * autS,
    Summer: coolProb * sumS,
    Winter: coolProb * winS,
  };

  // sigmoid 정규화
  const sigTotal = Object.values(sigmoidRaw).reduce((s, v) => s + v, 0);
  const sigmoidNorm = {};
  for (const [season, score] of Object.entries(sigmoidRaw)) {
    sigmoidNorm[season] = sigTotal > 0 ? score / sigTotal : 0.25;
  }

  // 3단계: Centroid 기반 점수
  const centroid = centroidScores(skin);

  // 4단계: 하이브리드 블렌딩 (90% sigmoid + 10% centroid)
  const scores = {};
  for (const season of ['Spring', 'Summer', 'Autumn', 'Winter']) {
    scores[season] = round(
      sigmoidNorm[season] * HYBRID_WC_RATIO + centroid[season] * HYBRID_CENTROID_RATIO,
      3
    );
  }

  // 재정규화 (합 = 1.0)
  const finalTotal = Object.values(scores).reduce((s, v) => s + v, 0);
  for (const season of Object.keys(scores)) {
    scores[season] = round(scores[season] / finalTotal, 3);
  }

  // 1위 계절
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primary = sorted[0][0];
  const topScore = sorted[0][1];
  const secondScore = sorted[1][1];
  const gap = topScore - secondScore;

  // 신뢰도
  let confidence;
  if (gap >= 0.12 && warmCool.confidence !== 'low') confidence = 'high';
  else if (gap >= 0.05) confidence = 'medium';
  else confidence = 'low';

  // 데이터 소스 기반 예상 정확도
  const sourceCount = warmCool.dataSource.length;
  let reliability;
  if (sourceCount >= 4) reliability = 0.75;
  else if (sourceCount >= 2) reliability = 0.60;
  else reliability = 0.45;  // 피부만으로는 ~44.6%

  return {
    primary,
    scores,
    warmCool,
    confidence,
    reliability,
  };
}

module.exports = { classifySeason };
