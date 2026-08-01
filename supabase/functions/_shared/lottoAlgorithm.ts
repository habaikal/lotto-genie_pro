// 로또 번호 생성 알고리즘의 단일 진실 소스(SSOT).
//
// 클라이언트(src/App.tsx, Edge Function 미응답 시 로컬 폴백)와 Supabase Edge
// Function(supabase/functions/compute-numbers)이 동일한 이 모듈을 임포트해서
// 쓴다. 예전에는 필터 체인이 두 파일에 각각 손으로 복사돼 있어서, 필터를
// 하나 바꿀 때마다 양쪽을 수동으로 동기화해야 했고 그 과정에서 로직이
// 어긋날 위험이 있었다.
//
// 순수 TypeScript만 사용한다(Deno 전용 API, 브라우저 DOM API 없음). 그래서
// Vite(npm) 번들과 Deno Edge Function 양쪽에서 그대로 상대경로로 임포트해서
// 쓸 수 있다.

export type LottoDraw = number[];

export type Game = {
    id: number;
    numbers: number[];
    sum: number;
    oddCount: number;
    hotCount: number;
};

export type LottoStats = {
    avgSum: number;
    hotNumbers: { num: number; count: number }[];
    coldNumbers: number[];
};

const TOTAL_NUMBERS = 45;
const COLD_STREAK_ROUNDS = 15; // 이 회차 이상 미출현이면 콜드넘버로 취급

export function computeLottoStats(historyData: LottoDraw[]): LottoStats {
    let totalSum = 0;
    const frequency: Record<number, number> = {};
    const lastAppearance: Record<number, number> = {};

    historyData.forEach((draw, index) => {
        const sum = draw.reduce((a, b) => a + b, 0);
        totalSum += sum;
        draw.forEach((num) => {
            frequency[num] = (frequency[num] || 0) + 1;
            lastAppearance[num] = index; // 인덱스가 클수록 최근 회차
        });
    });

    const avgSum = historyData.length > 0 ? totalSum / historyData.length : 0;

    const hotNumbers = Object.keys(frequency)
        .map((num) => ({ num: parseInt(num, 10), count: frequency[parseInt(num, 10)] }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    const recentHistoryLimit = historyData.length - COLD_STREAK_ROUNDS;
    const coldNumbers: number[] = [];
    for (let i = 1; i <= TOTAL_NUMBERS; i++) {
        if ((lastAppearance[i] ?? -1) < recentHistoryLimit) {
            coldNumbers.push(i);
        }
    }

    return { avgSum, hotNumbers, coldNumbers };
}

function buildWeightedPool(hotNums: number[], coldNumbers: number[]) {
    const poolNums: number[] = [];
    const poolWeights: number[] = [];
    let totalWeight = 0;
    for (let i = 1; i <= TOTAL_NUMBERS; i++) {
        let weight = 10;
        if (coldNumbers.includes(i)) weight = 30;
        else if (hotNums.includes(i)) weight = 5;
        poolNums.push(i);
        poolWeights.push(weight);
        totalWeight += weight;
    }
    return { poolNums, poolWeights, totalWeight };
}

export type GenerateGamesParams = {
    historyData: LottoDraw[];
    avgSum: number;
    hotNums: number[];
    coldNumbers: number[];
    sumRange: number;
    startRange: number;
    endRange: number;
    prng: () => number;
};

// 필터 체인: 합계범위 → 배치 내 중복 → 연속번호 → 생일조합 → 홀짝비율 → 동일끝자리 → 과거당첨유사도.
// endRange개를 모을 때까지(또는 시도 상한까지) 뽑고 나서 [startRange, endRange] 구간만 반환한다.
export function generateLottoGames(params: GenerateGamesParams): Game[] {
    const { historyData, avgSum, hotNums, coldNumbers, sumRange, startRange, endRange, prng } = params;

    const targetCount = endRange;
    const maxAttempts = Math.max(500000, targetCount * 2000);

    const targetMin = avgSum - sumRange;
    const targetMax = avgSum + sumRange;

    // 번호 풀(1~45)을 한 번만 만들어두고, 매 시도마다 복사해서 소비한다
    const { poolNums: basePoolNums, poolWeights: basePoolWeights, totalWeight: baseTotalWeight } =
        buildWeightedPool(hotNums, coldNumbers);

    // 과거 회차를 Set으로 미리 변환 (과거당첨유사도 필터: includes() 반복 대신 O(1) 조회)
    const historySets = historyData.map((h) => new Set(h));

    // 이번 생성 요청 안에서 이미 채택된 조합인지 확인 (배치 내 중복 방지)
    const acceptedKeys = new Set<string>();

    const games: Game[] = [];
    let attempts = 0;

    while (games.length < targetCount && attempts < maxAttempts) {
        attempts++;

        const poolNums = basePoolNums.slice();
        const poolWeights = basePoolWeights.slice();
        let poolTotal = baseTotalWeight;
        const numbers: number[] = [];
        for (let pick = 0; pick < 6; pick++) {
            let r = prng() * poolTotal;
            let idx = 0;
            for (; idx < poolWeights.length - 1; idx++) {
                r -= poolWeights[idx];
                if (r <= 0) break;
            }
            numbers.push(poolNums[idx]);
            poolTotal -= poolWeights[idx];
            poolNums.splice(idx, 1);
            poolWeights.splice(idx, 1);
        }

        const candidate = numbers.sort((a, b) => a - b);
        const sum = candidate.reduce((a, b) => a + b, 0);

        if (sum < targetMin || sum > targetMax) continue;

        const candidateKey = candidate.join(',');
        if (acceptedKeys.has(candidateKey)) continue;

        // 연속번호 4개 이상 차단
        let maxCons = 1;
        let currentCons = 1;
        for (let i = 0; i < 5; i++) {
            if (candidate[i] + 1 === candidate[i + 1]) {
                currentCons++;
            } else {
                currentCons = 1;
            }
            if (currentCons > maxCons) maxCons = currentCons;
        }
        if (maxCons >= 4) continue;

        // 생일 조합(1~31 위주 선택) 회피: 5개 이상이 31 이하면 차단
        if (candidate.filter((n) => n <= 31).length >= 5) continue;

        const odd = candidate.filter((n) => n % 2 !== 0).length;
        if ([0, 1, 5, 6].includes(odd)) continue;

        const ends = candidate.map((n) => n % 10);
        const dCounts: Record<number, number> = {};
        let hasFourEnd = false;
        for (const d of ends) {
            dCounts[d] = (dCounts[d] || 0) + 1;
            if (dCounts[d] >= 4) { hasFourEnd = true; break; }
        }
        if (hasFourEnd) continue;

        let isPast = false;
        for (const hSet of historySets) {
            let m = 0;
            for (const n of candidate) if (hSet.has(n)) m++;
            if (m >= 5) { isPast = true; break; }
        }
        if (isPast) continue;

        acceptedKeys.add(candidateKey);
        games.push({
            id: games.length + 1,
            numbers: candidate,
            sum,
            oddCount: odd,
            hotCount: candidate.filter((n) => hotNums.includes(n)).length,
        });
    }

    return games.slice(startRange - 1, endRange);
}
