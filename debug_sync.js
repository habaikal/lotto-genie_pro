
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkMissing() {
    console.log("Fetching all draw_no from Supabase...");

    let allDraws = [];
    let page = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
        const { data, error } = await supabase
            .from('lotto_draws')
            .select('draw_no')
            .order('draw_no', { ascending: true })
            .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
            console.error("Error fetching data:", error);
            process.exit(1);
        }

        if (data && data.length > 0) {
            allDraws = [...allDraws, ...data.map(d => d.draw_no)];
            if (data.length < pageSize) hasMore = false;
            else page++;
        } else {
            hasMore = false;
        }
    }

    console.log(`Total records in DB: ${allDraws.length}`);
    const maxDraw = 1211; // We know this is the target
    const missing = [];

    for (let i = 1; i <= maxDraw; i++) {
        if (!allDraws.includes(i)) {
            missing.push(i);
        }
    }

    if (missing.length > 0) {
        console.log(`Missing ${missing.length} records:`, missing);
        console.log("First missing:", missing[0]);
        console.log("Last missing:", missing[missing.length - 1]);
    } else {
        console.log("No missing records found! DB is in sync.");
    }
}

checkMissing();
