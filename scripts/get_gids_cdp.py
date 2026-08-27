import json
import requests
import websocket
import time

DEBUG_PORT = 9222
SHEET_ID = "1Nj1IMAOH_mdmvNImgS6KPelP9dXvPWF9aWZjEhM58Pc"

def get_ws():
    res = requests.get(f'http://localhost:{DEBUG_PORT}/json').json()
    for t in res:
        if t['type'] == 'page':
            return t['webSocketDebuggerUrl']
    return None

def main():
    ws_url = get_ws()
    if not ws_url:
        print("No WS")
        return
    ws = websocket.create_connection(ws_url)
    
    msg = {'id': 1, 'method': 'Page.navigate', 'params': {'url': f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit'}}
    ws.send(json.dumps(msg))
    time.sleep(5)
    
    js = """
    JSON.stringify(Array.from(document.querySelectorAll('.docs-sheet-tab-name')).map(t => {
        let parent = t.closest('.docs-sheet-tab');
        return { name: t.textContent, gid: parent ? parent.id.split(':')[1] : '' };
    }));
    """
    msg2 = {'id': 2, 'method': 'Runtime.evaluate', 'params': {'expression': js, 'returnByValue': True}}
    ws.send(json.dumps(msg2))
    
    while True:
        resp = json.loads(ws.recv())
        if resp.get('id') == 2:
            print(resp['result']['result']['value'])
            break
            
    ws.close()

if __name__ == '__main__':
    main()
