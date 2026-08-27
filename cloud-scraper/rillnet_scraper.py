"""
rillnet_scraper.py (cloud version) — same CDP approach as the local machine,
reads RILLNET_SYNC_SECRET directly from the environment (Railway variable).
"""
import os
import re
import sys
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
        response = requests.get(f"http://localhost:{DEBUG_PORT}/json", timeout=10)
        tabs = response.json()
        for tab in tabs:
            if tab["type"] == "page" and "rillnet-app" in tab.get("url", ""):
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


def parse_compensation_summary(text):
    def grab_number_after(label):
        m = re.search(re.escape(label) + r"\s*\n\s*([\d.,]+)", text)
        return int(m.group(1).replace(".", "").replace(",", "")) if m else None

    def grab_money_after(label):
        m = re.search(re.escape(label) + r"\s*\n\s*([\d.,]+)đ", text)
        return int(m.group(1).replace(".", "").replace(",", "")) if m else None

    cs_tick_count = grab_number_after("CS TICK CÓ ĐỀN BÙ")
    ops_unfinalized_count = grab_number_after("OPS CHƯA CHỐT ĐỀN BÙ")
    ops_clawback_count = grab_number_after("ĐÃ CHỐT CÓ TRUY THU")
    total_amount = grab_money_after("TỔNG TIỀN ĐỀN BÙ")

    m = re.search(r"đã chốt:\s*✅\s*(\d+)\s*·\s*❌\s*(\d+)", text)
    ops_approved = int(m.group(1)) if m else None
    ops_rejected = int(m.group(2)) if m else None

    return {
        "csTickCount": cs_tick_count,
        "opsUnfinalizedCount": ops_unfinalized_count,
        "opsApprovedCount": ops_approved,
        "opsRejectedCount": ops_rejected,
        "opsClawbackCount": ops_clawback_count,
        "totalAmount": total_amount,
    }


EXPAND_ALL_JS = """
(() => {
  const btns = Array.from(document.querySelectorAll('button, a, span, div'))
    .filter(el => el.innerText?.trim() === 'Mở hết');
  if (btns.length === 0) return false;
  btns.sort((a, b) => a.innerText.length - b.innerText.length);
  btns[0].click();
  return true;
})();
"""

# The case list is NOT a single flat <table> — confirmed live 2026-08-22:
# it's ~30 collapsed-by-default per-day accordion groups (div.lb-day, one
# per date, each containing its OWN <table> that only exists in the DOM
# once that group is expanded). The old code did
# `document.querySelector('table')`, which found ZERO tables on the
# default (all-collapsed) view — explains both the "Khong doc duoc bang du
# lieu" failures seen in the logs AND, on runs where it happened to catch
# some other transient table, wildly undercounting (found 115 real cases
# vs the ~77-86 total that had ever been synced). Also the OLD column
# mapping was off by one from column 9 onward (a "TRUY THU" column exists
# between "TRẠNG THÁI" and "TT ĐƠN HÀNG" that the old code didn't account
# for) — caseDate was reading cells[10], which is actually the ORDER
# STATUS text ("Đã giao" etc.), not a date at all; the real date only
# exists in each accordion group's OWN header ("21/08/2026 · Thứ 6"), not
# as a per-row table column. Click "Mở hết" (expand all) first, then walk
# every day-group container so both the date and the row data come from
# the right place.
EXTRACT_TABLE_JS = """
(() => {
  const dayGroups = document.querySelectorAll('.lb-day');
  if (dayGroups.length === 0) return null;
  const records = [];
  dayGroups.forEach(day => {
    const dateMatch = day.innerText.match(/(\\d{2}\\/\\d{2}\\/\\d{4})/);
    const caseDate = dateMatch ? dateMatch[1] : '';
    const table = day.querySelector('table');
    if (!table) return;
    const rows = [...table.querySelectorAll('tr')].slice(1);
    rows.forEach(r => {
      const cells = [...r.querySelectorAll('td')].map(c => c.innerText.trim());
      records.push({
        type: cells[0] || '', source: cells[1] || '',
        orderCode: (cells[2] || '').replace(/[^A-Za-z0-9_-]/g, '').trim(),
        clientName: cells[3] || '', detectedAtWarehouse: cells[4] || '',
        suspectedLeg: cells[5] || '', region: cells[6] || '', severity: cells[7] || '',
        status: cells[8] || '', orderStatus: cells[10] || '', caseDate,
        photoCount: (cells[11] || '').match(/\\d+/) ? (cells[11] || '').match(/\\d+/)[0] : '0',
      });
    });
  });
  return records;
})();
"""


def main():
    if not SYNC_SECRET:
        print("Chua co bien moi truong RILLNET_SYNC_SECRET.")
        sys.exit(1)

    print("Dang ket noi voi Chrome...")
    ws_url = get_websocket_url()
    if not ws_url:
        sys.exit(1)
    # timeout=20 — xem ghi chu trong ftl_scraper.py: khong co timeout thi 1
    # lenh CDP treo se giu chung flock voi FTL mai mai.
    ws = websocket.create_connection(ws_url, timeout=20)

    print(f"Dieu huong toi {TARGET_URL} ...")
    send_cdp_command(ws, "Page.navigate", {"url": TARGET_URL})
    time.sleep(6)

    print("Bam 'Bao cao be vo'...")
    if not click_button(ws, "📦 Báo cáo bể vỡ", wait=5):
        print("Khong tim thay nut 'Bao cao be vo' - co the chua dang nhap.")

    print("Bam 'Mo het' de mo toan bo cac nhom ngay...")
    # Confirmed live 2026-08-24: right after a fresh re-login, the report
    # page (KPI cards + 30 accordion date-groups) takes noticeably longer to
    # finish rendering than the old 5x1s retry budget — "Mo het" genuinely
    # wasn't in the DOM yet, not a UI change. 10x1.5s gives real slack.
    expanded = False
    for _ in range(10):
        expanded = run_js(ws, EXPAND_ALL_JS)
        if expanded:
            break
        time.sleep(1.5)
    if not expanded:
        print("Khong tim thay nut 'Mo het' - co the giao dien da doi khac truoc.")
    time.sleep(2)  # để 30 bảng con render xong sau khi mở hết

    records = None
    for _ in range(8):
        records = run_js(ws, EXTRACT_TABLE_JS)
        if records:
            break
        time.sleep(2)

    if not records:
        print("Khong doc duoc bang du lieu.")
        ws.close()
        sys.exit(1)

    print(f"Doc duoc {len(records)} ca be vo/hu hong.")

    print("Dieu huong toi trang Den bu / Truy thu...")
    send_cdp_command(ws, "Page.navigate", {"url": "https://rillnet-app.vercel.app/truythu.html"})
    time.sleep(4)
    click_button(ws, "📊 Tổng hợp", wait=3)
    comp_text = run_js(ws, "document.body.innerText") or ""
    compensation_summary = parse_compensation_summary(comp_text)
    if compensation_summary["csTickCount"] is not None:
        print(f"Den bu (CS tick): {compensation_summary['csTickCount']} don, tong {compensation_summary['totalAmount']}d")
    else:
        print("Khong doc duoc trang Tong hop den bu.")
        compensation_summary = None

    ws.close()

    try:
        res = requests.post(
            f"{APP_BASE_URL}/api/rillnet-sync",
            headers={"Content-Type": "application/json", "X-Sync-Secret": SYNC_SECRET},
            json={"records": records, "compensationSummary": compensation_summary},
            timeout=30,
        )
        print(f"Phan hoi: {res.status_code}")
        if res.status_code == 200:
            data = res.json()
            print(f"Da dong bo {data.get('synced', 0)} ca be vo/hu hong!")
        else:
            print(res.text)
            sys.exit(1)
    except Exception as e:
        print("Gui len app that bai:", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
