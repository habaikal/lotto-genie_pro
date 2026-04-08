
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);

if (args.length !== 8) {
    console.log("⚠️  사용법: node add_draw.js <회차> <번호1> <번호2> <번호3> <번호4> <번호5> <번호6> <보너스>");
    console.log("📝 예시: node add_draw.js 1212 1 2 3 4 5 6 7");
    process.exit(1);
}

const [drawNo, ...numbers] = args;
const csvLine = `${drawNo},${numbers.join(',')}`;

const publicCsvPath = path.join(__dirname, 'public', 'lotto_results.csv');
const distCsvPath = path.join(__dirname, 'dist', 'lotto_results.csv');

try {
    // 1. Read existing file to ensure newline handling
    let fileContent = fs.readFileSync(publicCsvPath, 'utf8').trim();

    // Check if draw already exists (simple check)
    if (fileContent.includes(`\n${drawNo},`)) {
        console.log(`⚠️  ${drawNo}회차는 이미 존재합니다.`);
        process.exit(1);
    }

    // Append new line
    fileContent += `\n${csvLine}`;
    fs.writeFileSync(publicCsvPath, fileContent, 'utf8');
    console.log(`✅ public/lotto_results.csv 에 ${drawNo}회차 추가 완료.`);

    // 2. Copy to dist CSV
    // Ensure dist directory exists
    if (!fs.existsSync(path.dirname(distCsvPath))) {
        fs.mkdirSync(path.dirname(distCsvPath), { recursive: true });
    }
    fs.writeFileSync(distCsvPath, fileContent, 'utf8');
    console.log(`✅ dist/lotto_results.csv 복사 완료.`);

    // 3. Run migration
    console.log("🔄 Supabase 동기화 시작...");
    // Use --env-file=.env to load environment variables for the migration script
    execSync('node --env-file=.env.local migrate_to_supabase.js', { stdio: 'inherit' });

    // 4. GitHub Push
    console.log("🚀 GitHub 저장소에 변경사항 푸시 중...");
    execSync('git add public/lotto_results.csv dist/lotto_results.csv add_draw.js package.json', { stdio: 'inherit' });
    execSync(`git commit -m "Update lotto results for draw ${drawNo}"`, { stdio: 'inherit' });
    execSync('git push', { stdio: 'inherit' });

    // 5. GitHub Pages Deploy
    console.log("🌐 GitHub Pages 웹 화면 자동 배포 중...");
    execSync('npm run deploy', { stdio: 'inherit' });

    console.log("\n🎉 모든 업데이트 및 자동 배포가 완료되었습니다!");

} catch (error) {
    console.error("❌ 오류 발생:", error);
}
