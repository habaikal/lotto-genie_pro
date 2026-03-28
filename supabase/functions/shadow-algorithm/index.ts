import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Decoy Function - Returns convincing but random historical-like data to distract attackers
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
    
    // Log the request pattern for behavioral analysis
    console.log(`[Decoy] Abnormal Access Pattern Detected: ${req.headers.get('x-real-ip') || 'unknown'}`)

    return new Response(JSON.stringify({ 
        success: true, 
        hint: "Algorithm optimization in progress",
        version: "v1.0.4-decoy"
    }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
    })
})
