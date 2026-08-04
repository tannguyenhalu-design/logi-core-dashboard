"""
kpi_scraper.py — cào dữ liệu Plan/RR-NSR từ kpi-dashboard-portal.vercel.app
qua CDP (Chrome DevTools Protocol), rồi đẩy thẳng lên SD3-Điện Máy Dashboard
để tự động cập nhật "Doanh Thu Dự Kiến" + "Last Mo. NSR" theo Client ID.

Trang KPI không dùng thẻ <table> — dữ liệu là 1 grid dạng div. Script này
đọc document.body.innerText (đã vào đúng view "Client Radar > Client
Breakdown") rồi tự parse text thành từng dòng khách hàng, neo theo 2 cột có
giá trị cố định (NGÀNH HÀNG, R/N) để tách đúng ranh giới từng dòng — không
phụ thuộc cấu trúc DOM cụ thể nên khá bền với thay đổi giao diện nhỏ.

── CÀI ĐẶT ──
    pip install requests websocket-client

── BƯỚC 1: Bật Chrome chế độ debug (đóng hết Chrome đang mở trước) ──
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="C:\\chrome-bot-profile"

    Trong cửa sổ Chrome vừa mở, đăng nhập Google + vào
    https://kpi-dashboard-portal.vercel.app/ một lần cho chắc trước khi chạy
    script (để phiên đăng nhập được lưu vào profile "chrome-bot-profile" —
    lần sau không cần đăng nhập lại).

── BƯỚC 2: Đặt biến môi trường KPI_SYNC_SECRET khớp giá trị trong
   .env.local / Vercel của app (KHÔNG hardcode secret vào file này) ──
    set KPI_SYNC_SECRET=85c590ad34783c6cd6994b044c7fdca35d0d109b020c56fa

── BƯỚC 3: Chạy (trong cùng cửa sổ CMD vừa set biến môi trường) ──
    python kpi_scraper.py

Script tự bấm RADAR > Client Breakdown, đợi bảng load, bóc theo Client ID,
rồi POST lên API /api/kpi-sync — match đúng dự án theo Client ID và cập
nhật "Doanh Thu Dự Kiến" (Plan tuần mới nhất) + "Last Mo. NSR". Dự án nào
không có Client ID khớp sẵn trong Sheet thì bị bỏ qua, không tạo mới.
"""

import os
import re
import time
import json
import requests
import websocket

# ── CẤU HÌNH ──
DEBUG_PORT = 9222
TARGET_URL = "https://kpi-dashboard-portal.vercel.app/"
APP_BASE_URL = "https://logicore-app.vercel.app"
SYNC_SECRET = os.environ.get("KPI_SYNC_SECRET")  # set qua biến môi trường, không hardcode

INDUSTRIES = ["B2B Chung", "Siêu thị thực phẩm", "Điện tử / Điện máy"]
RNS = ["R", "N0", "N2", "N3", "N4"]


def get_websocket_url():
    try:
        response = requests.get(f"http://localhost:{DEBUG_PORT}/json")
        tabs = response.json()
        for tab in tabs:
            if tab["type"] == "page" and "kpi-dashboard-portal" in tab.get("url", ""):
                return tab["webSocketDebuggerUrl"]
        for tab in tabs:
            if tab["type"] == "page":
                return tab["webSocketDebuggerUrl"]
        return None
    except Exception as e:
        print(f"❌ Không kết nối được Chrome (cổng {DEBUG_PORT}): {e}")
        print("   Đảm bảo đã bật Chrome bằng --remote-debugging-port=9222 --remote-allow-origins=*")
        return None


def send_cdp_command(ws, method, params=None):
    msg = {"id": int(time.time() * 1000) % 1000000, "method": method, "params": params or {}}
    ws.send(json.dumps(msg))
    while True:
        resp = json.loads(ws.recv())
        if resp.get("id") == msg["id"]:
            return resp


def run_js(ws, script):
    resp = send_cdp_command(ws, "Runtime.evaluate", {
        "expression": script,
        "returnByValue": True,
    })
    if "result" in resp and "result" in resp["result"]:
        return resp["result"]["result"].get("value")
    if "exceptionDetails" in resp.get("result", {}):
        print("⚠️ Lỗi JS:", resp["result"]["exceptionDetails"])
    return None


CLICK_BY_TEXT_JS = """
(() => {{
  const els = Array.from(document.querySelectorAll('button'));
  const target = els.find(el => el.textContent.trim() === '{text}' || el.textContent.trim().startsWith('{text}'));
  if (!target) return false;
  target.click();
  return true;
}})();
"""


def click_button(ws, text, wait=2):
    ok = run_js(ws, CLICK_BY_TEXT_JS.format(text=text))
    time.sleep(wait)
    return ok


def parse_money(text):
    if not text or text.strip() == "—":
        return None
    cleaned = re.sub(r"[^\d.\-]", "", text)
    try:
        num = float(cleaned)
    except ValueError:
        return None
    return round(num * 1_000_000)  # portal shows values in "M" (triệu)


def parse_client_rows(raw_text):
    """Tách raw innerText thành từng dòng khách hàng, neo theo cột NGÀNH HÀNG + R/N."""
    start_marker_candidates = ["GAP W", "GAP"]
    start_idx = -1
    for marker in start_marker_candidates:
        idx = raw_text.rfind(marker)  # last occurrence = end of header row
        if idx != -1:
            start_idx = raw_text.find("\n", idx) + 1
            break
    end_idx = raw_text.rfind("B2B INTELLIGENCE PORTAL")
    if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
        return []

    data_text = raw_text[start_idx:end_idx]
    tokens = [t for t in re.split(r"[\t\n]+", data_text) if t.strip()]

    records = []
    i, n = 0, len(tokens)
    while i < n:
        j = i + 1
        found = False
        while j < n and j < i + 8:
            if tokens[j] in INDUSTRIES:
                found = True
                break
            j += 1
        if not found:
            i += 1
            continue
        client_id = tokens[i]
        name = " ".join(tokens[i + 1:j])
        rn = tokens[j + 1] if j + 1 < n else None
        nums = tokens[j + 2:j + 9]
        if rn not in RNS or len(nums) < 7:
            i += 1
            continue
        # nums = [LAST MO NSR, PLAN ORIGIN, PLAN W(prev), PLAN W(current), RR/NSR, GAP vs RR, GAP vs NSR]
        records.append({
            "clientId": client_id,
            "name": name,
            "lastMoNsr": parse_money(nums[0]),
            "planRevenue": parse_money(nums[3]),
        })
        i = j + 9
    return records


def main():
    if not SYNC_SECRET:
        print("❌ Chưa set biến môi trường KPI_SYNC_SECRET. Chạy:")
        print("   set KPI_SYNC_SECRET=<giá trị trong .env.local của app>")
        print("   rồi chạy lại python kpi_scraper.py trong cùng cửa sổ.")
        return

    print("🤖 Đang kết nối với Chrome...")
    ws_url = get_websocket_url()
    if not ws_url:
        return
    print(f"✅ Đã kết nối: {ws_url}")
    ws = websocket.create_connection(ws_url)

    print(f"🚀 Điều hướng tới {TARGET_URL} ...")
    send_cdp_command(ws, "Page.navigate", {"url": TARGET_URL})
    print("⏳ Đợi trang render (6 giây)...")
    time.sleep(6)

    print("🖱️  Bấm RADAR...")
    if not click_button(ws, "RADAR"):
        print("⚠️ Không tìm thấy nút RADAR — có thể chưa đăng nhập, hoặc giao diện đã đổi.")

    print("🖱️  Bấm Client Breakdown...")
    if not click_button(ws, "Client Breakdown", wait=2):
        print("⚠️ Không tìm thấy 'Client Breakdown' trong menu RADAR.")

    print("⏳ Đợi bảng dữ liệu load xong (tối đa 20 giây)...")
    raw_text = ""
    for _ in range(10):
        raw_text = run_js(ws, "document.body.innerText") or ""
        if "0/0 KHÁCH HÀNG" not in raw_text and "KHÁCH HÀNG" in raw_text:
            break
        time.sleep(2)

    print("💉 Đang parse dữ liệu theo Client ID...")
    ws.close()

    if not raw_text:
        print("❌ Không đọc được nội dung trang.")
        return

    records = parse_client_rows(raw_text)
    print(f"📊 Parse được {len(records)} khách hàng.")
    if not records:
        print("⚠️ 0 dòng — kiểm tra lại đã đăng nhập/đúng view chưa. Nội dung trang:")
        print(raw_text[:500])
        return

    print(f"☁️  Đang đẩy {len(records)} dòng lên {APP_BASE_URL}/api/kpi-sync ...")
    try:
        res = requests.post(
            f"{APP_BASE_URL}/api/kpi-sync",
            headers={"Content-Type": "application/json", "X-Sync-Secret": SYNC_SECRET},
            json={"records": records},
            timeout=30,
        )
        print(f"↩️  Phản hồi: {res.status_code}")
        if res.status_code == 200:
            data = res.json()
            print(f"✅ Đã khớp và cập nhật {data.get('matched', 0)} dự án theo Client ID:")
            for u in data.get("updated", []):
                print(f"   - {u['name']} (ID {u['clientId']}): Plan={u['planRevenue']}, LastMoNSR={u['lastMoNsr']}")
        else:
            print(res.text)
    except Exception as e:
        print("❌ Gửi lên app thất bại:", e)


if __name__ == "__main__":
    main()
