/**
 * LAB Color Utilities
 *
 * Chroma, Hue Angle, sigmoid scoring 등
 * 외부 의존성 없음 — 순수 JavaScript
 */

/**
 * Chroma (채도) = √(a² + b²)
 * LAB 색공간에서 뉴트럴 그레이로부터의 거리
 */
function chroma(a, b) {
  return Math.sqrt(a * a + b * b);
}

/**
 * Hue Angle (색상각) = atan2(b, a) in degrees [0, 360)
 * 피부색 범위: 보통 30°~70° (주황~노랑 계열)
 */
function hueAngle(a, b) {
  let angle = Math.atan2(b, a) * (180 / Math.PI);
  if (angle < 0) angle += 360;
  return angle;
}

/**
 * Sigmoid 함수 — 값을 0~1 범위로 부드럽게 변환
 *
 * @param {number} x - 입력값
 * @param {number} center - 중심점 (0.5를 반환하는 지점)
 * @param {number} steepness - 기울기 (클수록 급격한 전환, 보통 0.3~1.0)
 * @returns {number} 0~1
 */
function sigmoid(x, center, steepness) {
  return 1 / (1 + Math.exp(-(x - center) * steepness));
}

/**
 * 값을 min~max 범위에서 0~1로 선형 정규화
 * 범위 밖이면 0 또는 1로 클램프
 */
function normalize(value, min, max) {
  if (max === min) return 0.5;
  const result = (value - min) / (max - min);
  return Math.max(0, Math.min(1, result));
}

/**
 * 소수점 자릿수 반올림
 */
function round(value, decimals) {
  if (decimals === undefined) decimals = 2;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

module.exports = {
  chroma,
  hueAngle,
  sigmoid,
  normalize,
  round,
};
