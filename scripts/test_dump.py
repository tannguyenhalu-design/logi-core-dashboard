import requests
import websocket
import json
import time

DEBUG_PORT = 9222
SHEET_ID = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc"

def get_websocket_url():
    response = requests.get(f"http://localhost:{DEBUG_PORT}/json")
    for tab in response.json():
        if tab["type"] == "page":
            return tab["webSocketDebuggerUrl"]

def send_cdp_command(ws, method, params=None):
    msg = {"id": 1, "method": method, "params": params or {}}
    ws.send(json.dumps(msg))
    while True:
        resp = json.loads(ws.recv())
        if resp.get("id") == 1:
            return resp

def run_js(ws, script):
    resp = send_cdp_command(ws, "Runtime.evaluate", {
        "expression": script,
        "returnByValue": True,
        "awaitPromise": True,
    })
    return resp["result"]["result"].get("value")

ws = websocket.create_connection(get_websocket_url())
csv_url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid=1783158792"
js = f"""
(async () => {{
    const r = await fetch("{csv_url}");
    return await r.text();
}})()
"""
txt = run_js(ws, js)
with open("test_dump.csv", "w", encoding="utf-8") as f:
    f.write(txt)
print("Dumped to test_dump.csv")
ws.close()
