# 로또 결과 업데이트 스크립트 (단일 진실 소스)
#
# 동행복권 공식 API에서 다음 회차를 자동 조회 -> CSV 추가 -> Supabase 동기화
# -> git commit/push -> GitHub Pages 배포까지 한 번에 처리한다.
#
# 예전에는 이 흐름이 두 갈래로 나뉘어 있었다: 번호를 손으로 입력해야 하는
# add_draw.js(+ 매번 전체 회차를 재업로드하는 migrate_to_supabase.js)와,
# API에서 자동으로 가져오는 이 스크립트. 두 도구를 각자 다른 시점에 실행하다
# 보니 로컬 git 히스토리가 원격과 갈라지는 문제가 실제로 발생했다. 이제부터는
# 이 스크립트 하나만 쓴다 - `npm run update-draw`로 실행한다.
#
# 의존성: pip install -r requirements.txt

import os
import csv
import sys
import subprocess
import requests
from supabase import create_client, Client

# 대상 파일 경로 설정 (프로젝트 루트 기준 public/lotto_results.csv)
CSV_FILE = "public/lotto_results.csv"

def load_env_local():
    """
    로컬 개발 환경에서 테스트하기 편하도록 .env.local 파일을 파싱하여 환경 변수에 추가합니다.
    """
    env_path = ".env.local"
    if os.path.exists(env_path):
        print(f"[INFO] 로컬 환경 변수 파일({env_path})을 로드합니다.")
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                # 빈 줄이거나 주석인 경우 건너뜁니다.
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, val = line.split("=", 1)
                    # 앞뒤 공백을 제거하고 환경 변수로 설정
                    os.environ[key.strip()] = val.strip()

def get_latest_drwno_from_csv():
    """
    로컬 CSV 파일에서 마지막으로 저장된 회차 번호를 읽어옵니다.
    """
    if not os.path.exists(CSV_FILE):
        print(f"[WARN] {CSV_FILE} 파일이 존재하지 않아 회차를 0으로 초기화합니다.")
        return 0
    
    try:
        # UTF-8 BOM(있는 경우)을 안전하게 무시하기 위해 utf-8-sig 인코딩을 적용합니다.
        with open(CSV_FILE, mode='r', encoding='utf-8-sig') as f:
            reader = list(csv.reader(f))
            if len(reader) <= 1:  # 헤더(1행)만 있거나 파일이 비어있는 경우
                return 0
            
            # 마지막 줄의 첫 번째 열(회차 번호)을 가져와 정수로 반환합니다.
            last_row = reader[-1]
            if last_row and last_row[0].isdigit():
                return int(last_row[0])
    except Exception as e:
        print(f"[ERROR] CSV 파일 조회 중 에러 발생: {e}")
    return 0

def fetch_lotto_data(drw_no):
    """
    동행복권 공식 OpenAPI를 통해 특정 회차의 당첨 데이터를 가져옵니다.
    로컬 한국 IP망에서 안전하게 호출하도록 헤더를 세팅합니다.
    """
    url = f"https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo={drw_no}"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.dhlottery.co.kr/'
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        # API 응답 성공 여부 확인
        if data.get("returnValue") == "success":
            return data
        else:
            print(f"[INFO] {drw_no}회차 데이터는 아직 제공되지 않거나 응답 상태가 올바르지 않습니다.")
    except Exception as e:
        print(f"[ERROR] API 호출 중 오류 발생: {e}")
    return None

def run_command(command, description):
    """
    외부 CLI 명령어를 실행하고 결과를 출력합니다.
    Windows Batch 파일 및 패키지 환경을 위해 shell=True로 실행합니다.
    """
    print(f"\n[RUN] {description} 실행 중...")
    try:
        result = subprocess.run(command, shell=True, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.stdout:
            print(result.stdout.strip())
        return True
    except subprocess.CalledProcessError as e:
        print(f"[FAIL] {description} 실패!")
        if e.stdout:
            print(e.stdout.strip())
        if e.stderr:
            print(e.stderr.strip(), file=sys.stderr)
        return False

def get_latest_drwno_from_supabase(supabase: Client) -> int:
    """
    Supabase 'lotto_draws' 테이블에서 마지막으로 저장된 회차 번호를 읽어옵니다.
    """
    try:
        response = supabase.table("lotto_draws").select("draw_no").order("draw_no", desc=True).limit(1).execute()
        if response.data and len(response.data) > 0:
            return int(response.data[0]["draw_no"])
    except Exception as e:
        print(f"[WARN] Supabase에서 마지막 회차 조회 실패(테이블이 비어있을 수 있음): {e}")
    return 0

def main():
    # 1. 로컬 환경 변수 로드 (.env.local 지원)
    load_env_local()

    # 1-1. 원격 저장소와 먼저 동기화 (다른 곳에서 이미 업데이트했을 경우 히스토리 분기 방지)
    run_command("git pull --rebase", "원격 저장소 동기화(git pull)")

    # 2. CSV 로컬 파일 기준으로 현재 마지막 회차 확인
    last_drw_csv = get_latest_drwno_from_csv()
    next_drw = last_drw_csv + 1
    print(f"[INFO] 현재 CSV 마지막 회차: {last_drw_csv}회 | 다음 신규 시도 회차: {next_drw}회")

    # 3. 최신 로또 데이터 조회 및 CSV 업데이트 시도
    csv_updated = False
    lotto_data = fetch_lotto_data(next_drw)
    if lotto_data:
        # 방어적 중복 체크 (git pull 이후에도 이미 같은 회차가 들어있는지 재확인)
        if get_latest_drwno_from_csv() < lotto_data["drwNo"]:
            drw_no = lotto_data["drwNo"]
            n1 = lotto_data["drwtNo1"]
            n2 = lotto_data["drwtNo2"]
            n3 = lotto_data["drwtNo3"]
            n4 = lotto_data["drwtNo4"]
            n5 = lotto_data["drwtNo5"]
            n6 = lotto_data["drwtNo6"]
            bonus = lotto_data["bnusNo"]

            # CSV 파일 최하단에 새로운 라인 추가 (날짜 컬럼 제외한 8개 열 구성)
            try:
                with open(CSV_FILE, mode='a', newline='', encoding='utf-8') as f:
                    writer = csv.writer(f)
                    writer.writerow([drw_no, n1, n2, n3, n4, n5, n6, bonus])
                print(f"[OK] CSV 파일 업데이트 완료: {drw_no}회차 추가")
                csv_updated = True
                last_drw_csv = drw_no  # CSV 마지막 회차 업데이트
            except Exception as e:
                print(f"[ERROR] CSV 파일 쓰기 실패: {e}")
                return
    else:
        print(f"[INFO] 신규 {next_drw}회차 데이터가 동행복권 API에 아직 없습니다. CSV 업데이트를 건너뜁니다.")

    # 4. Supabase DB와 연동 및 동기화 (누락 회차 일괄 동기화)
    supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY")

    db_updated = False
    if supabase_url and supabase_key:
        try:
            supabase: Client = create_client(supabase_url, supabase_key)
            
            # DB의 마지막 회차 번호 조회
            last_drw_db = get_latest_drwno_from_supabase(supabase)
            print(f"[INFO] 현재 Supabase DB 마지막 회차: {last_drw_db}회")
            
            if last_drw_db < last_drw_csv:
                missing_draws = list(range(last_drw_db + 1, last_drw_csv + 1))
                print(f"[INFO] Supabase에 누락된 회차 동기화 시작: {missing_draws}")
                
                for drw in missing_draws:
                    print(f"[INFO] {drw}회차 데이터를 API에서 조회 중...")
                    drw_data = fetch_lotto_data(drw)
                    if drw_data:
                        db_data = {
                            "draw_no": drw_data["drwNo"],
                            "date": drw_data["drwNoDate"],
                            "num1": drw_data["drwtNo1"],
                            "num2": drw_data["drwtNo2"],
                            "num3": drw_data["drwtNo3"], 
                            "num4": drw_data["drwtNo4"],
                            "num5": drw_data["drwtNo5"],
                            "num6": drw_data["drwtNo6"], 
                            "bonus": drw_data["bnusNo"]
                        }
                        supabase.table("lotto_draws").upsert(db_data).execute()
                        print(f"[OK] Supabase 동기화 완료: {drw}회차 ({drw_data['drwNoDate']})")
                        db_updated = True
                    else:
                        print(f"[WARN] {drw}회차 데이터를 가져오지 못했습니다. 동기화를 보류합니다.")
            else:
                print("[INFO] Supabase DB가 최신 상태입니다. 동기화할 누락 회차가 없습니다.")
        except Exception as e:
            print(f"[ERROR] Supabase 동기화 중 오류 발생: {e}")
    else:
        print("[WARN] Supabase 환경 변수가 없어 DB 동기화를 생략합니다.")

    # 5. Git Commit/Push 및 웹 배포
    # CSV나 DB가 업데이트된 경우에만 실행
    if csv_updated or db_updated:
        print("\n[DEPLOY] 변경 사항이 확인되어 원스톱 Git Push 및 GitHub Pages 배포 자동화를 시작합니다.")
        
        # Git add
        git_add_ok = run_command(f"git add {CSV_FILE}", "Git CSV 변경 사항 스테이징")
        if not git_add_ok:
            return
            
        # Git commit
        commit_msg = f"Update lotto results up to draw {last_drw_csv}"
        git_commit_ok = run_command(f'git commit -m "{commit_msg}"', "Git 커밋 작성")
        if not git_commit_ok:
            print("[WARN] Git 커밋을 진행하지 않았거나 변경 사항이 없습니다.")
            
        # Git push
        git_push_ok = run_command("git push", "원격 GitHub 저장소 푸시")
        if not git_push_ok:
            print("[WARN] Git Push 실패로 웹 배포를 보류합니다. (수동 푸시 필요)")
            return
            
        # NPM 배포 (npm run deploy -> 내부적으로 npm run build 수행 후 gh-pages에 배포)
        deploy_ok = run_command("npm run deploy", "GitHub Pages 웹 앱 빌드 및 배포")
        if deploy_ok:
            print(f"\n[SUCCESS] 축하합니다! {last_drw_csv}회차까지의 당첨 정보 업데이트 및 라이브 배포가 완벽하게 처리되었습니다.")
        else:
            print("\n[FAIL] 웹 앱 배포 중 에러가 발생했습니다. 'npm run deploy'를 수동으로 실행해 보세요.")
    else:
        print("\n[INFO] 로컬 CSV 및 Supabase DB 모두 변경 사항이 없어 배포 과정을 생략합니다.")

if __name__ == "__main__":
    main()
