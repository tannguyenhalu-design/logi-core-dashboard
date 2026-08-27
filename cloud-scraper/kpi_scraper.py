"""
kpi_scraper.py (cloud version) — same logic as scripts/kpi_scraper.py on the
local machine, just pointed at the container's own Chrome (localhost:9222,
same as local) and reading the sync secret from the environment directly
(Railway injects env vars — no .env.local file to parse here).
"""
import os
import re
import sys
import time
import json
import requests
import websocket

DEBUG_PORT = 9222
TARGET_URL = "https://kpi-dashboard-portal.vercel.app/"
APP_BASE_URL = "https://logicore-app.vercel.app"
SYNC_SECRET = os.environ.get("KPI_SYNC_SECRET")

INDUSTRIES = ["B2B Chung", "Siêu thị thực phẩm", "Điện tử / Điện máy"]
RNS = ["R", "N0", "N2", "N3", "N4"]


def get_websocket_url():
    try:
        response = requests.get(f"http://localhost:{DEBUG_PORT}/json", timeout=10)
        tabs = response.json()
        for tab in tabs:
            if tab["type"] == "page" and "kpi-dashboard-portal" in tab.get("url", ""):
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
    })
    if "result" in resp and "result" in resp["result"]:
        return resp["result"]["result"].get("value")
    if "exceptionDetails" in resp.get("result", {}):
        print("Loi JS:", resp["result"]["exceptionDetails"])
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


# The portal added a "SEN" AI-assistant landing screen that now renders on
# every fresh navigation, in front of the classic SEN/PIPELINE/RADAR nav bar
# — confirmed live 2026-08-24 (screenshots), this is why "Bam RADAR" below
# started failing "khong tim thay": RADAR isn't gone, this new screen is
# just covering it on load. It has its own quick-link shortcuts though
# ("Radar · Client Breakdown" etc.) that jump straight past it into the
# real dashboard.
#
# Tried finding the button by text + getBoundingClientRect() first, but its
# containing element wasn't the actual clickable leaf (text-search matched
# an ancestor), so the dispatched click landed on nothing — confirmed live:
# reported "clicked" but the screen never left SEN. A manual click at a
# fixed pixel coordinate on this same screen DID work reliably (this SEN
# landing layout doesn't depend on data, only on the fixed 1280x800 window
# Chrome launches with — see Dockerfile/entrypoint.sh), so hardcode that
# instead. Fragile if the layout changes, but working now beats an elegant
# selector that silently no-ops.
SEN_CLIENT_BREAKDOWN_COORDS = (637, 542)


def click_at(ws, x, y, wait=2):
    send_cdp_command(ws, "Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": 1})
    send_cdp_command(ws, "Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": 1})
    time.sleep(wait)


def parse_money(text):
    if not text or text.strip() == "—":
        return None
    cleaned = re.sub(r"[^\d.\-]", "", text)
    try:
        num = float(cleaned)
    except ValueError:
        return None
    return round(num * 1_000_000)


def parse_client_rows(raw_text):
    start_marker_candidates = ["GAP W", "GAP"]
    start_idx = -1
    for marker in start_marker_candidates:
        idx = raw_text.rfind(marker)
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
        # Portal has 8 numeric columns after R/N — see scripts/kpi_scraper.py
        # for the full explanation of why this must be 8, not 7.
        nums = tokens[j + 2:j + 10]
        if rn not in RNS or len(nums) < 8:
            i += 1
            continue
        records.append({
            "clientId": client_id,
            "name": name,
            "lastMoNsr": parse_money(nums[0]),
            "planRevenue": parse_money(nums[3]),
            "rrNsr": parse_money(nums[4]),
        })
        i = j + 10
    return records


def main():
    if not SYNC_SECRET:
        print("Chua co bien moi truong KPI_SYNC_SECRET.")
        sys.exit(1)

    print("Dang ket noi voi Chrome...")
    ws_url = get_websocket_url()
    if not ws_url:
        sys.exit(1)
    print(f"Da ket noi: {ws_url}")
    # timeout=20: khong co timeout nay, 1 lenh CDP khong phan hoi se block vo
    # thoi han, giu chung flock voi run_ftl_scraper.sh mai mai (xem
    # ftl_scraper.py — su co that 20-21/08/2026 la chieu nguoc lai: FTL treo
    # chan LTL 2 ngay lien).
    ws = websocket.create_connection(ws_url, timeout=20)

    print(f"Dieu huong toi {TARGET_URL} ...")
    send_cdp_command(ws, "Page.navigate", {"url": TARGET_URL})
    time.sleep(6)

    print("Bam qua man hinh SEN (neu co)...")
    click_at(ws, *SEN_CLIENT_BREAKDOWN_COORDS, wait=3)
    landed = run_js(ws, "document.body.innerText.includes('KHÁCH HÀNG')")

    if landed:
        print("Da bam thang vao Radar > Client Breakdown tu man hinh SEN.")
    else:
        # Man hinh SEN khong xuat hien, hoac click toa do truot muc tieu —
        # di theo duong cu: bam RADAR roi bam Client Breakdown.
        print("Khong vao duoc qua man hinh SEN, thu duong cu...")
        print("Bam RADAR...")
        if not click_button(ws, "RADAR"):
            print("Khong tim thay nut RADAR - co the chua dang nhap.")

        print("Bam Client Breakdown...")
        if not click_button(ws, "Client Breakdown", wait=2):
            print("Khong tim thay 'Client Breakdown' trong menu RADAR.")

    raw_text = ""
    for _ in range(10):
        raw_text = run_js(ws, "document.body.innerText") or ""
        if "0/0 KHÁCH HÀNG" not in raw_text and "KHÁCH HÀNG" in raw_text:
            break
        time.sleep(2)

    ws.close()

    if not raw_text:
        print("Khong doc duoc noi dung trang.")
        sys.exit(1)

    records = parse_client_rows(raw_text)
    print(f"Parse duoc {len(records)} khach hang.")
    if not records:
        print("0 dong - kiem tra lai da dang nhap/dung view chua.")
        sys.exit(1)

    try:
        res = requests.post(
            f"{APP_BASE_URL}/api/kpi-sync",
            headers={"Content-Type": "application/json", "X-Sync-Secret": SYNC_SECRET},
            json={"records": records},
            timeout=30,
        )
        print(f"Phan hoi: {res.status_code}")
        if res.status_code == 200:
            data = res.json()
            print(f"Da khop va cap nhat {data.get('matched', 0)} du an.")
        else:
            print(res.text)
            sys.exit(1)
    except Exception as e:
        print("Gui len app that bai:", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
