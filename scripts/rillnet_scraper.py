"""
rillnet_scraper.py — cào dữ liệu bể vỡ/hư hỏng (kèm nguyên nhân theo chặng)
từ rillnet-app.vercel.app qua CDP (Chrome DevTools Protocol), đẩy lên
SD3-Điện Máy Dashboard để hiện breakdown nguyên nhân trên "AI Insights".

Khác với kpi_scraper.py (phải tự parse innerText theo token vị trí), trang
báo cáo bể vỡ của Rillnet render ra một <table> thật — script này đọc thẳng
DOM table qua JS, không đoán vị trí cột nên không bị lệch khi có ô trống.

── CÀI ĐẶT ──
    pip install requests websocket-client

── BƯỚC 1: Bật Chrome chế độ debug (đóng hết Chrome đang mở trước) ──
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="C:\\chrome-bot-profile"

    Trong cửa sổ Chrome vừa mở, đăng nhập Google + vào
    https://rillnet-app.vercel.app/ một lần cho chắc trước khi chạy script
    (để phiên đăng nhập được lưu vào profile "chrome-bot-profile" — lần
    sau không cần đăng nhập lại). Cùng profile này cũng dùng cho
    kpi_scraper.py nên chỉ cần đăng nhập 1 lần cho cả 2.

── BƯỚC 2: Đặt biến môi trường RILLNET_SYNC_SECRET khớp giá trị trong
   .env.local / Vercel của app (KHÔNG hardcode secret vào file này) ──
    set RILLNET_SYNC_SECRET=<giá trị trong .env.local>

── BƯỚC 3: Chạy (trong cùng cửa sổ CMD vừa set biến môi trường) ──
    python rillnet_scraper.py
"""

import os
import time
import json
import requests
import websocket

DEBUG_PORT = 9222
TARGET_URL = "https://rillnet-app.vercel.app/"
APP_BASE_URL = "https://logicore-app.vercel.app"
SYNC_SECRET = os.environ.get("RILLNET_SYNC_SECRET")


def get_websocket_url():
    try:
        response = requests.get(f"http://localhost:{DEBUG_PORT}/json")
        tabs = response.json()
        for tab in tabs:
            if tab["type"] == "page" and "rillnet-app" in tab.get("url", ""):
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
        "awaitPromise": True,
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


EXTRACT_TABLE_JS = """
(() => {
  const table = document.querySelector('table');
  if (!table) return null;
  const rows = [...table.querySelectorAll('tr')];
  return rows.slice(1).map(r => {
    const cells = [...r.querySelectorAll('td')].map(c => c.innerText.trim());
    return {
      type: cells[0] || '', source: cells[1] || '', orderCode: cells[2] || '',
      clientName: cells[3] || '', detectedAtWarehouse: cells[4] || '',
      suspectedLeg: cells[5] || '', region: cells[6] || '', severity: cells[7] || '',
      status: cells[8] || '', orderStatus: cells[9] || '', caseDate: cells[10] || '',
      photoCount: (cells[11] || '').match(/\\d+/) ? (cells[11] || '').match(/\\d+/)[0] : '0',
    };
  });
})();
"""


def main():
    if not SYNC_SECRET:
        print("❌ Chưa set biến môi trường RILLNET_SYNC_SECRET. Chạy:")
        print("   set RILLNET_SYNC_SECRET=<giá trị trong .env.local của app>")
        print("   rồi chạy lại python rillnet_scraper.py trong cùng cửa sổ.")
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

    print("🖱️  Bấm 'Báo cáo bể vỡ'...")
    if not click_button(ws, "📦 Báo cáo bể vỡ", wait=3):
        print("⚠️ Không tìm thấy nút 'Báo cáo bể vỡ' — có thể chưa đăng nhập, hoặc giao diện đã đổi.")

    print("⏳ Đợi bảng dữ liệu load xong (tối đa 15 giây)...")
    records = None
    for _ in range(8):
        records = run_js(ws, EXTRACT_TABLE_JS)
        if records:
            break
        time.sleep(2)

    ws.close()

    if not records:
        print("❌ Không đọc được bảng dữ liệu — kiểm tra lại đăng nhập/giao diện.")
        return

    print(f"📊 Đọc được {len(records)} ca bể vỡ/hư hỏng.")

    print(f"☁️  Đang đẩy {len(records)} bản ghi lên {APP_BASE_URL}/api/rillnet-sync ...")
    try:
        res = requests.post(
            f"{APP_BASE_URL}/api/rillnet-sync",
            headers={"Content-Type": "application/json", "X-Sync-Secret": SYNC_SECRET},
            json={"records": records},
            timeout=30,
        )
        print(f"↩️  Phản hồi: {res.status_code}")
        if res.status_code == 200:
            data = res.json()
            print(f"✅ Đã đồng bộ {data.get('synced', 0)} ca bể vỡ/hư hỏng!")
        else:
            print(res.text)
    except Exception as e:
        print("❌ Gửi lên app thất bại:", e)


if __name__ == "__main__":
    main()
