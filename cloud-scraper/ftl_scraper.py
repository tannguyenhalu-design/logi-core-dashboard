"""
ftl_scraper.py — kéo danh sách đơn FTL từ portal.ghn.vn (GHN B2B Portal) qua
CDP, dùng chính nút "Xuất dữ liệu" có sẵn trên portal thay vì tự crawl từng
trang (portal có tới hàng trăm trang phân trang, dùng nút xuất Excel có sẵn
đáng tin cậy và nhanh hơn nhiều).

Khác với sheet_scraper.py (đọc CSV qua fetch trong JS), file xuất ra ở đây là
.xlsx thật — nên phải dùng CDP Page.setDownloadBehavior để bắt file tải về,
rồi giao cho sync_ftl_to_db.js (Node, dùng package "xlsx") đọc và đẩy lên
Google Sheet.

Chạy mỗi 30 phút (xem crontab) — không phải 3 lần/ngày như raw_ontime/Rillnet,
vì FTL cần theo dõi sát trong ngày để can thiệp kịp với tài xế.

── BƯỚC 1: Bật Chrome debug, đăng nhập portal.ghn.vn 1 lần (cùng profile với
   các scraper khác) ──
   "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="C:\\chrome-bot-profile"

── BƯỚC 2: chạy ──
   python ftl_scraper.py
"""
import os
import re
import sys
import time
import json
import glob
import requests
import websocket
import subprocess
from datetime import datetime, timedelta

DEBUG_PORT = 9222
PORTAL_BASE = "https://portal.ghn.vn"
DOWNLOAD_DIR = os.environ.get("FTL_DOWNLOAD_DIR", "/app/ftl_downloads")
WINDOW_DAYS = 30  # cửa sổ ngày tạo đơn quét mỗi lần — đủ rộng để không bỏ sót đơn cũ chưa giao xong


def get_websocket_url():
    try:
        response = requests.get(f"http://localhost:{DEBUG_PORT}/json", timeout=10)
        tabs = response.json()
        for tab in tabs:
            if tab["type"] == "page" and "portal.ghn.vn" in tab.get("url", ""):
                return tab["webSocketDebuggerUrl"]
        for tab in tabs:
            if tab["type"] == "page":
                return tab["webSocketDebuggerUrl"]
        return None
    except Exception as e:
        print(f"Khong ket noi duoc Chrome (cong {DEBUG_PORT}): {e}")
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
        print("Loi JS:", resp["result"]["exceptionDetails"])
    return None


CLICK_BY_TEXT_JS = """
(() => {{
  const els = Array.from(document.querySelectorAll('button'));
  const target = els.find(el => el.textContent.trim() === '{text}');
  if (!target) return false;
  target.click();
  return true;
}})();
"""


def click_button(ws, text, wait=2):
    ok = run_js(ws, CLICK_BY_TEXT_JS.format(text=text))
    time.sleep(wait)
    return ok


def main():
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    # Dọn file .xlsx cũ trong thư mục tải về trước khi chạy, để không nhầm
    # với file của lần chạy trước nếu lần này thất bại giữa chừng.
    for f in glob.glob(os.path.join(DOWNLOAD_DIR, "*.xlsx")):
        try:
            os.remove(f)
        except OSError:
            pass

    print("Dang ket noi voi Chrome...")
    ws_url = get_websocket_url()
    if not ws_url:
        sys.exit(1)
    # timeout=20: khong co timeout nay, 1 lenh CDP khong phan hoi se block vo
    # thoi han, giu flock mai mai va chan run_scrapers.sh (LTL) khong bao gio
    # chay duoc — day chinh la nguyen nhan LTL bi dung dong bo 2 ngay lien
    # (20-21/08/2026), da xac nhan qua log (1 lan chay giu lock ~2 tieng).
    # ftl_enrich_vehicle.py da co bao ve nay tu 1 lan su co truoc do; file
    # nay thi chua, gio them cho dong bo.
    ws = websocket.create_connection(ws_url, timeout=20)

    # Cho phép tải file tự động về DOWNLOAD_DIR, không hỏi xác nhận.
    send_cdp_command(ws, "Page.setDownloadBehavior", {
        "behavior": "allow",
        "downloadPath": DOWNLOAD_DIR,
    })

    end = datetime.now()
    start = end - timedelta(days=WINDOW_DAYS)
    start_str = start.strftime("%Y-%m-%dT00:00:00+07:00")
    end_str = end.strftime("%Y-%m-%dT23:59:59+07:00")
    url = f"{PORTAL_BASE}/b2b/orders?start_date={start_str}&end_date={end_str}"

    print(f"Dieu huong toi {url} ...")
    send_cdp_command(ws, "Page.navigate", {"url": url})
    time.sleep(5)

    print("Bam 'Xuat du lieu'...")
    if not click_button(ws, "Xuất dữ liệu", wait=2):
        print("Khong tim thay nut 'Xuat du lieu' - co the chua dang nhap hoac giao dien da doi.")
        ws.close()
        sys.exit(1)

    print("Dang doi file tai ve (toi da 30 giay)...")
    xlsx_path = None
    for _ in range(30):
        files = glob.glob(os.path.join(DOWNLOAD_DIR, "*.xlsx"))
        # Chrome dat ten file dang ".crdownload" khi con dang tai, chi tinh
        # khi da co duoi .xlsx that su va khong con file .crdownload nao.
        pending = glob.glob(os.path.join(DOWNLOAD_DIR, "*.crdownload"))
        if files and not pending:
            xlsx_path = files[0]
            break
        time.sleep(1)

    ws.close()

    if not xlsx_path:
        print("Khong tai duoc file xuat du lieu - kiem tra lai dang nhap/giao dien.")
        sys.exit(1)

    print(f"Da tai xong: {xlsx_path}")
    print("Bat dau day len Google Sheet qua sync_ftl_to_db.js ...")
    try:
        result = subprocess.run(
            ["node", "/app/sync_ftl_to_db.js", xlsx_path],
            capture_output=True, text=True,
        )
        print(result.stdout)
        if result.returncode != 0:
            print("Loi khi chay sync_ftl_to_db.js:")
            print(result.stderr)
            sys.exit(1)
    except Exception as e:
        print(f"Loi: {e}")
        sys.exit(1)

    print("HOAN TAT FTL SCRAPER!")


if __name__ == "__main__":
    main()
