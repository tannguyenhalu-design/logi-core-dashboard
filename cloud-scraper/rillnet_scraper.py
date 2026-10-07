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
TARGET_URL = "https://rillnet.ghn.vn/"
APP_BASE_URL = "https://logicore-app.vercel.app"
SYNC_SECRET = os.environ.get("RILLNET_SYNC_SECRET")
# Cookies persisted across Chrome restarts / container auto-heals so the
# cron can recover the Rillnet session without manual noVNC re-login.
COOKIE_PATH = "/app/rillnet_cookies.json"


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


def save_cookies(ws):
    """Sau khi scrape thanh cong: luu toan bo cookie ghn.vn ra file de lan sau
    tu phuc hoi session neu Chrome bi restart hoac mat session."""
    try:
        resp = send_cdp_command(ws, "Network.getAllCookies")
        cookies = [c for c in resp.get("result", {}).get("cookies", []) if "ghn.vn" in c.get("domain", "")]
        with open(COOKIE_PATH, "w", encoding="utf-8") as f:
            json.dump(cookies, f)
        print(f"Da luu {len(cookies)} cookie GHN -> {COOKIE_PATH}")
    except Exception as e:
        print(f"Khong luu duoc cookie: {e}")


def restore_cookies(ws):
    """Thu khoi phuc session tu file cookie da luu (ghi de truoc khi navigate).
    Loc bo cookie het han. Tra ve True neu co cookie hop le de thu."""
    if not os.path.exists(COOKIE_PATH):
        return False
    try:
        with open(COOKIE_PATH, encoding="utf-8") as f:
            cookies = json.load(f)
        now = time.time()
        safe = []
        for c in cookies:
            entry = {k: c[k] for k in ("name", "value", "domain", "path") if k in c}
            for k in ("httpOnly", "secure", "sameSite"):
                if k in c:
                    entry[k] = c[k]
            if c.get("expires", -1) > 0:
                if c["expires"] < now:
                    continue  # cookie het han
                entry["expires"] = c["expires"]
            safe.append(entry)
        if not safe:
            print("Tat ca cookie da het han - can dang nhap lai qua noVNC.")
            return False
        send_cdp_command(ws, "Network.setCookies", {"cookies": safe})
        print(f"Da khoi phuc {len(safe)} cookie GHN tu {COOKIE_PATH}")
        return True
    except Exception as e:
        print(f"Khong khoi phuc duoc cookie: {e}")
        return False


def _int(s):
    return int(s.replace(".", "").replace(",", ""))


def parse_compensation_summary(text):
    """Cards of "Đền bù / Truy thu → 📊 Tổng hợp" (every client, all time, over
    the orders CS ticked 💰). Labels are CSS-uppercased, so match loosely.
    Since ~15/09 the single "TỔNG TIỀN ĐỀN BÙ" card is split into "TỔNG ĐỀN DỰ
    KIẾN" (CS types it when ticking, CS / truy thu team can revise it after the
    customer's QC) and "TỔNG ĐỀN ĐÃ CHỐT" (the real paid amount, loaded through
    the "💵 Chốt tiền" file) — found 29/09."""
    def grab_number_after(label):
        m = re.search(re.escape(label) + r"\s*\n\s*([\d.,]+)", text, re.I)
        return _int(m.group(1)) if m else None

    def grab_money_after(*labels):
        for label in labels:
            m = re.search(re.escape(label) + r"\s*\n\s*([\d.,]+)\s*đ", text, re.I)
            if m:
                return _int(m.group(1))
        return None

    def grab(pattern):
        m = re.search(pattern, text, re.I)
        return _int(m.group(1)) if m else None

    m = re.search(r"đã chốt:\s*✅\s*(\d+)\s*·\s*❌\s*(\d+)", text)
    return {
        "csTickCount": grab_number_after("CS TICK CÓ ĐỀN BÙ"),
        "opsUnfinalizedCount": grab_number_after("OPS CHƯA CHỐT ĐỀN BÙ"),
        "opsApprovedCount": int(m.group(1)) if m else None,
        "opsRejectedCount": int(m.group(2)) if m else None,
        "opsClawbackCount": grab_number_after("ĐÃ CHỐT CÓ TRUY THU"),
        "totalAmount": grab_money_after("TỔNG ĐỀN DỰ KIẾN", "TỔNG TIỀN ĐỀN BÙ"),
        "totalChotAmount": grab_money_after("TỔNG ĐỀN ĐÃ CHỐT"),
        "chotCount": grab(r"(\d+)\s*đơn có số chốt"),
        "dkFromChotCount": grab(r"(\d+)\s*đơn lấy theo số đã chốt") or 0,
    }


def parse_report_cards(text):
    """KPI cards of "📦 Báo cáo bể vỡ" for the date range the scraper set
    (every client): cases, đã chốt đền bù, damage rate, and the "Truy thu dự
    tính theo OM" line ("74 đơn đã chốt · 481.933.814đ dự tính")."""
    def before(label):
        m = re.search(r"([\d.,]+%?)\s*\n\s*" + re.escape(label), text)
        return m.group(1) if m else None

    cases, comp, rate = before("Bể vỡ / Hư hỏng"), before("Đơn đã chốt đền bù cho khách"), before("Tỷ lệ bể vỡ")
    m = re.search(r"(\d+)\s*đơn đã chốt\s*·\s*([\d.,]+)đ\s*dự tính", text)
    return {
        "caseCount": _int(cases) if cases and not cases.endswith("%") else None,
        "compensatedCount": _int(comp) if comp and not comp.endswith("%") else None,
        "damageRate": rate if rate and rate.endswith("%") else None,
        "truyThuCount": int(m.group(1)) if m else None,
        "truyThuAmount": _int(m.group(2)) if m else None,
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
# Layout changed ~16/09/2026 (found 27/09): the client is no longer a column
# but a group row ("🏢 Supra Nha Trang · 3 đơn", tr.lb-kgrp); cases are
# tr.lb-orow with 7 cells NGUỒN | MÃ | NƠI PHÁT HIỆN | CHẶNG NGHI VẤN |
# TRẠNG THÁI | TRUY THU | TT ĐƠN HÀNG, each followed by an empty detail row
# (tr.lb-tixrow). The code cell now carries badges ("GYRGDQPH 💰", sometimes a
# date) — the old positional mapping glued them into the order code and, from
# ~22/09, read the shifted columns as garbage rows. Columns are now looked up
# by header text so an added/removed column can't shift the mapping again,
# and the order code is the first token of the MÃ cell only.
EXTRACT_TABLE_JS = """
(() => {
  const dayGroups = document.querySelectorAll('.lb-day');
  if (dayGroups.length === 0) return null;
  const norm = (t) => (t || '').normalize('NFC').trim().toUpperCase();
  const records = [];
  dayGroups.forEach(day => {
    const dateMatch = day.innerText.match(/(\\d{2}\\/\\d{2}\\/\\d{4})/);
    const caseDate = dateMatch ? dateMatch[1] : '';
    const table = day.querySelector('table');
    if (!table) return;
    const trs = [...table.querySelectorAll('tr')];
    const head = trs.find(tr => tr.querySelector('th')) || trs[0];
    const cols = [...head.querySelectorAll('th,td')].map(c => norm(c.innerText));
    const col = (...names) => { for (const n of names) { const i = cols.indexOf(n); if (i >= 0) return i; } return -1; };
    const iSrc = col('NGUỒN'), iCode = col('MÃ', 'MÃ ĐƠN'), iWh = col('NƠI PHÁT HIỆN'), iLeg = col('CHẶNG NGHI VẤN'),
          iSt = col('TRẠNG THÁI'), iOst = col('TT ĐƠN HÀNG'), iType = col('LOẠI'), iClient = col('KHÁCH HÀNG', 'KHÁCH'),
          iSev = col('MỨC ĐỘ'), iRegion = col('VÙNG'), iPhoto = col('ẢNH');
    if (iCode < 0) return;
    let client = '';
    trs.forEach(tr => {
      if (tr === head) return;
      if (tr.classList.contains('lb-kgrp')) {
        client = tr.innerText.replace(/^\\s*🏢\\s*/, '').replace(/\\s*·\\s*\\d+\\s*đơn\\s*$/i, '').trim();
        return;
      }
      const tds = [...tr.querySelectorAll('td')];
      if (tds.length <= iCode || tr.classList.contains('lb-tixrow')) return;
      const cell = (i) => (i >= 0 && tds[i] ? tds[i].innerText.trim() : '');
      const orderCode = (cell(iCode).split(/\\s+/)[0] || '').replace(/[^A-Za-z0-9_-]/g, '').toUpperCase().replace(/_\\d+$/, ''); // 1 vận đơn nhiều kiện (_1.._N) = 1 đơn
      if (!orderCode) return;
      records.push({
        type: cell(iType).replace(/^▸\\s*/, '') || 'Bể vỡ',
        source: cell(iSrc).replace(/^▸\\s*/, ''),
        orderCode,
        clientName: cell(iClient) || client,
        detectedAtWarehouse: cell(iWh), suspectedLeg: cell(iLeg), region: cell(iRegion), severity: cell(iSev),
        status: cell(iSt), orderStatus: cell(iOst), caseDate,
        // No ẢNH column since ~16/09 — the real count comes from ENRICH_JS.
        photoCount: iPhoto >= 0 ? (cell(iPhoto).match(/\\d+/) || ['0'])[0] : '',
      });
    });
  });
  return records;
})();
"""

# The report's date filter (#lbFrom / #lbTo) defaults to TODAY only, so each
# run used to capture just that day's cases — any day the scraper was down or
# logged out was lost for good. Read the whole dashboard window every run
# (~500 cases, well within time): compensation / truy thu decisions change
# weeks after a case is opened, and a full scan lets the app mark cases that
# dropped out of the report (`fullScan`).
DATA_START = "2026-07-01"

# Per-case compensation, read from the report page's own state — the same
# rule the page uses for its "Đơn đã chốt đền bù cho khách" card
# (_lbCndbRows: truy-thu record chap_nhan_denbu === true OR r.den_chot), plus
# the truy thu decision/amount (_LB.tt[code]: quyet_dinh co/khong, tong_tien).
# Confirmed 27/09: DM 01/07–26/09 gives 149 bể vỡ / 67 đã chốt đền bù,
# matching the cards. If the page internals change, this returns null and
# the cases are still synced without the flags.
ENRICH_JS = """
(() => {
  try {
    // _LB is a script-level let/const, not a window property.
    const TT = (typeof _LB !== 'undefined' && _LB && _LB.tt) || {};
    const key = (c) => String(c || '').toUpperCase().trim().replace(/_\\d+$/, '');
    const SEV = { nang: 'Nặng', trung_binh: 'Vừa', nhe: 'Nhẹ', chua_gan: 'Chưa gán' };
    const out = {};
    _lbFilt(_lbAllRows()).forEach(r => {
      const k = key(r.code); if (!k) return;
      const t = TT[k] || TT[String(r.code || '').toUpperCase().trim()] || null;
      const files = String(r.file_id || '').split(',').filter(x => x.trim()).length;
      out[k] = {
        compensated: !!(t && t.chap_nhan_denbu === true) || !!r.den_chot,
        // CS ticked 💰 — exactly the orders the "📊 Tổng hợp" cards total (reconciliation).
        csTick: !!r.cs_denbu,
        // Money as the report row knows it; the truy thu page (MONEY_JS) adds
        // the revised estimate — main() picks the latest.
        csAmount: r.cs_denbu_sotien != null && r.cs_denbu_sotien !== '' ? (Number(r.cs_denbu_sotien) || 0) : '',
        csAt: r.cs_denbu_at || '',
        chotAmount: r.den_chot ? (Number(r.den_chot_tien) || 0) : '',
        chotAt: r.den_chot ? (r.den_chot_at || '') : '',
        truyThu: t ? (t.quyet_dinh === 'co' ? 'co' : t.quyet_dinh === 'khong' ? 'khong' : 'cho') : 'cho',
        truyThuStatus: t ? String(t.trang_thai || '') : '',
        truyThuAmount: t && t.quyet_dinh === 'co' ? (Number(t.tong_tien) || 0) : '',
        // Same photo count the truy thu page shows (max of counter, files).
        photoCount: String(Math.max(Number(r.photo) || 0, files)),
        severity: SEV[r.sev] || String(r.sev || ''),
        region: r.zone && !/chưa rõ/i.test(r.zone) ? String(r.zone) : '',
        suspectedRoute: String(r.chang_txt || '').slice(0, 200),
      };
    });
    return out;
  } catch (e) { return null; }
})();
"""

# Per-order money + cause from "Đền bù / Truy thu" (truythu.html), read 29/09.
# A truy thu record (TT, table truy_thu) keeps in its jsonb phieu_ref:
#   den_dk   {tien, at}  đền DỰ KIẾN — CS types it when ticking 💰, CS / truy
#                        thu team revise it later (after the customer's QC);
#                        absent → the page falls back to the CS tick amount
#                        (lost_bevo row cs_denbu_sotien, BEVO_RAW here)
#   den_chot {tien, at}  đền ĐÃ CHỐT — the real paid amount, only through the
#                        "💵 Chốt tiền" Excel file
#   hu_hong  {muc_do, vi_tri}  damage level / position (bevo_taxonomy codes)
#   cndb     {ly_do, txt}      reason for (not) compensating the customer
# plus phan_bo_kho[].ly_do_tt = why each warehouse pays truy thu. _LB.tt on
# the report page is a trimmed copy WITHOUT phieu_ref, hence this second page.
# The free-text ticket content (noi_dung) is NOT read: ~23% of it carries phone
# numbers. Data (TT, BEVO_RAW, TAX) loads several seconds after the page.
MONEY_READY_JS = """
(typeof TT !== 'undefined' && Array.isArray(TT) && TT.length > 0
  && typeof BEVO_RAW !== 'undefined' && Array.isArray(BEVO_RAW) && BEVO_RAW.length > 0
  && typeof TAX !== 'undefined' && Array.isArray(TAX) && TAX.length > 0)
"""

MONEY_JS = """
(() => {
  try {
    const key = (c) => String(c || '').toUpperCase().trim().replace(/_\\d+$/, '');
    const out = {};
    TT.forEach(t => {
      const k = key(t.van_don); if (!k) return;
      const p = prefOf(t), dk = p.den_dk, ch = p.den_chot, h = hhOf(t);
      const reasons = [...new Set((Array.isArray(t.phan_bo_kho) ? t.phan_bo_kho : []).map(x => lyttLabel(x)).filter(Boolean))];
      out[k] = {
        dkAmount: dk && dk.tien != null ? num(dk.tien) : '',
        dkAt: dk && dk.at ? String(dk.at) : '',
        chotAmount: ch && ch.tien != null ? num(ch.tien) : '',
        chotAt: ch && ch.at ? String(ch.at) : '',
        damageLevel: mdLabel(h.muc_do),
        damagePosition: vtLabel(h.vi_tri),
        compReason: String(cndbLyLabel(t) || '').slice(0, 150),
        truyThuReason: reasons.join(' | ').slice(0, 200),
      };
    });
    return out;
  } catch (e) { return null; }
})();
"""

# Industry Rillnet tags on every ticket row (DM / NHC / STTP / Ecom), one value
# per client (checked 03/10: 53 clients, none mixed) — the app keeps it in the
# client_industry tab so a new Điện máy client (Komex, Pico, Smartlink…) enters
# the dashboard scope without a code change (incident #37).
INDUSTRY_JS = """
(() => {
  try {
    const by = {};
    _lbAllRows().forEach(r => {
      const k = String(r.khach || '').trim(), g = String(r.nganh_hang || '').trim();
      if (!k || !g) return;
      (by[k] = by[k] || {})[g] = ((by[k] || {})[g] || 0) + 1;
    });
    const out = {};
    Object.entries(by).forEach(([k, c]) => { out[k] = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; });
    return out;
  } catch (e) { return null; }
})();
"""

SET_RANGE_JS = """
((from, to) => {
  const setVal = (id, v) => {
    const el = document.getElementById(id) || document.querySelector(`input[name="${id}"]`);
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const ok = setVal('lbFrom', from) && setVal('lbTo', to);
  const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Lọc');
  if (btn) btn.click();
  return ok;
})(%s, %s);
"""


def _pos(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else None


def apply_money(rec, m):
    """Merge MONEY_JS row `m` into a record already carrying ENRICH_JS's
    csAmount/chotAmount, and pick the customer compensation amount.
    Latest number (user 29/09: the amount CS enters per order, revised after
    the customer's QC): đã chốt (paid, Chốt tiền file) > đền dự kiến on the
    truy thu record (revised) > the amount CS typed when ticking 💰.
    compAmountDuKien follows the page's own denDk() (the "TỔNG ĐỀN DỰ KIẾN"
    card): revised estimate, else CS tick amount, else the paid amount.
    compAmount (= sheet comp_amount, what the dashboard reads) is filled only
    for compensated cases, as before."""
    cs, cs_at = rec.pop("csAmount", ""), rec.pop("csAt", "")
    chot, chot_at = m.get("chotAmount", ""), m.get("chotAt", "")
    row_chot, row_chot_at = rec.pop("chotAmount", ""), rec.pop("chotAt", "")
    if chot == "":
        chot, chot_at = row_chot, row_chot_at
    dk, dk_at = m.get("dkAmount", ""), m.get("dkAt", "")

    base = dk if dk != "" else cs
    du_kien = _pos(base) or _pos(chot) or ""
    if _pos(chot):
        latest, src, at = chot, "chot", chot_at
    elif _pos(dk):
        latest, src, at = dk, "du_kien", dk_at
    elif _pos(cs):
        latest, src, at = cs, "cs_tick", cs_at
    else:
        latest, src, at = "", "", ""
    rec.update({
        "compAmount": latest if rec.get("compensated") else "",
        "compAmountCs": cs, "compAmountDuKien": du_kien, "compAmountChot": chot,
        "compAmountSource": src, "compAmountAt": at,
        "damageLevel": m.get("damageLevel", ""), "damagePosition": m.get("damagePosition", ""),
        "compReason": m.get("compReason", ""), "truyThuReason": m.get("truyThuReason", ""),
    })


def date_range():
    """VN-time [from, to]; `--from YYYY-MM-DD` overrides the start."""
    to = time.strftime("%Y-%m-%d", time.gmtime(time.time() + 7 * 3600))
    if "--from" in sys.argv:
        return sys.argv[sys.argv.index("--from") + 1], to
    return DATA_START, to


def main():
    if not SYNC_SECRET:
        print("Chua co bien moi truong RILLNET_SYNC_SECRET.")
        sys.exit(1)

    print("Dang ket noi voi Chrome...")
    ws_url = get_websocket_url()
    if not ws_url:
        sys.exit(1)
    # timeout=120 — CDP keep-alive (xem sheet_scraper.py: 20s qua ngan voi
    # ENRICH_JS / MONEY_JS tren 500+ ca; 0 = treo mai mai nen giu timeout co han).
    ws = websocket.create_connection(ws_url, timeout=120)

    print(f"Dieu huong toi {TARGET_URL} ...")
    send_cdp_command(ws, "Page.navigate", {"url": TARGET_URL})
    time.sleep(6)

    print("Bam 'Bao cao be vo'...")
    if not click_button(ws, "📦 Báo cáo bể vỡ", wait=5):
        # Session het han — thu khoi phuc cookie tu lan chay truoc.
        print("Khong tim thay nut 'Bao cao be vo' - thu phuc hoi session tu cookie cu...")
        if restore_cookies(ws):
            send_cdp_command(ws, "Page.navigate", {"url": TARGET_URL})
            time.sleep(6)
            if not click_button(ws, "📦 Báo cáo bể vỡ", wait=5):
                print("Phuc hoi cookie that bai - session het han, can dang nhap lai qua noVNC tren Railway.")
                ws.close()
                sys.exit(1)
            print("Phuc hoi session thanh cong tu cookie da luu.")
        else:
            print("Khong co cookie da luu - can dang nhap lan dau qua noVNC tren Railway.")
            ws.close()
            sys.exit(1)

    d_from, d_to = date_range()
    print(f"Dat khoang ngay {d_from} -> {d_to} ...")
    range_ok = False
    # The filter bar renders several seconds after the report opens (~5s seen
    # 27/09, sometimes >12s) — keep trying for up to 30s.
    for _ in range(30):
        if run_js(ws, SET_RANGE_JS % (json.dumps(d_from), json.dumps(d_to))):
            range_ok = True
            break
        time.sleep(1.0)
    if not range_ok:
        print("Khong dat duoc khoang ngay (giao dien co the da doi) - chi doc duoc ngay mac dinh.")
    time.sleep(4)

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
    # Full scan (3.5 months, 500+ cases) can take >18s to expand all groups.
    # Each lb-day table renders async after the accordion opens, so retry long.
    time.sleep(5)

    records = None
    for _ in range(25):
        records = run_js(ws, EXTRACT_TABLE_JS)
        if records:
            break
        time.sleep(2)

    if not records:
        print("Khong doc duoc bang du lieu.")
        ws.close()
        sys.exit(1)

    print(f"Doc duoc {len(records)} ca be vo/hu hong.")
    # The truy thu store (_LB.tt) loads after the table — reading too early
    # gave 0 truy thu on 27/09. Wait for it; if it never arrives, send no flags
    # (the app then keeps the previous values instead of wiping them).
    tt_size = 0
    for _ in range(30):
        tt_size = run_js(ws, "(typeof _LB !== 'undefined' && _LB && _LB.tt) ? Object.keys(_LB.tt).length : 0") or 0
        if tt_size > 0:
            break
        time.sleep(1)
    flags = run_js(ws, ENRICH_JS) if tt_size > 0 else None
    if flags:
        for rec in records:
            f = flags.get(rec["orderCode"]) or {}
            rec.update({"counted": True, **f})
        n_comp = sum(1 for r in records if r.get("compensated"))
        n_tt = sum(1 for r in records if r.get("truyThu") == "co")
        print(f"Trang thai: {n_comp} don da chot den bu, {n_tt} ca co truy thu.")
    else:
        for rec in records:
            rec["counted"] = True
        print("Khong doc duoc trang thai den bu/truy thu (giao dien co the da doi).")
    full_scan = d_from <= DATA_START
    client_industry = run_js(ws, INDUSTRY_JS) if tt_size > 0 else None
    print(f"Nganh theo khach (Rillnet): {len(client_industry or {})} khach, DM: {sum(1 for v in (client_industry or {}).values() if v == 'DM')}")
    cards = parse_report_cards(run_js(ws, "document.body.innerText") or "")
    print(f"The trang bao cao: {cards}")

    print("Dieu huong toi trang Den bu / Truy thu...")
    send_cdp_command(ws, "Page.navigate", {"url": "https://rillnet.ghn.vn/truythu.html"})
    time.sleep(4)
    ready = False
    for _ in range(45):
        if run_js(ws, MONEY_READY_JS):
            ready = True
            break
        time.sleep(1)
    money = run_js(ws, MONEY_JS) if ready else None
    money_read = bool(flags) and bool(money)
    if money_read:
        for rec in records:
            apply_money(rec, money.get(rec["orderCode"]) or {})
        comp = [r for r in records if r.get("compensated")]
        with_amt = [r for r in comp if r.get("compAmount") not in ("", None)]
        print(f"Tien den: {len(with_amt)}/{len(comp)} don da chot den bu co so tien, tong {sum(r['compAmount'] for r in with_amt)}d")
    else:
        print("Khong doc duoc tien den tren trang Den bu / Truy thu - giu so cu.")

    # The Tổng hợp cards are rendered once when the tab opens; opened before
    # the data has loaded they stay at 0 (the cause of the empty
    # raw_compensation_summary since ~16/09) — so open it only once ready.
    click_button(ws, "📊 Tổng hợp", wait=3)
    tong = parse_compensation_summary(run_js(ws, "document.body.innerText") or "")
    if not tong["csTickCount"]:
        print("Khong doc duoc trang Tong hop den bu.")
        tong = {k: None for k in tong}
    else:
        print(f"Tong hop: CS tick {tong['csTickCount']} don, den du kien {tong['totalAmount']}d, den da chot {tong['totalChotAmount']}d")
    compensation_summary = None
    if tong["csTickCount"] or cards["caseCount"] is not None:
        compensation_summary = {**tong, **cards, "rangeFrom": d_from, "rangeTo": d_to, "scope": "all"}

    # Luu cookie truoc khi dong WebSocket — cho phep lan chay tiep theo tu phuc
    # hoi session ma khong can dang nhap lai qua noVNC.
    save_cookies(ws)
    ws.close()

    payload = {"records": records, "compensationSummary": compensation_summary, "fullScan": full_scan,
               "flagsRead": bool(flags), "moneyRead": money_read, "clientIndustry": client_industry or None}
    if "--dry" in sys.argv:
        with open("/tmp/rillnet_dry.json", "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False)
        print("--dry: khong gui len app, da ghi /tmp/rillnet_dry.json")
        return

    try:
        res = requests.post(
            f"{APP_BASE_URL}/api/rillnet-sync",
            headers={"Content-Type": "application/json", "X-Sync-Secret": SYNC_SECRET},
            json=payload,
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
