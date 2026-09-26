"""
report_health.py — gửi kết quả từng bước của run_scrapers.sh về dashboard
(POST /api/scraper-heartbeat) cho trang "Trạng thái hệ thống".

Phân loại dựa trên đúng các dòng log thật đã gặp khi phiên đăng nhập hết hạn
(xem SYSTEM_SPEC.md, sự cố #19) — script cào không crash khi hết phiên, chỉ
âm thầm không lấy được gì, nên phải đọc nội dung log chứ không chỉ exit code.
"""
import json
import os
import re
import sys

import requests

APP_URL = "https://logicore-app.vercel.app/api/scraper-heartbeat"

STEPS = {
    "kpi": {
        "ok": re.compile(r"Da khop va cap nhat (\d+) du an"),
        "expired": [r"Parse duoc 0 khach hang", r"co the chua dang nhap"],
    },
    "raw_ontime": {
        "ok": re.compile(r"Successfully synced (\d+) rows"),
        "expired": [r"ERROR:Failed to fetch", r"Bi chan dang nhap", r"Khong tim thay dong Header"],
    },
    "rillnet": {
        "ok": re.compile(r"Da dong bo (\d+) ca be vo"),
        "expired": [r"co the chua dang nhap"],
    },
}


def read(path):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def classify(name, spec):
    text = read(f"/tmp/step_{name}.log")
    code_txt = read(f"/tmp/step_{name}.code")
    if text is None:
        return {"name": name, "status": "not_run", "message": "Bước này không chạy"}
    code = int(code_txt.strip()) if code_txt and code_txt.strip().lstrip("-").isdigit() else None
    step = {"name": name, "exitCode": code}

    source = re.search(r"Da tai xong (\d+) dong", text)
    if source:
        step["sourceRows"] = int(source.group(1))

    m = spec["ok"].search(text)
    if m:
        step["status"] = "ok"
        step["count"] = int(m.group(1))
        return step
    for pat in spec["expired"]:
        if re.search(pat, text):
            step["status"] = "session_expired"
            step["message"] = pat.replace("\\", "")
            return step
    step["status"] = "error"
    tail = [ln for ln in text.strip().splitlines() if ln.strip()][-3:]
    step["message"] = " | ".join(tail)[:300] if tail else f"exit code {code}"
    if code == 124:
        step["message"] = "Quá thời gian 600s (timeout)"
    return step


def main():
    secret = os.environ.get("SNAPSHOT_SECRET")
    if not secret:
        print("Thieu SNAPSHOT_SECRET, bo qua heartbeat")
        return
    payload = {
        "runStartedAt": sys.argv[1] if len(sys.argv) > 1 else None,
        "steps": [classify(n, s) for n, s in STEPS.items()],
    }
    r = requests.post(APP_URL, json=payload, headers={"x-snapshot-secret": secret}, timeout=30)
    print(f"Heartbeat: HTTP {r.status_code} {json.dumps([(s['name'], s['status']) for s in payload['steps']])}")


if __name__ == "__main__":
    main()
