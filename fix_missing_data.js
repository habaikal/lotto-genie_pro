
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function fixMissingData() {
    const csvPath = path.join(__dirname, 'public', 'lotto_results.csv')
    const csvData = fs.readFileSync(csvPath, 'utf-8')
    const lines = csvData.trim().split('\n')

    // Remove header
    lines.shift()

    const records = []
    const baseDate = new Date('2002-12-07')

    for (const line of lines) {
        const cols = line.split(',').map(s => s.trim())
        if (cols.length < 8) continue

        const drawNo = parseInt(cols[0])

        // Target only the missing range
        if (drawNo < 1101 || drawNo > 1200) continue;

        const nums = cols.slice(1, 7).map(n => parseInt(n))
        const bonus = parseInt(cols[7])

        const drawDate = new Date(baseDate)
        drawDate.setDate(baseDate.getDate() + (drawNo - 1) * 7)

        records.push({
            draw_no: drawNo,
            date: drawDate.toISOString().split('T')[0],
            num1: nums[0],
            num2: nums[1],
            num3: nums[2],
            num4: nums[3],
            num5: nums[4],
            num6: nums[5],
            bonus: bonus
        })
    }

    console.log(`Prepared ${records.length} missing records (1101-1200). Inserting...`)

    if (records.length > 0) {
        const { error } = await supabase.from('lotto_draws').upsert(records)
        if (error) {
            console.error('Error inserting missing batch:', error)
        } else {
            console.log('Successfully inserted missing records!')
        }
    } else {
        console.log('No records found in range 1101-1200.')
    }
}

fixMissingData()
