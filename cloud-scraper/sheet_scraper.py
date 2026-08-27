"""
sheet_scraper.py (cloud version) — pulls raw_ontime CSV from the GHN source
sheet via the container's own logged-in Chrome, same CDP approach as the
local machine. Writes to /app/dump_0.csv, then shells out to sync_to_db.js
(Node) to push it to the DB sheet, same division of labor as locally.
"""
import sys
import time
import json
import requests
import websocket
import csv
import subprocess
from io import StringIO

DEBUG_PORT = 9222
SHEET_ID = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc"

TABS = [
    {"name": "raw_ontime", "gid": "0"},
]


def get_websocket_url():
    try:
        response = requests.get(f"http://localhost:{DEBUG_PORT}/json", timeout=10)
        tabs = response.json()
        for tab in tabs:
            if tab["type"] == "page" and "docs.google.com" in tab.get("url", ""):
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


def main():
    print("Dang ket noi voi Chrome...")
    ws_url = get_websocket_url()
    if not ws_url:
        sys.exit(1)

    # timeout=20 — xem ghi chu trong ftl_scraper.py: khong co timeout thi 1
    # lenh CDP treo se giu chung flock voi FTL mai mai.
    ws = websocket.create_connection(ws_url, timeout=20)

    base_url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit"
    print(f"Dieu huong toi {base_url} de muon phien dang nhap...")
    send_cdp_command(ws, "Page.navigate", {"url": base_url})
    time.sleep(5)

    failed = False
    for tab in TABS:
        print(f"Dang tai du lieu CSV cua tab {tab['name']} (GID: {tab['gid']})...")
        export_url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={tab['gid']}"

        js_code = f"""
        (async () => {{
            try {{
                const resp = await fetch(`{export_url}&t={int(time.time())}`, {{ cache: 'no-store' }});
                if (!resp.ok) throw new Error("Status " + resp.status);
                const text = await resp.text();
                return text;
            }} catch (err) {{
                return "ERROR:" + err.message;
            }}
        }})()
        """

        csv_text = run_js(ws, js_code)

        if not csv_text:
            print("Tai that bai (khong co du lieu tra ve).")
            failed = True
            continue

        if csv_text.startswith("HTTP_ERROR_") or csv_text.startswith("FETCH_ERROR_"):
            print(f"Tai that bai: {csv_text}")
            failed = True
            continue

        if csv_text.startswith("<!DOCTYPE html>"):
            print("Bi chan dang nhap (tai khoan Chrome chua duoc cap quyen xem file nay).")
            failed = True
            continue

        f = StringIO(csv_text.strip())
        reader = csv.reader(f)
        data = list(reader)

        if len(data) == 0:
            print("Du lieu trong.")
            failed = True
            continue

        if ("<!doctype" in str(data[0]).lower()) or ("<html" in str(data[0]).lower()):
            print("CANH BAO: Du lieu tai ve giong trang HTML - tai khoan bot mat quyen truy cap!")
            failed = True
            continue

        header_idx = -1
        if tab["name"] == "raw_ontime":
            for i, row in enumerate(data[:10]):
                row_str = str(row).lower()
                if "order_code" in row_str or "mã đơn" in row_str:
                    header_idx = i
                    break

            if header_idx == -1:
                print(f"CANH BAO: Khong tim thay dong Header - huy bo. Dong 1: {data[0][:3]}")
                failed = True
                continue

        with open("/app/dump_0.csv", "w", encoding="utf-8") as f:
            f.write(csv_text)

        data = data[header_idx:]

        print(f"Da tai xong {len(data)} dong. Bat dau day len DB sheet...")

        try:
            result = subprocess.run(["node", "/app/sync_to_db.js"], capture_output=True, text=True)
            if result.returncode == 0:
                print(f"Da dong bo thanh cong tab {tab['name']}!")
                print(result.stdout)
            else:
                print(f"Loi khi chay sync_to_db.js:")
                print(result.stderr)
                failed = True
        except Exception as e:
            print(f"Loi: {e}")
            failed = True

    ws.close()
    if failed:
        print("HOAN TAT (CO LOI) TAI GOOGLE SHEET!")
        sys.exit(1)
    print("HOAN TAT TAI GOOGLE SHEET!")


if __name__ == "__main__":
    main()
