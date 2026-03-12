/**
 * APL Color Classifier
 *
 * 피부 LAB 값으로 웜/쿨 + 4계절 경향성을 판정하는 순수 JS 모듈
 * 외부 의존성 없음 — 어디서든 require()로 사용 가능
 *
 * 사용법:
 *   const { classify } = require('./97-color-classifier');
 *   const result = classify({ l: 62.0, a: 9.1, b: 13.5 });
 *
 * 출력:
 *   {
 *     warmCool: { tendency: 'Warm', score: 0.72, confidence: 'medium', ... },
 *     season:   { primary: 'Spring', scores: { Spring: 0.35, ... }, ... },
 *   }
 */

const { classifyWarmCool } = require('./lib/warmCoolClassifier');
const { classifySeason } = require('./lib/seasonClassifier');
const labUtils = require('./lib/labUtils');

/**
 * 통합 분류 함수
 *
 * @param {Object} skin - { l, a, b } 피부 평균 LAB 값
 * @param {Object} [extra] - 추가 부위 LAB (미래 확장)
 *   - hair: { l, a, b }
 *   - eye:  { l, a, b }
 *   - lip:  { l, a, b }
 *   - neck: { l, a, b }
 * @returns {Object} { warmCool, season }
 */
function classify(skin, extra) {
  const season = classifySeason(skin, extra);

  return {
    warmCool: season.warmCool,
    season: {
      primary: season.primary,
      scores: season.scores,
      confidence: season.confidence,
      reliability: season.reliability,
    },
  };
}

module.exports = {
  classify,
  classifyWarmCool,
  classifySeason,
  labUtils,
};
