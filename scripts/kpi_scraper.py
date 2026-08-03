"""
kpi_scraper.py — cào dữ liệu Plan/RR-NSR từ kpi-dashboard-portal.vercel.app
qua CDP (Chrome DevTools Protocol), rồi đẩy thẳng lên SD3-Điện Máy Dashboard
để tự động cập nhật "Doanh Thu Dự Kiến" + "Last Mo. NSR" theo Client ID.

── CÀI ĐẶT ──
    pip install requests websocket-client

── BƯỚC 1: Bật Chrome chế độ debug (đóng hết Chrome đang mở trước) ──
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\\chrome-bot-profile"

    Trong cửa sổ Chrome vừa mở, đăng nhập Google + vào
    https://kpi-dashboard-portal.vercel.app/ một lần cho chắc trước khi chạy
    script (để phiên đăng nhập được lưu vào profile "chrome-bot-profile" —
    lần sau không cần đăng nhập lại).

── BƯỚC 2: Đặt biến môi trường KPI_SYNC_SECRET khớp giá trị trong
   .env.local / Vercel của app (KHÔNG hardcode secret vào file này) ──
    set KPI_SYNC_SECRET=85c590ad34783c6cd6994b044c7fdca35d0d109b020c56fa

── BƯỚC 3: Chạy (trong cùng cửa sổ CMD vừa set biến môi trường) ──
    python kpi_scraper.py

Script sẽ tự mở tab đến trang KPI, đợi load, bóc bảng dữ liệu theo Client ID,
rồi POST lên API /api/kpi-sync của app — match đúng dự án theo Client ID và
cập nhật "Doanh Thu Dự Kiến" (Plan tuần hiện tại) + "Last Mo. NSR".
Dự án nào không có Client ID khớp sẵn trong Sheet thì bị bỏ qua, không tạo
mới — chỉ cập nhật số cho các dự án đã có sẵn.
"""

import os
import requests
import websocket
import json
import time

# ── CẤU HÌNH ──
DEBUG_PORT = 9222
TARGET_URL = "https://kpi-dashboard-portal.vercel.app/"
APP_BASE_URL = "https://logicore-app.vercel.app"
SYNC_SECRET = os.environ.get("KPI_SYNC_SECRET")  # set qua biến môi trường, không hardcode


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
        print("   Đảm bảo đã bật Chrome bằng --remote-debugging-port=9222")
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
        "awaitPromise": True,
    })
    if "result" in resp and "result" in resp["result"]:
        val = resp["result"]["result"].get("value")
        return val
    if "exceptionDetails" in resp.get("result", {}):
        print("⚠️ Lỗi JS:", resp["result"]["exceptionDetails"])
    return None


EXTRACT_JS = r"""
(() => {
  const table = document.querySelector('table');
  if (!table) return { error: 'Khong tim thay the <table> nao tren trang.' };
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length < 2) return { error: 'Bang khong co du lieu (it hon 2 dong).' };

  const headerCells = Array.from(rows[0].querySelectorAll('th, td')).map(c => (c.innerText || '').trim());

  let lastMoIdx = headerCells.findIndex(h => /last\s*mo\.?\s*nsr/i.test(h));
  let planIdx = -1;
  headerCells.forEach((h, i) => { if (/plan\s*w\s*\d+/i.test(h)) planIdx = i; });
  if (planIdx === -1) planIdx = headerCells.findIndex(h => /plan\s*origin/i.test(h));

  const parseMoney = (text) => {
    if (!text) return null;
    const cleaned = String(text).replace(/[^\d.,-]/g, '').replace(/,/g, '');
    const num = parseFloat(cleaned);
    if (isNaN(num)) return null;
    return Math.round(num * 1000000); // portal shows values in "M" (triệu)
  };

  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = Array.from(rows[i].querySelectorAll('td'));
    if (cells.length === 0) continue;
    const clientId = (cells[0]?.innerText || '').trim();
    if (!clientId) continue;
    records.push({
      clientId,
      planRevenue: planIdx !== -1 ? parseMoney(cells[planIdx]?.innerText) : null,
      lastMoNsr: lastMoIdx !== -1 ? parseMoney(cells[lastMoIdx]?.innerText) : null,
    });
  }
  return { headerCells, planIdx, lastMoIdx, count: records.length, records };
})();
"""


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

    print("💉 Đang bóc dữ liệu bảng theo Client ID...")
    result = run_js(ws, EXTRACT_JS)
    ws.close()

    if not result or result.get("error"):
        print("❌ Bóc dữ liệu thất bại:", result.get("error") if result else "Không có phản hồi.")
        print("   → Kiểm tra lại đã đăng nhập vào trang KPI chưa, hoặc gửi lại")
        print("     cấu trúc trang (F12 > Elements) để chỉnh lại script.")
        return

    print(f"📊 Tìm thấy {result['count']} dòng. Cột Plan dùng: index {result['planIdx']}"
          f" | Cột Last Mo NSR: index {result['lastMoIdx']}")
    print("   Header:", result["headerCells"])

    records = result["records"]
    if not records:
        print("⚠️ Không có dòng nào để đồng bộ.")
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
        print(res.text)
        if res.status_code == 200:
            data = res.json()
            print(f"✅ Đã khớp và cập nhật {data.get('matched', 0)} dự án theo Client ID.")
    except Exception as e:
        print("❌ Gửi lên app thất bại:", e)


if __name__ == "__main__":
    main()
