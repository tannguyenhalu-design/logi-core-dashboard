"""
ftl_enrich_vehicle.py — bổ sung biển số xe / tài xế / tải trọng / trạng thái
chuyến đi thật cho các đơn FTL Điện Máy.

Trước đây phải mở từng trang chi tiết (/b2b/orders/{ma_don}) rồi đọc
document.body.innerText bằng regex — chậm (mỗi trang ~2-3s do phải render
cả trang) và dễ vỡ (VD: 1 chuyến giao nhiều điểm lặp lại dòng "biển số -
tải trọng" nhiều lần, gây đếm nhầm thành nhiều xe).

Phát hiện ngày 2026-08-16: trang chi tiết tự gọi 1 API JSON sạch để lấy
đúng phần "5. Thông tin chuyến đi":
  GET https://ft-portal-bff.ghn.vn/api/freight-b2b/v1/orders/{ma_don}/trips
Trả về mảng "trips" có sẵn status dạng enum (PLANNED/ASSIGNED/COMPLETED/...),
biển số, tài xế, tải trọng thật — không cần render trang, không cần regex.
Gọi thẳng fetch() này từ trong 1 tab đã đăng nhập portal.ghn.vn (cùng gốc,
CORS đã cho phép kèm cookie) nhanh hơn nhiều so với Page.navigate + đợi
render + đọc innerText.

Chạy SAU ftl_scraper.py trong cùng chu kỳ. Chỉ xử lý các đơn Điện Máy chưa
enrich hoặc chuyến chưa xác nhận hoàn thành (xem list_ftl_orders_needing_vehicle.js)
— giới hạn tối đa MAX_PER_RUN đơn/lần để không kéo dài chu kỳ 30 phút quá lâu.
"""
import sys
import time
import json
import functools
import requests
import websocket
import subprocess

print = functools.partial(print, flush=True)  # stdout is buffered when piped (not a tty) — without this, "Da xu ly N/M" progress lines only appear once the whole run ends, making a slow/stuck run look like a black box

DEBUG_PORT = 9222
TRIPS_API = "https://ft-portal-bff.ghn.vn/api/freight-b2b/v1/orders/{code}/trips"
# "Tải trọng" GHN đã ghi nhận NGAY LÚC TẠO ĐƠN (mục 1 trang chi tiết) — khác
# hẳn vehicle_spec_code lấy từ TRIPS_API ở trên, vốn chỉ có SAU khi GSVT đã
# gán 1 chuyến/tài xế thật. Xác nhận trực tiếp 2026-08-26: đơn chưa gán xe
# (order_status="CREATED", trips=[]) vẫn có sẵn "vehicle_spec_code":"8T" ở
# đây — cho phép biết trước loại xe khách yêu cầu ngay cả khi GSVT chưa
# thao tác gì, thay vì phải chờ đến lúc có xe thật mới biết.
ORDER_DETAIL_API = "https://ft-portal-bff.ghn.vn/api/freight-b2b/v1/orders/{code}?order_number={code}"
MAX_PER_RUN = 1000  # API call ~0.3-0.5s/don (khong con phai render trang) nen ca backlog ~670 don gom trong 1 chu ky la an toan
CDP_TIMEOUT = 20  # giây — không có timeout này, 1 lệnh CDP không phản hồi sẽ block vô thời hạn, giữ flock mãi mãi và chặn mọi chu kỳ sau
CHECKPOINT_EVERY = 50  # ghi tạm kết quả xuống Sheet mỗi N đơn, để lỡ crash giữa chừng cũng không mất hết công đã quét
REQUEST_GAP = 0.25  # giây giữa 2 lần gọi API — chừa margin, tránh dồn dập vào API nội bộ của GHN


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
    return None


# Trạng thái CHUYẾN thực tế — khác hẳn "status" cấp đơn (mục 1 trang chi
# tiết / cột "Trạng thái" trong file Xuất dữ liệu) vốn có thể kẹt mãi ở
# "Đã tạo" dù chuyến đã xong (xác nhận qua đơn thật: order status "Đã tạo",
# nhưng trip status "COMPLETED" từ 14/08). Chỉ "COMPLETED" mới coi là xong.
DONE_TRIP_STATUS = "COMPLETED"


def fetch_trip_info(ws, code):
    js = (
        f"fetch('{TRIPS_API.format(code=code)}', {{credentials: 'include'}})"
        f".then(r => r.text())"
    )
    raw = run_js(ws, js)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except Exception:
        return None
    if payload.get("code") != "success":
        return None
    trips = ((payload.get("data") or {}).get("trips")) or []
    if not trips:
        return {"plate": None, "driver": None, "vehicleCapacity": None, "tripCount": 0, "tripStatus": None, "tripCompleted": None}

    plates, capacities, drivers, statuses = [], [], [], []
    for t in trips:
        st = t.get("status") or ""
        if st:
            statuses.append(st)
        res = t.get("resources") or {}
        vehicle = res.get("vehicle") or {}
        if vehicle.get("license_plate"):
            plates.append(vehicle["license_plate"])
        if vehicle.get("spec_code"):
            capacities.append(vehicle["spec_code"])
        driver = res.get("driver") or {}
        if driver.get("name"):
            drivers.append(driver["name"])

    return {
        "plate": " + ".join(dict.fromkeys(plates)) if plates else None,
        "driver": " + ".join(dict.fromkeys(drivers)) if drivers else None,
        "vehicleCapacity": " + ".join(dict.fromkeys(capacities)) if capacities else None,
        "tripCount": len(trips),
        "tripStatus": " + ".join(dict.fromkeys(statuses)) if statuses else None,
        "tripCompleted": len(statuses) > 0 and all(s == DONE_TRIP_STATUS for s in statuses),
    }


def fetch_requested_vehicle_type(ws, code):
    js = (
        f"fetch('{ORDER_DETAIL_API.format(code=code)}', {{credentials: 'include'}})"
        f".then(r => r.text())"
    )
    raw = run_js(ws, js)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except Exception:
        return None
    if payload.get("code") != "success":
        return None
    return (payload.get("data") or {}).get("vehicle_spec_code") or None


def main():
    print("Dang doc danh sach don Dien May can lay bien so...")
    try:
        result = subprocess.run(
            ["node", "/app/list_ftl_orders_needing_vehicle.js"],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print("Loi khi liet ke don can enrich:")
            print(result.stderr)
            sys.exit(1)
        order_codes = json.loads(result.stdout.strip())
    except Exception as e:
        print(f"Loi doc danh sach don: {e}")
        sys.exit(1)

    if not order_codes:
        print("Khong co don nao can bo sung bien so - da day du.")
        return

    order_codes = order_codes[:MAX_PER_RUN]
    print(f"Se lay chi tiet cho {len(order_codes)} don (con lai xu ly o chu ky sau)...")

    def connect():
        ws_url = get_websocket_url()
        if not ws_url:
            return None
        return websocket.create_connection(ws_url, timeout=CDP_TIMEOUT)

    ws = connect()
    if not ws:
        sys.exit(1)

    def flush(results):
        if not results:
            return
        with open("/app/ftl_vehicle_updates.json", "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False)
        result = subprocess.run(
            ["node", "/app/update_ftl_vehicle_info.js", "/app/ftl_vehicle_updates.json"],
            capture_output=True, text=True,
        )
        print(result.stdout)
        if result.returncode != 0:
            print("Loi khi cap nhat:")
            print(result.stderr)

    results = {}
    total_found = 0
    start_time = time.time()
    for i, code in enumerate(order_codes):
        try:
            info = fetch_trip_info(ws, code)
            time.sleep(REQUEST_GAP)
            has_real_trip = info and (info["plate"] or info["tripStatus"])
            # Bug thật tìm ra 2026-08-26: 1 chuyến có thể đã ở trạng thái
            # "PLANNED" (GHN đã lên kế hoạch chuyến nhưng CHƯA gán xe/tài xế
            # cụ thể) — has_real_trip=True đúng (có tripStatus thật), nhưng
            # vehicleCapacity vẫn rỗng. Điều kiện gọi "Tải trọng yêu cầu"
            # phải dựa vào vehicleCapacity còn thiếu hay không, KHÔNG PHẢI
            # dựa vào has_real_trip — nếu không, mọi đơn "PLANNED" vẫn hiện
            # "(chưa rõ)" y hệt như trước khi sửa.
            needs_requested_type = not (info and info["vehicleCapacity"])
            if has_real_trip:
                results[code] = info
                if info["plate"]:
                    total_found += 1
                if needs_requested_type:
                    requested = fetch_requested_vehicle_type(ws, code)
                    time.sleep(REQUEST_GAP)
                    if requested:
                        results[code]["requestedVehicleType"] = requested
            elif needs_requested_type:
                # Chưa có chuyến/xe thật — vẫn ghi lại "Tải trọng yêu cầu"
                # GHN ghi nhận ngay lúc tạo đơn, để không phải hiện "chưa rõ"
                # cho những đơn tạo hôm nay mà GSVT chưa kịp gán xe.
                requested = fetch_requested_vehicle_type(ws, code)
                time.sleep(REQUEST_GAP)
                if requested:
                    results[code] = {
                        "plate": None, "driver": None, "vehicleCapacity": None,
                        "tripCount": 0, "tripStatus": None, "tripCompleted": None,
                        "requestedVehicleType": requested,
                    }
        except Exception as e:
            # 1 don loi/API treo khong duoc lam hong ca batch — bo qua, thu lai o chu ky sau.
            # Ket noi CDP co the da chet theo, thu ket noi lai truoc khi xu ly don tiep theo.
            print(f"  Loi o don {code}: {e} — bo qua, thu ket noi lai...")
            try:
                ws.close()
            except Exception:
                pass
            ws = connect()
            if not ws:
                print("Khong the ket noi lai CDP, dung som.")
                break

        if (i + 1) % 50 == 0:
            elapsed = time.time() - start_time
            print(f"  Da xu ly {i + 1}/{len(order_codes)}... ({elapsed:.0f}s)")
        if (i + 1) % CHECKPOINT_EVERY == 0:
            flush(results)
            results = {}

    if ws:
        try:
            ws.close()
        except Exception:
            pass

    flush(results)
    elapsed = time.time() - start_time
    print(f"Lay duoc thong tin xe cho {total_found}/{len(order_codes)} don trong {elapsed:.0f}s.")
    print("HOAN TAT FTL VEHICLE ENRICH!")


if __name__ == "__main__":
    main()
