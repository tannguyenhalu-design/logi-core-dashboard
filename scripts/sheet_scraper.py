"""
sheet_scraper.py — Dùng CDP để tải dữ liệu CSV trực tiếp từ Google Sheet công ty (vượt rào chặn API).
"""
import os
import time
import json
import requests
import websocket
import csv
from io import StringIO

DEBUG_PORT = 9222
APP_BASE_URL = "https://logicore-app.vercel.app"

# Link Google Sheet công ty
SHEET_ID = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc"

# Cấu hình các tab cần tải (Nếu có FTL hay Damage cứ thêm GID vào đây)
TABS = [
    {"name": "raw_ontime", "gid": "0"},
]

def get_websocket_url():
    try:
        response = requests.get(f"http://localhost:{DEBUG_PORT}/json")
        tabs = response.json()
        # Ưu tiên tab Google Sheets nếu có
        for tab in tabs:
            if tab["type"] == "page" and "docs.google.com" in tab.get("url", ""):
                return tab["webSocketDebuggerUrl"]
        for tab in tabs:
            if tab["type"] == "page":
                return tab["webSocketDebuggerUrl"]
        return None
    except Exception as e:
        print(f"❌ Không kết nối được Chrome (cổng {DEBUG_PORT}): {e}")
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

def main():
    print("🤖 Đang kết nối với Chrome...")
    ws_url = get_websocket_url()
    if not ws_url:
        return
    
    ws = websocket.create_connection(ws_url)

    # 1. Điều hướng tới trang Google Sheet để mượn phiên đăng nhập & bypass CORS
    base_url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit"
    print(f"🚀 Điều hướng tới {base_url} để mượn phiên đăng nhập...")
    send_cdp_command(ws, "Page.navigate", {"url": base_url})
    print("⏳ Đợi trang tải (5 giây)...")
    time.sleep(5) 

    for tab in TABS:
        print(f"📥 Đang tải dữ liệu CSV của tab {tab['name']} (GID: {tab['gid']})...")
        export_url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={tab['gid']}"
        
        # Script JS để tải file (vượt qua SSO bằng session hiện tại)
        # Thêm t={timestamp} để chống Chrome Cache (rất quan trọng, nếu không Chrome sẽ trả về file cũ)
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
            print("❌ Tải thất bại (không có dữ liệu trả về).")
            continue
            
        if csv_text.startswith("HTTP_ERROR_") or csv_text.startswith("FETCH_ERROR_"):
            print(f"❌ Tải thất bại: {csv_text}")
            continue

        if csv_text.startswith("<!DOCTYPE html>"):
            print("❌ Bị chặn đăng nhập (Tài khoản trong bot Chrome chưa được cấp quyền xem file này).")
            print("Vui lòng mở trình duyệt Bot lên và đăng nhập lại.")
            continue
            
        # Parse CSV text thành List[List[str]]
        f = StringIO(csv_text.strip())
        reader = csv.reader(f)
        data = list(reader)
        
        if len(data) == 0:
            print("⚠️ Dữ liệu trống.")
            continue

        # Kiểm tra an toàn: Đảm bảo dữ liệu tải về là CSV chuẩn của Google Sheet (có đủ cột và không phải HTML)
        if ("<!doctype" in str(data[0]).lower()) or ("<html" in str(data[0]).lower()):
            print("❌ CẢNH BÁO: Dữ liệu tải về giống như trang HTML (không phải CSV). Tài khoản Bot đã bị văng hoặc mất quyền truy cập!")
            continue
            
        # Tìm dòng Header thực sự (raw_ontime phải chứa order_code hoặc mã đơn)
        header_idx = -1
        if tab["name"] == "raw_ontime":
            for i, row in enumerate(data[:10]): # Chỉ tìm trong 10 dòng đầu
                row_str = str(row).lower()
                if "order_code" in row_str or "mã đơn" in row_str:
                    header_idx = i
                    break
                    
            if header_idx == -1:
                print(f"❌ CẢNH BÁO: Không tìm thấy dòng Header chứa 'order_code' hoặc 'Mã đơn' trong 10 dòng đầu. Hủy bỏ để tránh ghi đè rác. Dòng 1: {data[0][:3]}")
                continue
                
        # Save to local file for debugging
        with open(f"scripts/dump_{tab['gid']}.csv", "w", encoding="utf-8") as f:
            f.write(csv_text)

        # Cắt bỏ các dòng metadata rác phía trên Header
        data = data[header_idx:]

        print(f"📊 Đã tải xong {len(data)} dòng. Bắt đầu đẩy lên DB sheet...")
        
        try:
            import subprocess
            result = subprocess.run(["node", "scripts/sync_to_db.js"], capture_output=True, text=True)
            if result.returncode == 0:
                print(f"✅ Đã đồng bộ thành công tab {tab['name']}!")
                print(result.stdout)
            else:
                print(f"❌ Lỗi khi chạy sync_to_db.js:")
                print(result.stderr)
        except Exception as e:
            print(f"❌ Lỗi: {e}")

    ws.close()
    print("🎉 HOÀN TẤT TẢI GOOGLE SHEET!")

if __name__ == "__main__":
    main()
