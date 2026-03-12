/**
 * Warm/Cool Classifier
 *
 * 피부 LAB 값으로 웜/쿨 경향 점수를 산출
 * 357건 실제 진단 데이터 분석 기반 (2026.03)
 *
 * 분석 결과 (8 core types, 248건):
 *   Chroma >= 17  → 70.2% 정확도 (Warm이 높음)
 *   b* >= 15      → 68.5% 정확도 (Warm이 높음)
 *   R-B >= 48     → 69.8% 정확도 (HSL 기반)
 *
 * 현재 데이터(피부 LAB만)로 기대 정확도: ~70-75%
 * 헤어/눈/입술 추가 시: ~85-90% 예상
 */

const { chroma, hueAngle, sigmoid, round } = require('./labUtils');

// ─── 분석에서 도출된 기준값 ───
// 8타입 248건 데이터 기반
// 그리드 서치 최적화 결과 (359건, 2026.03)
// 최적 정확도: 69.1% (248/359) — 100% 커버리지
const THRESHOLDS = {
  // Warm Chroma avg=17.3 vs Cool avg=15.8 → 최적 center=16
  chroma: { center: 16.0, steepness: 1.0, weight: 0.40 },

  // Warm b* avg=14.2 vs Cool b* avg=12.8 → 최적 center=14
  bStar: { center: 14.0, steepness: 1.0, weight: 0.35 },

  // Warm a* avg=9.6 vs Cool a* avg=9.1 → 최적 center=10
  // a* steepness는 chroma/b* 대비 60%로 약화 (분리력 약함)
  aStar: { center: 10.0, steepness: 0.6, weight: 0.25 },
};

/**
 * 웜/쿨 경향 판정
 *
 * @param {Object} skin - { l, a, b } 피부 LAB 값
 * @param {Object} [extra] - 미래 확장용 (hair, eye, lip, neck)
 * @returns {Object} {
 *   tendency: 'Warm' | 'Neutral Warm' | 'Neutral' | 'Neutral Cool' | 'Cool',
 *   score: 0~1 (1에 가까울수록 Warm),
 *   confidence: 'high' | 'medium' | 'low',
 *   detail: { chromaScore, bStarScore, aStarScore },
 *   dataSource: string[]
 * }
 */
function classifyWarmCool(skin, extra) {
  if (!skin || skin.l == null || skin.a == null || skin.b == null) {
    return {
      tendency: 'Neutral',
      score: 0.5,
      confidence: 'low',
      detail: {},
      dataSource: [],
    };
  }

  const skinChroma = chroma(skin.a, skin.b);
  const dataSources = ['skin'];

  // ─── 각 지표별 Warm 점수 (0~1, 1=Warm) ───
  const chromaScore = sigmoid(skinChroma, THRESHOLDS.chroma.center, THRESHOLDS.chroma.steepness);
  const bStarScore = sigmoid(skin.b, THRESHOLDS.bStar.center, THRESHOLDS.bStar.steepness);
  const aStarScore = sigmoid(skin.a, THRESHOLDS.aStar.center, THRESHOLDS.aStar.steepness);

  // ─── 가중 평균 ───
  let totalWeight = THRESHOLDS.chroma.weight + THRESHOLDS.bStar.weight + THRESHOLDS.aStar.weight;
  let warmScore = (
    chromaScore * THRESHOLDS.chroma.weight +
    bStarScore * THRESHOLDS.bStar.weight +
    aStarScore * THRESHOLDS.aStar.weight
  ) / totalWeight;

  // ─── 미래 확장: 추가 데이터가 있으면 정확도 향상 ───
  if (extra) {
    if (extra.hair && extra.hair.l != null) {
      // 피부↔헤어 대비: 대비 클수록 겨울(Cool) 경향
      const skinHairContrast = Math.abs(skin.l - extra.hair.l);
      const hairScore = 1 - sigmoid(skinHairContrast, 40, 0.05);
      warmScore = (warmScore * totalWeight + hairScore * 0.15) / (totalWeight + 0.15);
      totalWeight += 0.15;
      dataSources.push('hair');
    }
    if (extra.eye && extra.eye.b != null) {
      // 눈 b*: 양수(노란) = Warm, 음수(파란) = Cool
      const eyeScore = sigmoid(extra.eye.b, 0, 0.2);
      warmScore = (warmScore * totalWeight + eyeScore * 0.15) / (totalWeight + 0.15);
      totalWeight += 0.15;
      dataSources.push('eye');
    }
    if (extra.lip && extra.lip.a != null) {
      // 입술 a*: 높으면(붉은) = Warm 경향
      const lipScore = sigmoid(extra.lip.a, 15, 0.1);
      warmScore = (warmScore * totalWeight + lipScore * 0.10) / (totalWeight + 0.10);
      totalWeight += 0.10;
      dataSources.push('lip');
    }
  }

  // ─── 5단계 결과 결정 ───
  // Warm → Neutral Warm → Neutral → Neutral Cool → Cool
  let tendency;
  if (warmScore >= 0.65) tendency = 'Warm';
  else if (warmScore >= 0.55) tendency = 'Neutral Warm';
  else if (warmScore >= 0.45) tendency = 'Neutral';
  else if (warmScore >= 0.35) tendency = 'Neutral Cool';
  else tendency = 'Cool';

  // 신뢰도: 0.5에서의 거리
  const distance = Math.abs(warmScore - 0.5);
  let confidence;
  if (distance >= 0.15) confidence = 'high';
  else if (distance >= 0.05) confidence = 'medium';
  else confidence = 'low';

  return {
    tendency,
    score: round(warmScore, 3),
    confidence,
    detail: {
      chromaScore: round(chromaScore, 3),
      bStarScore: round(bStarScore, 3),
      aStarScore: round(aStarScore, 3),
      skinChroma: round(skinChroma, 1),
      skinHueAngle: round(hueAngle(skin.a, skin.b), 1),
    },
    dataSource: dataSources,
  };
}

module.exports = { classifyWarmCool };
