import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { RefreshCw, BarChart2, Zap, TrendingUp, Settings, Download, Share, Trash2, Crown, Lock } from 'lucide-react';
import { computeLottoStats, generateLottoGames, type LottoDraw, type Game, type LottoStats } from '../supabase/functions/_shared/lottoAlgorithm';
// xlsx는 다운로드/공유 버튼을 누를 때만 필요하므로 초기 번들에서 제외하고 동적 import로 불러온다

/**
 * LOTTO GENIUS - 통계적 균형 및 비인기 조합 필터 기반 로또 번호 생성기
 * 번호 생성 알고리즘 본체는 supabase/functions/_shared/lottoAlgorithm.ts에 있으며
 * 이 컴포넌트와 compute-numbers Edge Function이 그 모듈을 함께 사용한다.
 */

// --- Constants & Utilities ---

const getLocalDateString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const getBallStyle = (num: number) => {
    if (num <= 10) return {
        bg: 'from-amber-300 via-yellow-500 to-amber-600',
        shadow: 'shadow-amber-500/50',
        text: 'text-yellow-900 border-amber-400/50'
    };
    if (num <= 20) return {
        bg: 'from-blue-300 via-blue-500 to-blue-700',
        shadow: 'shadow-blue-500/50',
        text: 'text-white border-blue-400/50'
    };
    if (num <= 30) return {
        bg: 'from-red-300 via-red-500 to-red-700',
        shadow: 'shadow-red-500/50',
        text: 'text-white border-red-400/50'
    };
    if (num <= 40) return {
        bg: 'from-slate-300 via-slate-500 to-slate-700',
        shadow: 'shadow-slate-500/50',
        text: 'text-white border-slate-400/50'
    };
    return {
        bg: 'from-emerald-300 via-emerald-500 to-emerald-700',
        shadow: 'shadow-emerald-500/50',
        text: 'text-white border-emerald-400/50'
    };
};

// Types
type Stats = LottoStats & {
    sumRangeRatio: Record<number, number>; // 합계 ±범위별 실제 회차 비율(%)
};

// --- Components ---

const LottoBall = ({ number, animate }: { number: number, animate?: boolean }) => {
    const style = getBallStyle(number);

    return (
        <div className={`relative group ${animate ? 'animate-bounce-short' : ''} transition-transform duration-300 hover:scale-110 z-10`}>
            {/* Main Ball Body */}
            <div
                className={`
                    w-10 h-10 sm:w-12 sm:h-12 rounded-full 
                    flex items-center justify-center 
                    font-bold text-lg sm:text-xl font-mono
                    bg-gradient-to-br ${style.bg}
                    box-shadow-2xl shadow-lg ${style.shadow}
                    relative overflow-hidden
                    border border-white/20
                    ${style.text}
                `}
                style={{
                    boxShadow: 'inset -5px -5px 10px rgba(0,0,0,0.3), inset 2px 2px 5px rgba(255,255,255,0.3)',
                }}
            >
                {/* Specular Highlight (The "Shine") */}
                <div className="absolute top-1 left-2 w-4 h-2 bg-white/40 blur-sm rounded-full transform -rotate-45"></div>

                {/* Text Shadow for better contrast */}
                <span className="drop-shadow-md z-10 filter">{number}</span>
            </div>

            {/* Ground Reflection/Shadow */}
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-8 h-1 bg-black/30 blur-md rounded-full -z-10 group-hover:scale-90 transition-transform duration-300"></div>
        </div>
    );
};

const StatCard = ({ title, value, subtext, icon: Icon, colorClass }: any) => (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 p-4 rounded-xl flex items-center space-x-4">
        <div className={`p-3 rounded-lg ${colorClass} bg-opacity-20`}>
            <Icon className={`w-6 h-6 ${colorClass.replace('bg-', 'text-')}`} />
        </div>
        <div>
            <h3 className="text-slate-400 text-xs uppercase tracking-wider">{title}</h3>
            <div className="text-2xl font-bold text-white">{value}</div>
            {subtext && <div className="text-xs text-slate-500">{subtext}</div>}
        </div>
    </div>
);

export default function LottoGenius() {
    // State
    const [historyData, setHistoryData] = useState<LottoDraw[]>([]);


    const [generatedGames, setGeneratedGames] = useState<Game[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [stats, setStats] = useState<Stats>({ avgSum: 0, hotNumbers: [], coldNumbers: [], sumRangeRatio: {} });
    const [, setLogs] = useState<string[]>([]);

    // 회원 등급 (데모용 토글 - 실제 로그인/결제 연동 없음)
    const [isPremium, setIsPremium] = useState<boolean>(false);
    const FREE_SUM_RANGE = 40;
    const FREE_START = 1;
    const FREE_END = 5;
    const SUM_RANGE_OPTIONS = [5, 10, 20, 30, 40];
    const SUM_RANGE_LEVEL_LABEL: Record<number, string> = { 5: '레벨 V', 10: '레벨 1', 20: '레벨 2', 30: '레벨 3', 40: '레벨 4' };

    // 필터 체인(4-2 연속수, 4-4 생일조합, 4-5 홀짝, 4-6 끝자리, 4-8 과거일치)을 전부 만족하는
    // 조합은 유한하다. C(45,6)=8,145,060개를 완전열거해서 합계범위별 실제 최대 개수를 구한 값
    // (scripts/analyze-filters.mjs 결과) - 회차 데이터가 크게 갱신되면 재계산해서 갱신할 것.
    const MAX_GAMES_BY_RANGE: Record<number, number> = {
        5: 574667,
        10: 1132327,
        20: 2108042,
        30: 2841012,
        40: 3329651,
    };

    // 합계 평균 기준 +/- 허용 범위
    const [sumRange, setSumRange] = useState<number>(FREE_SUM_RANGE);
    // 원하는 게임 구간
    const [startRange, setStartRange] = useState<number>(FREE_START);
    const [endRange, setEndRange] = useState<number>(FREE_END);

    const maxGamesForRange = MAX_GAMES_BY_RANGE[sumRange] ?? MAX_GAMES_BY_RANGE[FREE_SUM_RANGE];

    // 무료 회원은 무조건 합계범위 ±5, 게임 구간 1~5로 고정
    useEffect(() => {
        if (!isPremium) {
            if (sumRange !== FREE_SUM_RANGE) setSumRange(FREE_SUM_RANGE);
            if (startRange !== FREE_START) setStartRange(FREE_START);
            if (endRange !== FREE_END) setEndRange(FREE_END);
        }
    }, [isPremium, sumRange, startRange, endRange]);

    // 합계범위를 바꿔서 알고리즘상 최대 생성 가능 개수가 줄어들면 구간도 함께 보정
    useEffect(() => {
        if (endRange > maxGamesForRange) setEndRange(maxGamesForRange);
        if (startRange > maxGamesForRange) setStartRange(maxGamesForRange);
    }, [maxGamesForRange, endRange, startRange]);


    // Auto-load data from Supabase on mount
    useEffect(() => {
        const fetchLottoData = async () => {
            try {
                let allData: any[] = [];
                let page = 0;
                const pageSize = 1000;
                let hasMore = true;

                while (hasMore) {
                    const { data, error } = await supabase
                        .from('lotto_draws')
                        .select('*')
                        .order('draw_no', { ascending: true })
                        .range(page * pageSize, (page + 1) * pageSize - 1);

                    if (error) throw error;

                    if (data && data.length > 0) {
                        allData = [...allData, ...data];
                        if (data.length < pageSize) {
                            hasMore = false;
                        } else {
                            page++;
                        }
                    } else {
                        hasMore = false;
                    }
                }

                if (allData.length > 0) {
                    // Map Supabase data to the format expected by the app (array of numbers)
                    // Schema: draw_no, date, num1, num2, num3, num4, num5, num6, bonus
                    const formattedData: LottoDraw[] = allData.map(record => [
                        record.num1,
                        record.num2,
                        record.num3,
                        record.num4,
                        record.num5,
                        record.num6
                    ]);

                    setHistoryData(formattedData);

                    // Find the max draw number
                    const maxDraw = allData.reduce((max, record) => Math.max(max, record.draw_no), 0);

                    console.log(`Loaded ${allData.length} records in total. Last Round: ${maxDraw}`);
                }
            } catch (err) {
                console.error("Failed to load data from Supabase:", err);
            }
        };

        fetchLottoData();
    }, []);

    // --- Statistics Calculation (공유 알고리즘 모듈 사용) ---
    useEffect(() => {
        if (!historyData || historyData.length === 0) return;

        const { avgSum, hotNumbers, coldNumbers } = computeLottoStats(historyData);

        // 합계 ±범위별 실제 회차 비율(%) - 몬테카를로 근사가 아닌 전체 회차 전수 계산 (UI 표시 전용)
        const drawSums = historyData.map(draw => draw.reduce((a, b) => a + b, 0));
        const sumRangeRatio: Record<number, number> = {};
        SUM_RANGE_OPTIONS.forEach(r => {
            const min = avgSum - r;
            const max = avgSum + r;
            const count = drawSums.filter(s => s >= min && s <= max).length;
            sumRangeRatio[r] = (count / drawSums.length) * 100;
        });

        setStats({ avgSum, hotNumbers, coldNumbers, sumRangeRatio });
    }, [historyData]);





    // --- Core Algorithm (Blackboxed via Edge Function with Local Fallback) ---
    const generateLottoNumbers = async () => {
        if (!isPremium && (sumRange !== FREE_SUM_RANGE || startRange !== FREE_START || endRange !== FREE_END)) {
            alert(`무료 회원은 합계 평균 ±${FREE_SUM_RANGE} 범위에서 ${FREE_START}~${FREE_END}번 게임만 선택할 수 있습니다. 다른 범위와 구간은 유료 회원 전환 후 이용해 주세요.`);
            return;
        }
        if (startRange < 1 || endRange < startRange) {
            alert("게임 구간을 올바르게 입력해 주세요. (시작 ≤ 종료, 1 이상)");
            return;
        }
        if (endRange > maxGamesForRange) {
            alert(`선택하신 합계범위(레벨)에서 알고리즘이 만들 수 있는 조합은 최대 ${maxGamesForRange.toLocaleString()}개입니다. 구간을 다시 입력해 주세요.`);
            return;
        }

        setIsGenerating(true);
        setGeneratedGames([]);
        setLogs([]);

        try {
            const { data, error } = await supabase.functions.invoke('compute-numbers', {
                body: {
                    startRange,
                    endRange,
                    sumRange,
                    userId: (await supabase.auth.getUser()).data.user?.id || 'anonymous_pro_user'
                }
            });

            if (error) throw error;

            if (data && data.success) {
                setGeneratedGames(data.games);
                console.log(`Algo Core Result: Round ${data.stats.round}, Avg Sum ${data.stats.avgSum}`);
                return;
            } else {
                throw new Error("Invalid response from server");
            }

        } catch (err) {
            console.error("AlgoShield Trace: External resource blocked. Initiating Local Shielded Computation.", err);

            // --- Local Fallback Algorithm ---
            // If the secure server is unreachable, we compute locally using the same premium parameters
            if (historyData.length === 0) {
                alert("데이터가 로드되지 않았습니다. 잠시 후 상단 회차가 표시되면 다시 시도해 주세요.");
                setIsGenerating(false);
                return;
            }

            // Pseudo-random seeded generator for "Premium" consistency
            let seed = Date.now();
            const prng = () => {
                const x = Math.sin(seed++) * 10000;
                return x - Math.floor(x);
            };

            const resultGames = generateLottoGames({
                historyData,
                avgSum: stats.avgSum,
                hotNums: stats.hotNumbers.map(n => n.num),
                coldNumbers: stats.coldNumbers,
                sumRange,
                startRange,
                endRange,
                prng,
            });

            if (resultGames.length > 0) {
                setGeneratedGames(resultGames);
                console.log(`Local Core Result: Generated ${resultGames.length} games`);
            } else {
                alert("보안 정책 및 비정상 접근 시도로 인해 요청이 제한되었습니다. 잠시 후 다시 시도해 주세요.");
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownload = async () => {
        if (generatedGames.length === 0) return;

        const XLSX = await import('xlsx');

        const data = generatedGames.map((game) => ({
            '선택': `게임 ${game.id}`,
            '번호 1': game.numbers[0],
            '번호 2': game.numbers[1],
            '번호 3': game.numbers[2],
            '번호 4': game.numbers[3],
            '번호 5': game.numbers[4],
            '번호 6': game.numbers[5],
            '합계': game.sum,
            '홀짝 비율': `${game.oddCount}:${6 - game.oddCount}`,
        }));

        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Lotto Numbers");

        XLSX.writeFile(workbook, `lotto-genius_pro_${getLocalDateString()}.xlsx`);
    };

    const handleSend = async () => {
        if (generatedGames.length === 0) return;

        const XLSX = await import('xlsx');

        const data = generatedGames.map((game) => ({
            '선택': `게임 ${game.id}`,
            '번호 1': game.numbers[0],
            '번호 2': game.numbers[1],
            '번호 3': game.numbers[2],
            '번호 4': game.numbers[3],
            '번호 5': game.numbers[4],
            '번호 6': game.numbers[5],
            '합계': game.sum,
            '홀짝 비율': `${game.oddCount}:${6 - game.oddCount}`,
        }));

        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Lotto Numbers");

        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const file = new File([blob], `lotto-genius_pro_${getLocalDateString()}.xlsx`, { type: blob.type });

        const contentStr = generatedGames.map((game) =>
            `[Lotto Genius Pro] 게임 ${game.id}: ${game.numbers.join(', ')}`
        ).join('\n');

        let sharedFile = false;
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({
                    files: [file],
                    title: 'Lotto Genius Pro Picks',
                    text: 'Lotto Genius Pro에서 생성된 로또 번호 엑셀 파일입니다.',
                });
                sharedFile = true;
            } catch (err) {
                if (err instanceof Error && err.name === 'AbortError') return;
                console.log('File share failed, falling back to text', err);
            }
        }

        if (!sharedFile) {
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: 'Lotto Genius Pro Picks',
                        text: contentStr,
                    });
                } catch (err) {
                    if (err instanceof Error && err.name === 'AbortError') return;
                    console.log('Text share failed, falling back to clipboard', err);
                    try {
                        await navigator.clipboard.writeText(contentStr);
                        alert("웹 브라우저 환경 설정으로 인해 텍스트로 클립보드에 복사되었습니다.");
                    } catch (e) {
                        alert("복사 실패");
                    }
                }
            } else {
                try {
                    await navigator.clipboard.writeText(contentStr);
                    alert("기기에서 파일 공유 기능을 지원하지 않아 텍스트로 클립보드에 복사되었습니다. (파일을 얻으려면 다운로드 버튼을 이용하세요)");
                } catch (err) {
                    alert("복사 실패");
                }
            }
        }
    };

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans selection:bg-amber-500 selection:text-neutral-950 pb-20">
            {/* Header */}
            <header className="bg-neutral-950/80 backdrop-blur-2xl border-b border-amber-900/30 sticky top-0 z-50">
                <div className="max-w-5xl mx-auto px-6 py-5 flex justify-between items-center">
                    <div className="flex items-center space-x-4">
                        <div className="bg-gradient-to-br from-yellow-300 via-amber-500 to-yellow-700 p-3 rounded-xl shadow-[0_0_25px_rgba(245,158,11,0.2)] border border-amber-400/20">
                            <Zap className="w-6 h-6 text-neutral-950" fill="currentColor" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-200 via-yellow-500 to-amber-700 tracking-tighter">
                                LOTTO GENIE PRO
                            </h1>
                            <p className="text-xs text-amber-500/60 uppercase tracking-widest mt-1 font-medium">Statistical Pattern Filter Engine</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 py-10 space-y-10">

                {/* Intro/Upload Section */}
                <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="bg-neutral-900/50 backdrop-blur-xl rounded-3xl p-8 border border-amber-900/20 shadow-2xl relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-amber-600 blur-[100px] opacity-10 group-hover:opacity-20 transition duration-700"></div>
                        <div className="absolute bottom-0 left-0 w-40 h-40 bg-yellow-400 blur-[80px] opacity-5 group-hover:opacity-10 transition duration-700"></div>

                        <h2 className="text-xl font-bold text-amber-100 mb-6 flex items-center">
                            <Settings className="w-5 h-5 mr-3 text-amber-500" />
                            분석 설정
                        </h2>

                        <div className="space-y-6 relative z-10">
                            <div>
                                <label className="block text-xs uppercase tracking-widest text-neutral-500 mb-2">데이터베이스 상태</label>
                                <div className="px-4 py-4 bg-black/40 border border-neutral-800 rounded-xl flex justify-between items-center shadow-inner">
                                    <div className="flex items-center space-x-3 text-amber-500">
                                        <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shadow-[0_0_10px_rgba(245,158,11,0.8)]"></div>
                                        <span className="text-sm font-medium">최종 분석 회차</span>
                                    </div>
                                    <div className="text-xl text-amber-200 font-bold font-mono bg-neutral-900/50 px-4 py-1.5 rounded-lg border border-amber-900/30">
                                        {historyData.length > 0 ? historyData.length : '...'}회
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs uppercase tracking-widest text-neutral-500 mb-2">회원 등급 (데모)</label>
                                <div className="flex bg-black/40 rounded-xl p-1.5 border border-neutral-800">
                                    <button
                                        type="button"
                                        onClick={() => setIsPremium(false)}
                                        className={`flex-1 py-2.5 text-sm font-medium rounded-lg text-center transition ${!isPremium ? 'bg-gradient-to-r from-neutral-600 to-neutral-500 text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'}`}
                                    >
                                        무료 회원
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsPremium(true)}
                                        className={`flex-1 py-2.5 text-sm font-bold rounded-lg text-center transition flex items-center justify-center space-x-1 ${isPremium ? 'bg-gradient-to-r from-amber-600 to-yellow-600 text-white shadow-lg shadow-amber-900/20' : 'text-neutral-500 hover:text-neutral-300'}`}
                                    >
                                        <Crown className="w-4 h-4" />
                                        <span>유료 회원</span>
                                    </button>
                                </div>
                                <p className="text-[10px] text-neutral-500 mt-2">* 실제 로그인/결제 연동 없이 기능을 확인하기 위한 데모 스위치입니다.</p>
                            </div>

                            <div>
                                <label className="block text-xs uppercase tracking-widest text-neutral-500 mb-2">합계 평균 허용 범위 (Sum Range)</label>
                                <div className="grid grid-cols-5 gap-2">
                                    {SUM_RANGE_OPTIONS.map((r) => {
                                        const locked = !isPremium && r !== FREE_SUM_RANGE;
                                        const active = sumRange === r;
                                        const ratio = stats.sumRangeRatio[r];
                                        return (
                                            <button
                                                key={r}
                                                type="button"
                                                disabled={locked}
                                                onClick={() => setSumRange(r)}
                                                className={`py-2.5 text-sm font-bold rounded-lg text-center transition flex flex-col items-center justify-center gap-0.5 border
                                                    ${active ? 'bg-gradient-to-r from-amber-600 to-yellow-600 text-white border-amber-500/50 shadow-lg shadow-amber-900/20' : 'bg-black/40 text-neutral-400 border-neutral-800 hover:text-neutral-200'}
                                                    ${locked ? 'opacity-40 cursor-not-allowed hover:text-neutral-400' : ''}
                                                `}
                                            >
                                                <span className="flex items-center space-x-1">
                                                    {locked && <Lock className="w-3 h-3" />}
                                                    <span>{SUM_RANGE_LEVEL_LABEL[r]}</span>
                                                </span>
                                                <span className={`text-[10px] font-normal ${active ? 'text-white/80' : 'text-neutral-500'}`}>
                                                    {ratio !== undefined ? `${Math.round(ratio)}%` : '-'}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs uppercase tracking-widest text-neutral-500 mb-2">원하는 게임 구간 (숫자 입력)</label>
                                <div className="flex items-center space-x-2">
                                    <div className="flex items-center bg-black/60 rounded-lg border border-neutral-800 shadow-inner flex-1 overflow-hidden">
                                        <input
                                            type="number"
                                            min="1"
                                            max={maxGamesForRange}
                                            disabled={!isPremium}
                                            value={startRange}
                                            onChange={(e) => {
                                                const v = parseInt(e.target.value) || 0;
                                                setStartRange(Math.min(v, maxGamesForRange));
                                            }}
                                            className="w-full bg-transparent text-center px-2 py-2 text-amber-200 font-mono text-lg outline-none disabled:opacity-50"
                                            placeholder="시작"
                                        />
                                    </div>
                                    <span className="text-neutral-500 font-bold px-1">~</span>
                                    <div className="flex items-center bg-black/60 rounded-lg border border-neutral-800 shadow-inner flex-1 overflow-hidden">
                                        <input
                                            type="number"
                                            min="1"
                                            max={maxGamesForRange}
                                            disabled={!isPremium}
                                            value={endRange}
                                            onChange={(e) => {
                                                const v = parseInt(e.target.value) || 0;
                                                setEndRange(Math.min(v, maxGamesForRange));
                                            }}
                                            className="w-full bg-transparent text-center px-2 py-2 text-amber-200 font-mono text-lg outline-none disabled:opacity-50"
                                            placeholder="종료"
                                        />
                                    </div>
                                </div>
                                <p className="text-[10px] text-neutral-500 mt-2">
                                    {isPremium
                                        ? `* 현재 합계범위(레벨) 기준 알고리즘이 만들 수 있는 조합은 최대 ${maxGamesForRange.toLocaleString()}개입니다. 예: 10001~10010 입력 시 해당 구간의 게임을 받습니다.`
                                        : `* 무료 회원은 ${FREE_START}~${FREE_END}번 게임만 선택할 수 있습니다.`}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Stats Dashboard */}
                    <div className="grid grid-cols-1 gap-6">
                        <StatCard
                            title="평균 합계 (Avg Sum)"
                            value={stats.avgSum > 0 ? stats.avgSum.toFixed(1) : "N/A"}
                            subtext={stats.avgSum > 0 ? "" : "데이터 로드 필요"}
                            icon={TrendingUp}
                            colorClass="text-amber-500 bg-amber-500/10 border border-amber-500/20"
                        />
                        <StatCard
                            title="최다 빈출 (Hot Numbers)"
                            value={stats.hotNumbers.length > 0 ? stats.hotNumbers.slice(0, 5).map(n => n.num).join(', ') : "N/A"}
                            subtext="Too hot to handle? (가중치 최소화 적용)"
                            icon={BarChart2}
                            colorClass="text-yellow-600 bg-yellow-600/10 border border-yellow-600/20"
                        />
                    </div>
                </section>

                {/* Action Button */}
                <div className="flex justify-center mt-12 mb-8 space-x-6">
                    <button
                        onClick={generateLottoNumbers}
                        disabled={isGenerating || historyData.length === 0 || endRange < startRange || startRange < 1}
                        className={`
              relative overflow-hidden group
              px-16 py-6 rounded-full font-black text-2xl tracking-widest
              text-neutral-900 shadow-[0_0_50px_-5px_rgba(245,158,11,0.6)]
              transition-all duration-500 transform hover:scale-105 active:scale-95
              border border-yellow-300/50
              ${(isGenerating || historyData.length === 0 || endRange < startRange || startRange < 1) ? 'bg-neutral-800 text-neutral-500 border-neutral-700 cursor-not-allowed shadow-none' : 'bg-gradient-to-r from-yellow-300 via-amber-400 to-yellow-600 hover:from-yellow-200 hover:via-amber-300 hover:to-amber-500'}
            `}
                    >
                        <div className="absolute inset-0 bg-white/20 transform -skew-x-12 -translate-x-full group-hover:animate-shine z-0"></div>
                        <span className="relative z-10 flex items-center justify-center space-x-3">
                            {isGenerating ? (
                                <>
                                    <RefreshCw className="w-7 h-7 animate-spin text-neutral-900" />
                                    <span>분석 및 추출 중...</span>
                                </>
                            ) : (
                                <>
                                    <Zap className="w-7 h-7 text-neutral-900" fill="currentColor" />
                                    <span>프리미엄 번호 생성</span>
                                </>
                            )}
                        </span>
                    </button>
                    <button
                        onClick={() => { setGeneratedGames([]); setLogs([]); }}
                        disabled={generatedGames.length === 0}
                        className={`
                          flex items-center justify-center space-x-2
                          px-8 py-6 rounded-full font-bold text-xl tracking-widest
                          transition-all duration-300 border
                          shadow-lg
                          ${generatedGames.length === 0 ? 'bg-neutral-800/50 text-neutral-600 border-neutral-800 cursor-not-allowed' : 'text-neutral-400 bg-neutral-800/80 hover:bg-red-900/40 hover:text-red-400 border-neutral-700 hover:border-red-500/50'}
                        `}
                    >
                        <Trash2 className="w-6 h-6" />
                        <span>지우기</span>
                    </button>
                </div>



                {/* Results Section */}
                {generatedGames.length > 0 && (
                    <section className="space-y-6 animate-fade-in-up mt-12">
                        <div className="flex flex-col sm:flex-row justify-between items-center bg-gradient-to-r from-neutral-900 to-neutral-800 p-6 rounded-2xl border border-amber-900/40 shadow-xl relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-amber-300 to-amber-600"></div>
                            <h3 className="text-2xl font-bold text-amber-100 flex items-center space-x-4 mb-6 sm:mb-0 ml-4">
                                <span>프리미엄 추천 조합</span>
                                <span className="text-sm font-bold text-neutral-900 bg-gradient-to-r from-amber-400 to-yellow-500 px-3 py-1 rounded-full shadow-lg shadow-amber-500/20">
                                    {generatedGames.length} SETS
                                </span>
                            </h3>

                            <div className="flex space-x-4">
                                <button
                                    onClick={handleDownload}
                                    className="flex items-center space-x-2 px-5 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-amber-100 text-sm font-medium rounded-xl transition duration-300 border border-neutral-600 hover:border-amber-500/50"
                                >
                                    <Download className="w-5 h-5" />
                                    <span>Excel 저장</span>
                                </button>
                                <button
                                    onClick={handleSend}
                                    className="flex items-center space-x-2 px-5 py-2.5 bg-gradient-to-r from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white text-sm font-bold rounded-xl transition duration-300 shadow-[0_0_20px_rgba(245,158,11,0.3)] hover:shadow-[0_0_25px_rgba(245,158,11,0.5)]"
                                >
                                    <Share className="w-5 h-5" />
                                    <span>전송하기</span>
                                </button>
                            </div>
                        </div>

                        <div className="grid gap-6">
                            {generatedGames.map((game, index) => (
                                <div
                                    key={index}
                                    className="bg-neutral-900/60 backdrop-blur-xl border border-neutral-800 rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between hover:border-amber-500/40 hover:bg-neutral-900/80 transition duration-500 group shadow-2xl relative overflow-hidden"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-r from-amber-600/0 via-amber-600/5 to-amber-600/0 opacity-0 group-hover:opacity-100 transition duration-500"></div>
                                    <div className="flex items-center space-x-6 mb-6 sm:mb-0 w-full sm:w-auto justify-center relative z-10">
                                        <span className="text-amber-500/50 font-black text-xl italic tracking-tighter mr-2 w-12 text-right">{game.id}</span>
                                        <div className="flex space-x-2 sm:space-x-4">
                                            {game.numbers.map((num) => (
                                                <LottoBall key={num} number={num} animate={true} />
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex space-x-8 text-xs sm:text-sm w-full sm:w-auto justify-between sm:justify-end px-4 sm:px-0 border-t sm:border-t-0 border-neutral-800 pt-5 sm:pt-0 mt-4 sm:mt-0 relative z-10">
                                        <div className="flex flex-col items-center sm:items-end">
                                            <span className="text-[10px] text-neutral-500 tracking-widest uppercase mb-1">Total Sum</span>
                                            <span className="text-amber-400 font-bold text-lg">{game.sum}</span>
                                        </div>
                                        <div className="flex flex-col items-center sm:items-end">
                                            <span className="text-[10px] text-neutral-500 tracking-widest uppercase mb-1">Ratio</span>
                                            <span className="text-neutral-300 font-medium text-lg">{game.oddCount}:{6 - game.oddCount}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}
