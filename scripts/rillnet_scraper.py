"""
rillnet_scraper.py — Tải dữ liệu bể vỡ/hư hỏng Điện Máy từ Rillnet qua CDP.

Hai luồng sync chạy song song trong cùng 1 phiên Chrome:
  1. CS tick cases (Cách A, 04/10/2026):
     Đọc _LB.bevo.rows từ window JS → filter DM + cs_denbu → push raw_damage_cs_tick.
     Đây là 153-156 ca mà CS đã bấm 💰 Có đền bù — số chắc chắn đền bù.
  2. Daily Excel (AI-detected incidents):
     Gọi bevodaylist + presigned URL → parse Excel → push raw_damage_causes.
     Đây là 5199+ ca AI phát hiện nguy cơ (bao gồm cả CS tick ở trên).

Luồng 1 là nguồn sự thật duy nhất cho "đền bù CS tick"; luồng 2 giữ lại
để có thể tra cứu toàn bộ lịch sử cảnh báo.

── CÀI ĐẶT ──
    pip install requests websocket-client openpyxl

── BƯỚC 1: Bật Chrome debug ──
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        --remote-debugging-port=9222 --remote-allow-origins=*
        --user-data-dir="C:\\chrome-bot-profile" --window-position=-3000,-3000
    Đăng nhập vào rillnet.ghn.vn trong cửa sổ đó.

── BƯỚC 2: Set env var ──
    set RILLNET_SYNC_SECRET=<giá trị trong .env.local>

── BƯỚC 3: Chạy ──
    python scripts\\rillnet_scraper.py
"""

import os
import re
import io
import time
import json
import datetime
import requests
import websocket
import openpyxl

DEBUG_PORT = 9222
TARGET_URL = "https://rillnet.ghn.vn/"
APP_BASE_URL = "https://logicore-app.vercel.app"
SYNC_SECRET = os.environ.get("RILLNET_SYNC_SECRET")

# File lưu ngày sync gần nhất để không phải re-sync toàn bộ mỗi lần chạy
TRACKING_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rillnet_last_sync.txt")
# Overlap: re-sync lại N ngày trước ngày cuối đã sync (bắt cập nhật trên case cũ)
OVERLAP_DAYS = 2
# Batch size khi gọi presigned URL (tránh quá nhiều Promise.all cùng lúc)
URL_BATCH = 10


# ── CDP helpers ──────────────────────────────────────────────────────────────

def get_websocket_url():
    try:
        resp = requests.get(f"http://localhost:{DEBUG_PORT}/json", timeout=5)
        tabs = resp.json()
        for tab in tabs:
            if tab["type"] == "page" and "rillnet-app" in tab.get("url", ""):
                return tab["webSocketDebuggerUrl"]
        for tab in tabs:
            if tab["type"] == "page":
                return tab["webSocketDebuggerUrl"]
        return None
    except Exception as e:
        print(f"❌ Không kết nối được Chrome (cổng {DEBUG_PORT}): {e}")
        print("   Đảm bảo Chrome đang chạy với --remote-debugging-port=9222")
        return None


def send_cdp(ws, method, params=None, timeout=30):
    ws.settimeout(timeout)  # từng recv() đợi tối đa timeout giây (quan trọng với Promise dài)
    msg_id = int(time.time() * 1000) % 1000000
    ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
    deadline = time.time() + timeout
    while time.time() < deadline:
        remaining = deadline - time.time()
        if remaining <= 0:
            break
        ws.settimeout(remaining)
        resp = json.loads(ws.recv())
        if resp.get("id") == msg_id:
            return resp
    raise TimeoutError(f"CDP {method} timeout sau {timeout}s")


def run_js(ws, script, timeout=30):
    resp = send_cdp(ws, "Runtime.evaluate", {
        "expression": script,
        "returnByValue": True,
        "awaitPromise": True,
    }, timeout=timeout)
    r = resp.get("result", {}).get("result", {})
    if "exceptionDetails" in resp.get("result", {}):
        print("⚠️ JS lỗi:", resp["result"]["exceptionDetails"].get("text", ""))
        return None
    return r.get("value")


# ── Tracking file ─────────────────────────────────────────────────────────────

def read_last_sync():
    try:
        with open(TRACKING_FILE) as f:
            return datetime.date.fromisoformat(f.read().strip())
    except Exception:
        return None


def write_last_sync(date):
    with open(TRACKING_FILE, "w") as f:
        f.write(date.isoformat())


# ── CS tick cases (Cách A) ────────────────────────────────────────────────────

def fetch_cs_tick_cases(ws):
    """
    Đọc _LB.bevo.rows từ Rillnet page JS, lọc DM + cs_denbu.
    Trả về (list_of_records, rillnet_reported_count).
    Gọi SAU khi trang đã load (đợi _LB.bevo sẵn sàng).
    """
    print("💰 Đọc CS tick cases từ _LB.bevo.rows...")
    # Trigger load bevo data rồi dùng Python polling (tránh async Promise dài gây WS timeout).
    # _lbLoad() là async fn gọi /api/gtalk-send?op=lostbevo → set _LB.bevo.rows (~6k rows).
    run_js(ws, "(function(){ _lbLoad(); })()", timeout=10)

    CHECK_JS = "JSON.stringify({n: (_LB && _LB.bevo && Array.isArray(_LB.bevo.rows)) ? _LB.bevo.rows.length : -1})"
    EXTRACT_JS = """JSON.stringify((function() {
  if (!_LB || !_LB.bevo || !Array.isArray(_LB.bevo.rows)) return null;
  const rows = _LB.bevo.rows;
  const dm = rows.filter(r => r.nganh_hang === 'DM');
  const dmCs = dm.filter(r => r.cs_denbu);
  return {
    totalRows: rows.length, dmTotal: dm.length, csTickCount: dmCs.length,
    cases: dmCs.map(r => ({
      orderCode: String(r.code || '').trim(),
      clientName: r.khach || '',
      incidentDate: r.sc_d || '',
      warehouse: r.kho || '',
      route: r.chang_txt || '',
      om: r.om || '',
      zone: r.zone || '',
      severity: r.sev || '',
      csBy: r.cs_denbu_ten || '',
      csAt: r.cs_denbu_at || '',
      csAmount: (r.cs_denbu_sotien != null && r.cs_denbu_sotien !== '') ? r.cs_denbu_sotien : '',
      isSettled: r.denbu ? '1' : '0',
      source: r.nguon || '',
    }))
  };
})())"""

    # Polling bằng CDP (không dùng time.sleep - Chrome đóng WS nếu client idle).
    # Mỗi vòng: check đồng bộ, nếu chưa có thì dùng JS setTimeout 2s để chờ (WS vẫn active).
    raw = None
    for attempt in range(30):
        chk = run_js(ws, CHECK_JS, timeout=10)
        try:
            n = json.loads(chk or "{}").get("n", -1)
        except Exception:
            n = -1
        if n > 0:
            print(f"   _LB.bevo.rows đã load ({n} rows) sau ~{attempt * 2}s.")
            raw = run_js(ws, EXTRACT_JS, timeout=20)
            break
        if attempt == 0:
            print(f"   Chờ _LB.bevo.rows load (n={n})...")
        # Dùng CDP để đợi 2s — giữ WS active (không sleep Python)
        run_js(ws, "new Promise(r => setTimeout(r, 2000))", timeout=5)
    else:
        print("⚠️ _LB.bevo.rows chưa load sau 60s — trang chưa đăng nhập hoặc Rillnet lỗi.")
        return [], 0

    if not raw:
        print("⚠️ Không đọc được _LB.bevo.rows — trang chưa load hoặc chưa đăng nhập.")
        return [], 0

    try:
        data = json.loads(raw)
    except Exception as e:
        print(f"⚠️ JSON parse lỗi từ _LB.bevo: {e}")
        return [], 0

    total = data.get("totalRows", 0)
    dm_total = data.get("dmTotal", 0)
    cs_count = data.get("csTickCount", 0)
    cases = data.get("cases", [])

    print(f"   _LB.bevo: {total} tổng | {dm_total} DM | {cs_count} CS tick 💰")
    # Lọc bỏ record thiếu orderCode
    valid = [c for c in cases if c.get("orderCode")]
    if len(valid) < len(cases):
        print(f"   ⚠️ Bỏ {len(cases) - len(valid)} record thiếu orderCode.")
    return valid, cs_count


# ── Excel parsing ─────────────────────────────────────────────────────────────

def _col(headers, fragment):
    """Find column index by substring match (case-insensitive)."""
    frag = fragment.lower()
    for i, h in enumerate(headers):
        if frag in h.lower():
            return i
    return -1


def _cell(row, idx):
    if idx < 0 or idx >= len(row):
        return ""
    v = row[idx]
    return str(v).strip() if v is not None else ""


def _parse_severity(ai_text):
    """'Nặng - rách thùng...' → 'Nặng'"""
    if not ai_text:
        return ""
    level = ai_text.split(" - ", 1)[0].strip()
    for kw in ("Nặng", "Trung bình", "Nhẹ", "Chưa gán"):
        if kw.lower() in level.lower():
            return kw
    return level


def _parse_client(id_name):
    """'4865319 - Aqua B2C' → 'Aqua B2C'"""
    if not id_name:
        return ""
    parts = id_name.split(" - ", 1)
    return parts[1].strip() if len(parts) == 2 else id_name.strip()


def parse_excel(content_bytes, date_str):
    wb = openpyxl.load_workbook(io.BytesIO(content_bytes), read_only=True, data_only=True)
    sheet = None
    for name in wb.sheetnames:
        if any(k in name for k in ("Hư hỏng", "bể vỡ", "ĐTĐM")):
            sheet = wb[name]
            break
    if sheet is None:
        sheet = wb.active

    rows = list(sheet.iter_rows(values_only=True))
    wb.close()
    if not rows:
        return []

    headers = [str(h or "").strip() for h in rows[0]]
    i_order     = _col(headers, "Vận đơn")
    i_client    = _col(headers, "tên khách hàng")
    i_date      = _col(headers, "Ngày giờ")
    i_warehouse = _col(headers, "kho báo")
    i_severity  = _col(headers, "mức độ")
    i_photo     = _col(headers, "hình ảnh")

    records = []
    for row in rows[1:]:
        order_code = _cell(row, i_order)
        if not order_code:
            continue

        raw_date = _cell(row, i_date)
        case_date = raw_date.split(" ")[0] if raw_date else date_str

        records.append({
            "type": "Bể vỡ",
            "source": "Rillnet Daily",
            "orderCode": order_code,
            "clientName": _parse_client(_cell(row, i_client)),
            "detectedAtWarehouse": _cell(row, i_warehouse),
            "suspectedLeg": "",
            "region": "",
            "severity": _parse_severity(_cell(row, i_severity)),
            "status": "",
            "orderStatus": "",
            "caseDate": case_date,
            "photoCount": "1" if _cell(row, i_photo) else "0",
        })
    return records


# ── Compensation summary (Đền bù / Truy thu > Tổng hợp) ─────────────────────

def fetch_compensation(ws):
    """Navigate to Đền bù tổng hợp page, parse summary cards. Returns dict or None."""
    try:
        send_cdp(ws, "Page.navigate", {"url": "https://rillnet.ghn.vn/truythu.html"})
        time.sleep(4)
        # Click Tổng hợp tab
        run_js(ws, """
(() => {
  const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '📊 Tổng hợp');
  if (b) b.click();
})()
""")
        time.sleep(3)
        text = run_js(ws, "document.body.innerText") or ""

        def grab_n(label):
            m = re.search(re.escape(label) + r"\s*\n\s*([\d.,]+)", text)
            return int(m.group(1).replace(".", "").replace(",", "")) if m else None

        def grab_money(label):
            m = re.search(re.escape(label) + r"\s*\n\s*([\d.,]+)đ", text)
            return int(m.group(1).replace(".", "").replace(",", "")) if m else None

        cs_tick = grab_n("CS TICK CÓ ĐỀN BÙ")
        if cs_tick is None:
            return None

        m2 = re.search(r"đã chốt:\s*✅\s*(\d+)\s*·\s*❌\s*(\d+)", text)
        return {
            "csTickCount": cs_tick,
            "opsUnfinalizedCount": grab_n("OPS CHƯA CHỐT ĐỀN BÙ"),
            "opsApprovedCount": int(m2.group(1)) if m2 else None,
            "opsRejectedCount": int(m2.group(2)) if m2 else None,
            "opsClawbackCount": grab_n("ĐÃ CHỐT CÓ TRUY THU"),
            "totalAmount": grab_money("TỔNG TIỀN ĐỀN BÙ"),
        }
    except Exception as e:
        print(f"⚠️ Không đọc được tổng hợp đền bù: {e}")
        return None


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    if not SYNC_SECRET:
        print("❌ Chưa set biến môi trường RILLNET_SYNC_SECRET.")
        print("   set RILLNET_SYNC_SECRET=<giá trị trong .env.local>")
        return

    print("🤖 Đang kết nối với Chrome...")
    ws_url = get_websocket_url()
    if not ws_url:
        return
    print(f"✅ Đã kết nối: {ws_url}")
    ws = websocket.create_connection(ws_url, timeout=30)

    # Điều hướng tới Rillnet để lấy auth session
    print(f"🚀 Điều hướng tới {TARGET_URL} ...")
    send_cdp(ws, "Page.navigate", {"url": TARGET_URL})
    print("⏳ Đợi trang load (15 giây)...")
    time.sleep(15)

    # Kiểm tra đã đăng nhập chưa
    page_text = run_js(ws, "document.body?.innerText?.slice(0, 300)") or ""
    if "sign in" in page_text.lower() or "đăng nhập" in page_text.lower():
        print("❌ Chưa đăng nhập vào Rillnet trong Chrome bot profile.")
        print("   Mở Chrome với --user-data-dir=C:\\chrome-bot-profile và đăng nhập trước.")
        ws.close()
        return
    print(f"✅ Đã vào Rillnet (title: {run_js(ws, 'document.title') or 'N/A'})")

    # ── Luồng 1: CS tick cases từ _LB.bevo.rows ──────────────────────────────
    # Đọc và push ngay trước khi navigate sang trang khác.
    cs_tick_records, rillnet_cs_count = fetch_cs_tick_cases(ws)
    if cs_tick_records:
        print(f"☁️  Đẩy {len(cs_tick_records)} CS tick cases lên {APP_BASE_URL}/api/rillnet-cs-sync...")
        try:
            res_cs = requests.post(
                f"{APP_BASE_URL}/api/rillnet-cs-sync",
                headers={"Content-Type": "application/json", "X-Sync-Secret": SYNC_SECRET},
                json={"records": cs_tick_records, "rillnetCount": rillnet_cs_count},
                timeout=60,
            )
            if res_cs.status_code == 200:
                body = res_cs.json()
                synced_cs = body.get("synced", 0)
                mismatch = body.get("mismatch", False)
                print(f"✅ CS tick: {synced_cs} ca OK (Rillnet báo {rillnet_cs_count}){' ⚠️ LỆCH SỐ!' if mismatch else ''}")
            else:
                print(f"❌ CS tick sync lỗi: HTTP {res_cs.status_code} — {res_cs.text[:200]}")
        except Exception as e:
            print(f"❌ CS tick sync lỗi: {e}")
    else:
        print("⚠️ Không có CS tick record (Rillnet chưa load xong hoặc chưa đăng nhập).")

    # ── Luồng 2: Daily Excel (AI-detected incidents) ──────────────────────────
    # Lấy danh sách file ngày từ API
    print("📋 Đang gọi bevodaylist API...")
    raw = run_js(ws, """
(async () => {
  try { return JSON.stringify(await _agApi('bevodaylist')); }
  catch(e) { return JSON.stringify({ok: false, error: e.message}); }
})()
""", timeout=30)

    if not raw:
        print("❌ Không gọi được bevodaylist — kiểm tra đăng nhập Rillnet.")
        ws.close()
        return

    api_data = json.loads(raw)
    if not api_data.get("ok"):
        print(f"❌ bevodaylist lỗi: {api_data.get('error', '?')}")
        ws.close()
        return

    # Lọc chỉ lấy file có ngày (bỏ backlog) và n > 0
    all_items = api_data.get("items", [])
    date_items = [
        it for it in all_items
        if re.match(r"^\d{4}-\d{2}-\d{2}$", it.get("key", "")) and it.get("n", 0) > 0
    ]
    date_items.sort(key=lambda x: x["key"])
    print(f"📅 {len(date_items)} file ngày có dữ liệu (n>0) trên Rillnet.")

    # Xác định khoảng ngày cần sync
    last_synced = read_last_sync()
    today = datetime.date.today()

    if last_synced is None:
        cutoff = datetime.date(2026, 7, 1)
        print(f"🔄 Lần đầu chạy — backfill từ {cutoff} đến nay.")
    else:
        cutoff = last_synced - datetime.timedelta(days=OVERLAP_DAYS)
        print(f"🔄 Sync từ {cutoff} (last: {last_synced}, overlap: {OVERLAP_DAYS}d).")

    to_sync = [it for it in date_items if datetime.date.fromisoformat(it["key"]) >= cutoff]
    print(f"📦 Sẽ xử lý {len(to_sync)} file ngày.")

    if not to_sync:
        print("✅ Không có file mới, bỏ qua.")
        ws.close()
        return

    # Lấy presigned URL theo batch để tránh quá tải
    print(f"🔗 Đang lấy presigned URL (batch {URL_BATCH})...")
    file_urls = {}  # date_str → presigned_url

    for i in range(0, len(to_sync), URL_BATCH):
        batch = to_sync[i:i + URL_BATCH]
        file_ids = [f"sb:bevo_daily/{it['file']}" for it in batch]
        keys = [it["key"] for it in batch]

        js = f"""
(async () => {{
  const ids = {json.dumps(file_ids)};
  const results = await Promise.all(
    ids.map(id => _agApi('file', {{fileId: id}}).catch(e => ({{ok: false, error: e.message}})))
  );
  return JSON.stringify(results);
}})()
"""
        raw_urls = run_js(ws, js, timeout=60)
        if not raw_urls:
            print(f"  ⚠️ Batch {i//URL_BATCH+1}: không lấy được URL, bỏ qua {len(batch)} ngày.")
            continue

        results = json.loads(raw_urls)
        for key, res in zip(keys, results):
            if res.get("ok") and res.get("url"):
                file_urls[key] = res["url"]
            else:
                print(f"  ⚠️ {key}: {res.get('error', 'Lỗi URL')}")

        print(f"  Batch {i//URL_BATCH+1}/{(len(to_sync)-1)//URL_BATCH+1}: {sum(1 for k in keys if k in file_urls)}/{len(batch)} URL OK")

    print(f"🔗 Lấy được {len(file_urls)}/{len(to_sync)} presigned URL.")

    # Download và parse từng file Excel
    all_records = []
    for it in to_sync:
        date_str = it["key"]
        n_expected = it.get("n", 0)
        url = file_urls.get(date_str)
        if not url:
            continue
        try:
            resp = requests.get(url, timeout=30)
            if resp.status_code != 200:
                print(f"  ⚠️ {date_str}: HTTP {resp.status_code}")
                continue
            records = parse_excel(resp.content, date_str)
            print(f"  📄 {date_str}: {len(records)} ca (file báo {n_expected})")
            all_records.extend(records)
        except Exception as e:
            print(f"  ⚠️ {date_str}: {e}")

    # Đọc tổng hợp đền bù
    print("💰 Đọc tổng hợp đền bù / truy thu...")
    compensation_summary = fetch_compensation(ws)
    if compensation_summary:
        print(f"   CS tick: {compensation_summary['csTickCount']} đơn, tổng {compensation_summary.get('totalAmount')}đ")
    else:
        print("   ⚠️ Không đọc được (bỏ qua, không ảnh hưởng sync ca).")

    ws.close()

    if not all_records:
        print("⚠️ Không có bản ghi nào để sync.")
        return

    # Đẩy lên Logicore theo batch (Vercel body limit ~1MB)
    PUSH_BATCH = 400
    total_synced = 0
    failed = False
    headers_http = {"Content-Type": "application/json", "X-Sync-Secret": SYNC_SECRET}

    batches = [all_records[i:i + PUSH_BATCH] for i in range(0, len(all_records), PUSH_BATCH)]
    print(f"☁️  Đẩy {len(all_records)} bản ghi lên {APP_BASE_URL}/api/rillnet-sync ({len(batches)} batch)...")

    for idx, batch in enumerate(batches):
        # Chỉ gửi compensationSummary ở batch cuối
        payload = {"records": batch}
        if idx == len(batches) - 1 and compensation_summary:
            payload["compensationSummary"] = compensation_summary
        try:
            res = requests.post(
                f"{APP_BASE_URL}/api/rillnet-sync",
                headers=headers_http,
                json=payload,
                timeout=120,
            )
            if res.status_code == 200:
                synced = res.json().get("synced", 0)
                total_synced += synced
                print(f"  Batch {idx+1}/{len(batches)}: {synced} ca OK")
            else:
                print(f"  Batch {idx+1}/{len(batches)}: HTTP {res.status_code} — {res.text[:200]}")
                failed = True
                break
        except Exception as e:
            print(f"  Batch {idx+1}/{len(batches)}: lỗi — {e}")
            failed = True
            break

    if not failed:
        print(f"✅ Tổng đã đồng bộ {total_synced} ca bể vỡ/hư hỏng!")
        write_last_sync(today)
        print(f"📝 Lưu ngày sync: {today}")
    else:
        print("❌ Một số batch thất bại — tracking file KHÔNG được cập nhật.")


if __name__ == "__main__":
    main()
