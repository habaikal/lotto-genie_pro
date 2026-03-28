import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { startRange, endRange, tolerance = 0.05, userId } = await req.json()

        // 1. Setup Supabase Client
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ""
        const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ""
        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

        // 2. Dynamic Seed Obfuscation
        // HMAC(userId + timestamp, SERVER_SECRET)
        const timestamp = Date.now()
        const serverSecret = Deno.env.get('ALGO_SERVER_SECRET') ?? "default_secret_for_protection"

        // Simple manual HMAC/Seed generation for demonstration in Deno
        const message = `${userId || 'anon'}-${timestamp}`
        const encoder = new TextEncoder()
        const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(serverSecret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        )
        const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message))
        let sessionSeed = new Uint32Array(signature)[0] // Use first 32 bits as seed base

        // Mock Prng with seed for reproducibility if needed, or just for noise
        const prng = () => {
            const x = Math.sin(sessionSeed++) * 10000
            return x - Math.floor(x)
        }

        // 3. Fetch History Data (Server-Side)
        const { data: allDraws, error: fetchError } = await supabase
            .from('lotto_draws')
            .select('*')
            .order('draw_no', { ascending: true })

        if (fetchError) throw fetchError

        const historyData = allDraws.map(doc => [
            doc.num1, doc.num2, doc.num3, doc.num4, doc.num5, doc.num6
        ])

        // 4. Statistics Calculation (Server-Side)
        let totalSum = 0
        const frequency: Record<number, number> = {}
        const lastAppearance: Record<number, number> = {}

        historyData.forEach((draw, index) => {
            const sum = draw.reduce((a, b) => a + b, 0)
            totalSum += sum
            draw.forEach(num => {
                frequency[num] = (frequency[num] || 0) + 1
                lastAppearance[num] = index
            })
        })

        const avgSum = totalSum / historyData.length
        const hotNumbers = Object.keys(frequency)
            .map(num => ({ num: parseInt(num), count: frequency[parseInt(num)] }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10).map(n => n.num)

        const recentHistoryLimit = historyData.length - 15
        const coldNumbers = []
        for (let i = 1; i <= 45; i++) {
            if ((lastAppearance[i] ?? -1) < recentHistoryLimit) {
                coldNumbers.push(i)
            }
        }
        const lastDraw = historyData[historyData.length - 1] || []

        // 5. Core Algorithm (Blackboxed)
        const newGames = []
        let attempts = 0
        const targetGameCount = endRange
        const maxAttempts = Math.max(500000, targetGameCount * 2000)

        const targetMin = avgSum * (1 - tolerance)
        const targetMax = avgSum * (1 + tolerance)

        const weights: Record<number, number> = {}
        for (let i = 1; i <= 45; i++) {
            let weight = 10
            if (coldNumbers.includes(i)) weight = 30
            else if (hotNumbers.includes(i)) weight = 5
            weights[i] = weight
        }

        while (newGames.length < targetGameCount && attempts < maxAttempts) {
            attempts++

            const numbers = new Set<number>()
            while (numbers.size < 6) {
                let totalWeight = 0
                for (let i = 1; i <= 45; i++) {
                    if (!numbers.has(i)) totalWeight += weights[i]
                }

                let randomVal = prng() * totalWeight // Using our seeded noise
                for (let i = 1; i <= 45; i++) {
                    if (!numbers.has(i)) {
                        randomVal -= weights[i]
                        if (randomVal <= 0) {
                            numbers.add(i)
                            break
                        }
                    }
                }
            }
            const candidate = Array.from(numbers).sort((a, b) => a - b)
            const sum = candidate.reduce((a, b) => a + b, 0)

            if (sum < targetMin || sum > targetMax) continue

            // 2-1. Consecutive (Restrict 4 or more)
            let maxConsecutive = 1;
            let currentConsecutive = 1;
            for (let i = 0; i < 5; i++) {
                if (candidate[i] + 1 === candidate[i + 1]) {
                    currentConsecutive++;
                } else {
                    currentConsecutive = 1;
                }
                if (currentConsecutive > maxConsecutive) maxConsecutive = currentConsecutive;
            }
            if (maxConsecutive >= 4) continue;

            // 2-2. Hot Count
            if (candidate.filter(n => hotNumbers.includes(n)).length >= 4) continue
            // 2-3. Birthday
            if (candidate.every(n => n <= 31)) continue
            // 2-4. Odd/Even
            const odd = candidate.filter(n => n % 2 !== 0).length
            if ([0, 1, 5, 6].includes(odd)) continue
            // 2-5. Same End Digit
            const ends = candidate.map(n => n % 10)
            const dCounts: Record<number, number> = {}
            let hasFourEnd = false
            for (const d of ends) { dCounts[d] = (dCounts[d] || 0) + 1; if (dCounts[d] >= 4) { hasFourEnd = true; break } }
            if (hasFourEnd) continue
            // 2-6. Last Draw Overlap
            if (candidate.filter(n => lastDraw.includes(n)).length >= 4) continue
            // 2-7. Past Winner (5+ match)
            let isPast = false
            for (const h of historyData) {
                let m = 0; for (let j = 0; j < 6; j++) if (candidate.includes(h[j])) m++
                if (m >= 5) { isPast = true; break }
            }
            if (isPast) continue

            newGames.push({
                id: newGames.length + 1,
                numbers: candidate,
                sum,
                oddCount: odd,
                hotCount: candidate.filter(n => hotNumbers.includes(n)).length
            })
        }

        const selectedGames = newGames.slice(startRange - 1, endRange)

        // 6. Return Result (Blackbox Response)
        return new Response(JSON.stringify({
            success: true,
            games: selectedGames,
            stats: {
                avgSum: avgSum.toFixed(1),
                round: historyData.length
            }
        }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })

    } catch (err) {
        // Zero-Knowledge Response: Return generic 400 for errors
        return new Response(JSON.stringify({ error: "Invalid Request Pattern", message: "Computation Failed" }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }
})
