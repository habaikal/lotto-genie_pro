import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load env vars (you need to set these in your terminal or .env file for this script to work)
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    console.error('Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function migrateData() {
    const csvPath = path.join(__dirname, 'public', 'lotto_results.csv')
    const csvData = fs.readFileSync(csvPath, 'utf-8')
    const lines = csvData.trim().split('\n')

    // Remove header
    const header = lines.shift()
    console.log('Header:', header)

    const records = []

    // Create a mapping for date. Since CSV doesn't have date, we'll iterate backwards from a known date or just use current date for now?
    // Wait, the CSV format in the previous `head` command output didn't show a date column.
    // The schema requires a date.
    // "date DATE NOT NULL"
    // Let's check the CSV content again. It was:
    // 회차,번호1,번호2,번호3,번호4,번호5,번호6,보너스
    // 1,10,23,29,33,37,40,16

    // Only 8 columns. The schema expects:
    // draw_no, date, num1..6, bonus

    // I need to either alter the table to make date nullable, or generate a fake date.
    // Since the user wants "weekly updates", date is important.
    // But I don't have the historical dates in the CSV.
    // I will calculate dates based on the draw number.
    // Draw 1 was on 2002-12-07. Every 7 days thereafter.

    const baseDate = new Date('2002-12-07')

    for (const line of lines) {
        const cols = line.split(',').map(s => s.trim())
        if (cols.length < 8) continue

        const drawNo = parseInt(cols[0])
        const nums = cols.slice(1, 7).map(n => parseInt(n))
        const bonus = parseInt(cols[7])

        // Calculate date
        // specific logic: Draw 1 = 2002-12-07
        // Date = baseDate + (drawNo - 1) * 7 days
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

    console.log(`Prepared ${records.length} records. Inserting...`)

    // Insert in batches to avoid payload limits
    const batchSize = 100
    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize)
        const { error } = await supabase.from('lotto_draws').upsert(batch)

        if (error) {
            console.error('Error inserting batch:', error)
        } else {
            console.log(`Inserted batch ${i} - ${i + batch.length}`)
        }
    }

    console.log('Migration complete!')
}

migrateData()
