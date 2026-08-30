// 로또 번호 생성 필터 체인(App.tsx / compute-numbers)의 통과율을 정확히 계산하는 개발용 도구.
//
// 몬테카를로 시뮬레이션 대신 C(45,6) = 8,145,060개 전체 조합을 완전 열거해서
// 각 필터가 얼마나 많은 조합을 걸러내는지 오차 없이 계산한다. 이 정도 크기의
// 탐색 공간은 근사(몬테카를로)보다 완전 열거가 더 정확하고 더 빠르다.
//
// 실행: node scripts/analyze-filters.mjs
//
// 필터/가중치를 조정할 때마다 이 스크립트를 다시 돌려서 "합계범위를 좁히면
// 통과율이 얼마나 떨어지는지" 같은 트레이드오프를 실제 수치로 검증한다.
// 런타임(브라우저/엣지 함수)에는 포함하지 않는다 - 810만 개 전수 열거는
// 요청마다 돌릴 연산이 아니라 오프라인 튜닝/검증용이다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(__dirname, '..', 'public', 'lotto_results.csv');

const content = readFileSync(csvPath, 'utf-8');
const lines = content.split(/\r?\n/).filter(Boolean);
const rows = lines.slice(1).map((l) => l.split(',').map(Number));

// --- App.tsx와 동일한 통계 계산 ---
let totalSum = 0;
const freq = new Array(46).fill(0);
rows.forEach((r) => {
    const nums = r.slice(1, 7);
    totalSum += nums.reduce((a, b) => a + b, 0);
    nums.forEach((n) => freq[n]++);
});
const avgSum = totalSum / rows.length;

console.log(`데이터: ${rows.length}회, 평균 합계: ${avgSum.toFixed(2)}`);

// --- 과거 당첨과 5개 이상 일치하는 "문제 조합" 집합을 정확히 계산 ---
const draws = rows.map((r) => r.slice(1, 7));
const problemSet = new Set();
const key = (arr) => arr.slice().sort((a, b) => a - b).join(',');

for (const h of draws) {
    problemSet.add(key(h)); // 6/6 일치 (완전 재현)
    const hSet = new Set(h);
    const others = [];
    for (let i = 1; i <= 45; i++) if (!hSet.has(i)) others.push(i);
    for (let removeIdx = 0; removeIdx < 6; removeIdx++) {
        const base = h.filter((_, idx) => idx !== removeIdx);
        for (const add of others) problemSet.add(key([...base, add]));
    }
}

const TOTAL_COMBOS = 8145060;
const f8PassRate = 1 - problemSet.size / TOTAL_COMBOS;

// --- C(45,6) 전체 조합 전수 열거 ---
const RANGES = [5, 10, 20, 30, 40];
const counters = {
    sumRange: RANGES.map(() => 0),
    consecutive: 0,
    birthdayOrig: 0,     // 전부 <=31이면 차단 (구버전 기준, 참고용)
    birthdayImproved: 0, // 5개 이상 <=31이면 차단 (현재 적용된 기준)
    oddEven: 0,
    endDigit: 0,
    combined: RANGES.map(() => 0), // 합계범위 + 나머지 필터(생일 강화 기준) 전부 통과
    exactMax: RANGES.map(() => 0), // combined + f8까지 정확히 반영한 최종 최대 생성 가능 개수
};

const endDigitCount = new Array(10);

for (let i1 = 1; i1 <= 40; i1++) {
for (let i2 = i1 + 1; i2 <= 41; i2++) {
for (let i3 = i2 + 1; i3 <= 42; i3++) {
for (let i4 = i3 + 1; i4 <= 43; i4++) {
for (let i5 = i4 + 1; i5 <= 44; i5++) {
for (let i6 = i5 + 1; i6 <= 45; i6++) {
    const sum = i1 + i2 + i3 + i4 + i5 + i6;

    let maxCons = 1, cur = 1;
    if (i2 === i1 + 1) cur++; else cur = 1; if (cur > maxCons) maxCons = cur;
    if (i3 === i2 + 1) cur++; else cur = 1; if (cur > maxCons) maxCons = cur;
    if (i4 === i3 + 1) cur++; else cur = 1; if (cur > maxCons) maxCons = cur;
    if (i5 === i4 + 1) cur++; else cur = 1; if (cur > maxCons) maxCons = cur;
    if (i6 === i5 + 1) cur++; else cur = 1; if (cur > maxCons) maxCons = cur;
    const consOk = maxCons < 4;

    let leCount = 0;
    if (i1 <= 31) leCount++;
    if (i2 <= 31) leCount++;
    if (i3 <= 31) leCount++;
    if (i4 <= 31) leCount++;
    if (i5 <= 31) leCount++;
    if (i6 <= 31) leCount++;
    const birthdayOkOrig = leCount < 6;
    const birthdayOkImproved = leCount < 5;

    let oddCount = 0;
    if (i1 % 2) oddCount++;
    if (i2 % 2) oddCount++;
    if (i3 % 2) oddCount++;
    if (i4 % 2) oddCount++;
    if (i5 % 2) oddCount++;
    if (i6 % 2) oddCount++;
    const oddOk = oddCount >= 2 && oddCount <= 4;

    endDigitCount[0]=0;endDigitCount[1]=0;endDigitCount[2]=0;endDigitCount[3]=0;endDigitCount[4]=0;
    endDigitCount[5]=0;endDigitCount[6]=0;endDigitCount[7]=0;endDigitCount[8]=0;endDigitCount[9]=0;
    endDigitCount[i1 % 10]++; endDigitCount[i2 % 10]++; endDigitCount[i3 % 10]++;
    endDigitCount[i4 % 10]++; endDigitCount[i5 % 10]++; endDigitCount[i6 % 10]++;
    let maxEnd = 0;
    for (let d = 0; d < 10; d++) if (endDigitCount[d] > maxEnd) maxEnd = endDigitCount[d];
    const endOk = maxEnd < 4;

    if (consOk) counters.consecutive++;
    if (birthdayOkOrig) counters.birthdayOrig++;
    if (birthdayOkImproved) counters.birthdayImproved++;
    if (oddOk) counters.oddEven++;
    if (endOk) counters.endDigit++;

    const restOk = consOk && birthdayOkImproved && oddOk && endOk;
    // f8(과거 5개+ 일치)까지 정확히 반영 - 근사가 아니라 problemSet 직접 조회
    const passesF8 = !problemSet.has(`${i1},${i2},${i3},${i4},${i5},${i6}`);
    const exactOk = restOk && passesF8;

    for (let r = 0; r < RANGES.length; r++) {
        const range = RANGES[r];
        const inRange = sum >= (avgSum - range) && sum <= (avgSum + range);
        if (inRange) {
            counters.sumRange[r]++;
            if (restOk) counters.combined[r]++;
            if (exactOk) counters.exactMax[r]++;
        }
    }
}}}}}}

const pct = (n) => `${((n / TOTAL_COMBOS) * 100).toFixed(2)}%`;

console.log('\n--- 필터 단독 통과율 (전체 8,145,060개 조합 기준) ---');
console.log('연속번호 4개+ 차단  :', pct(counters.consecutive));
console.log('생일조합(전부<=31)  :', pct(counters.birthdayOrig), '(구버전, 참고용)');
console.log('생일조합(5개+<=31)  :', pct(counters.birthdayImproved), '(현재 적용)');
console.log('홀짝 비율(2:4~4:2)  :', pct(counters.oddEven));
console.log('동일 끝자리 4개+ 차단:', pct(counters.endDigit));
console.log('과거 5개+ 일치 차단  :', `${(f8PassRate * 100).toFixed(2)}%`, '(근사 없이 정확 계산)');

console.log('\n--- 합계범위별 통과율 ---');
RANGES.forEach((r, i) => {
    console.log(`±${r}: 합계필터만 ${pct(counters.sumRange[i])} / 나머지 4개 필터까지 합산 ${pct(counters.combined[i])} / 4-8까지 합산(정확) ${pct(counters.exactMax[i])}`);
});

console.log(`\nmaxAttempts 최소값(500,000) 기준, 가장 빡빡한 조건(±5)에서도 기대 통과 개수: ${Math.round(500000 * (counters.exactMax[0] / TOTAL_COMBOS)).toLocaleString()}개`);

console.log('\n--- 합계범위별 "알고리즘이 실제로 만들 수 있는 최대 조합 수" (App.tsx MAX_GAMES_BY_RANGE에 반영) ---');
console.log('const MAX_GAMES_BY_RANGE: Record<number, number> = {');
RANGES.forEach((r, i) => {
    console.log(`    ${r}: ${counters.exactMax[i]},`);
});
console.log('};');
