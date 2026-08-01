import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { computeLottoStats, generateLottoGames } from "../_shared/lottoAlgorithm.ts"

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
        const { startRange, endRange, sumRange = 40, userId } = await req.json()

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

        // 4. Statistics + 5. Core Algorithm (공유 모듈 - src/App.tsx의 로컬 폴백과 동일한 로직)
        const { avgSum, hotNumbers, coldNumbers } = computeLottoStats(historyData)

        const selectedGames = generateLottoGames({
            historyData,
            avgSum,
            hotNums: hotNumbers.map(n => n.num),
            coldNumbers,
            sumRange,
            startRange,
            endRange,
            prng,
        })

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
