/**
 * pages/api/ai-chat.js — "Tiểu Đệ SD3", 100% LTL (rebuilt 2026-09-26).
 *
 * Reads the same LTL snapshot as the dashboard (lib/ltl-snapshot.js) — no
 * Google Sheets reads on the hot path — and hands the LLM only numbers that
 * were already computed by lib/ltl-dashboard.js or lib/ai-agent-tools.js.
 * FTL, revenue/KPI doanh thu, forecasts and tasks are no longer part of this
 * dashboard: those questions get a fixed, honest answer without an LLM call.
 */
import { getSession } from "../../lib/auth";
import { loadLtlBase, loadDefaultBody } from "../../lib/ltl-snapshot";
import { computeDashboard, isPendingPickup } from "../../lib/ltl-dashboard";
import { transformLTL } from "../../lib/transform-ltl";
import {
  removeAccents,
  extractMonths,
  matchProjects,
  extractOrderCodes,
  lookupOrders,
  matchProvinces,
  compareRoutes,
  damageReport,
} from "../../lib/ai-agent-tools";
import { loadBrainContext, extractInsightsFromChat, saveBrainInsights } from "../../lib/ai-brain";
import { generateWithFallback, generateFast } from "../../lib/ai-providers";

// Router + Synthesizer are 2 sequential LLM calls with provider fallback —
// observed 10-15s+ in production; don't let Vercel cut a slow success off.
export const config = { maxDuration: 60 };

const SYSTEM_PROMPT = `Bạn tên là "Tiểu Đệ SD3" — trợ lý vận hành LTL (hàng lẻ) ngành Điện Máy của GHN, khu vực SD3.
Bạn gọi người dùng là "Đại Ca" và xưng "Tiểu Đệ" (không bao giờ dùng "tôi", "bạn").

PHẠM VI: CHỈ dữ liệu LTL Điện Máy, đơn lấy hàng từ 01/07/2026, cùng nguồn với Dashboard LTL.
KHÔNG có trong hệ thống (nếu được hỏi, nói thẳng là không có dữ liệu, KHÔNG đoán): FTL/chuyến xe/xe tải, doanh thu/NSR/KPI doanh thu, dự báo cuối tháng, tạo/giao task.

QUY TẮC CHỐNG BỊA SỐ (BẮT BUỘC):
1. Mọi con số phải lấy NGUYÊN VĂN từ "DỮ LIỆU" bên dưới. Không có trong dữ liệu → nói "Tiểu Đệ chưa có số liệu này" và gợi ý xem ở đâu trên Dashboard.
2. KHÔNG tự cộng/trừ/nhân/chia, KHÔNG tự tính % thay đổi hay suy ra số mới (vd lấy tổng 2 tháng trừ 1 tháng). % / điểm thay đổi chỉ lấy từ trường "thayDoiDaTinhSan" hoặc "deltaPoints" có sẵn; không có thì chỉ nêu 2 con số trước → sau.
3. Khi nêu số, ghi rõ phạm vi: kỳ nào, dự án nào (vd "T9 (01/09–26/09)", "toàn bộ từ 07/2026").
4. Tra mã đơn: chỉ trả lời theo "traCuuDon". Mã có timThay=false → nói rõ không tìm thấy trong dữ liệu LTL Điện Máy, không đoán trạng thái.
5. Không bịa tên dự án, kho, tuyến, người phụ trách.

ĐỊNH DẠNG:
- Ngắn gọn, bullet "- ", **in đậm** tên dự án. KHÔNG hiển thị tên trường JSON (vd soDonPct, thayDoiDaTinhSan) trong câu trả lời. Emoji: 📊 số liệu, ⚠️ cảnh báo, ✅ tốt, 🔴 nguy hiểm, 📈 tăng, 📉 giảm.
- Kết thúc bằng 1 đề xuất hành động cụ thể dựa trên số liệu (vd dự án/kho cần nhắc), hoặc 1 câu hỏi gợi mở.`;

const UNSUPPORTED_REPLY = `Dạ Đại Ca, Tiểu Đệ giờ chỉ phụ trách **LTL Điện Máy** thôi ạ 🙇‍♂️
- Dashboard đã bỏ phân hệ FTL, doanh thu/KPI doanh thu, dự báo và giao task (09/2026), nên Tiểu Đệ không có dữ liệu để trả lời chính xác — Tiểu Đệ không dám đoán bừa.
- Tiểu Đệ trả lời được: số đơn/sản lượng, tỷ lệ on-time, đơn late, đơn treo quá hạn, đơn chờ lấy, bể vỡ & nguyên nhân, so sánh tuyến/kho, tra cứu mã đơn LTL.

Đại Ca muốn xem phần nào của LTL ạ?`;

const DAMAGE_WORDS = /be vo|hu hong|hong hoc|boi thuong|den bu|khieu nai|rillnet|mop|meo/;
const ROUTE_WORDS = /tuyen|chang|tu .+ (di|den|toi|ra|vao) |→|->/;
const UNSUPPORTED_WORDS = /doanh thu|revenue|\bnsr\b|run.?rate|du bao|giao task|tao task|giao viec/;

const tan = (grams) => Math.round(grams / 1e5) / 10;
const pctOf = (o, n) => (n > 0 ? Math.round((o / n) * 1000) / 10 : null);
const vnTime = (iso) => (iso ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" }) : null);

function buildContext(body, base) {
  const l = body.ltl;
  const pc = l.periodComparison;
  const pickupDates = base.ltlRows.map((r) => String(r.pickup_time || "").slice(0, 10)).filter(Boolean).sort();
  const ctx = {
    phamViDuLieu: {
      nguon: "Snapshot LTL Điện Máy (raw_ontime của GHN) — cùng nguồn và cùng cách tính với Dashboard",
      capNhatLuc: vnTime(body.dataAsOf),
      donLayHangTu: pickupDates[0] || null,
      donLayHangDen: pickupDates[pickupDates.length - 1] || null,
      cachTinh: "Tổng đơn tính theo ngày lấy hàng (không gồm đơn chưa lấy). On-time = đơn giao đúng hạn / đơn đã đánh giá (đã giao, hoặc chưa giao nhưng đã trễ).",
    },
    tongQuanToanBo: {
      tongDon: l.totalOrders,
      trongLuongTan: tan(l.totalWeight * 1000),
      tyLeOntime: l.evalCount > 0 ? Math.round(l.ontimePct * 10) / 10 : null,
      donDaDanhGia: l.evalCount,
      donLate: l.lateCount,
      caBeVo: l.totalBroken,
      daChotDenBuChoKhach: (l.detailedDamageCases || []).filter((c) => c.compensated).length,
      truyThuDaDuyet: (() => { const tt = (l.detailedDamageCases || []).filter((c) => c.truy_thu === "co"); return { soCa: tt.length, tongTien: tt.reduce((s, c) => s + (c.truy_thu_amount || 0), 0) }; })(),
      ghiChuHuHong: "Ca hư hỏng = danh sách Báo cáo bể vỡ của Rillnet (CS tick 💰, bù tay, đã chốt tiền). Đã chốt đền bù = Ops chấp nhận đền bù hoặc đã chốt tiền. Truy thu = thu hồi từ bên gây lỗi, không phải tiền đền cho khách.",
    },
    theoThang: Object.keys(l.ordersByMonth || {}).map((m) => {
      const o = l.ontimeByMonth?.[m] || { ontime: 0, late: 0 };
      return { thang: `T${m}`, soDon: l.ordersByMonth[m], trongLuongTan: tan((l.weightByMonth?.[m] || 0) * 1000), tyLeOntime: pctOf(o.ontime, o.ontime + o.late), donLate: o.late };
    }),
    soSanhCungKy: pc?.overall ? {
      kyNay: pc.currentRangeLabel,
      kyTruoc: pc.previousRangeLabel,
      soDon: [pc.overall.prev.orders, pc.overall.cur.orders],
      tyLeOntime: [pc.overall.prev.ontimePct, pc.overall.cur.ontimePct],
      donLate: [pc.overall.prev.lateCount, pc.overall.cur.lateCount],
      caBeVo: [pc.overall.prev.damageCount, pc.overall.cur.damageCount],
      thayDoiDaTinhSan: {
        soDonPct: pc.overall.ordersDeltaPct,
        tyLeOntimeDiem: pc.overall.ontimeDeltaPoints,
        donLate: pc.overall.cur.lateCount - pc.overall.prev.lateCount,
        caBeVo: pc.overall.cur.damageCount - pc.overall.prev.damageCount,
      },
      ghiChu: "Mỗi cặp là [kỳ trước, kỳ này]; % / điểm thay đổi lấy ở thayDoiDaTinhSan. Số đơn/on-time tăng là tốt; đơn late và ca bể vỡ GIẢM là TỐT.",
    } : null,
    onTimeGiamManh: body.anomalies?.items?.length
      ? { soVoi: body.anomalies.compareLabel, nguong: "giảm ≥ 10 điểm, mỗi kỳ ≥ 5 đơn đã đánh giá", duAn: body.anomalies.items }
      : "Không có dự án nào giảm on-time ≥ 10 điểm so với kỳ trước",
    donTreoQuaHan: body.stuck ? {
      dinhNghia: "Đã lấy hàng, chưa giao/hoàn/hủy, đã quá ngày hạn giao — tính đến hôm nay, không phụ thuộc tháng",
      tongSo: body.stuck.count,
      theoSoNgayQuaHan: body.stuck.byAge,
      duAnNhieuNhat: body.stuck.topClients,
    } : null,
    donChoLayHang: body.pendingPickup ? { tongSo: body.pendingPickup.count, theoTrangThai: body.pendingPickup.byStatus, ghiChu: "Chưa có ngày lấy hàng nên không tính vào tổng đơn" } : null,
    theoDuAn: Object.values(l.projectSummaries || {})
      .sort((a, b) => b.totalOrders - a.totalOrders)
      .map((p) => ({ duAn: p.name, soDon: p.totalOrders, trongLuongTan: tan(p.totalWeight * 1000), tyLeOntime: pctOf(p.ontimeCount, p.evalCount), donLate: p.lateCount, caBeVo: p.damageCount || 0 })),
    tuyenNhieuDonNhat: (l.routeStats || []).slice(0, 8).map((r) => ({ tuyen: `${r.from} → ${r.to}`, soDon: r.orders })),
    khoCanhBao: (l.warehouseAlerts || []).slice(0, 5).map((w) => ({ kho: w.warehouse, donLate: w.late, caBeVo: w.broken })),
  };
  return ctx;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const session = await getSession(req, res);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });
  // UI hides the chat button for cs (dashboard.js), but that's not
  // enforcement — block it here too so a direct API call can't bypass it.
  if (session.user.role === "cs") {
    return res.status(403).json({ error: "Vai trò CS không có quyền dùng Tiểu Đệ" });
  }

  const { message, history = [] } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Vui lòng nhập câu hỏi" });
  }

  try {
    const role = session.user.role || "manager";
    const clientProject = role === "client" ? session.user.project || null : null;
    const params = {
      role, userPic: session.user.pic || null,
      months: null, projects: clientProject ? [clientProject] : null, filterMode: "pickup",
      viewAsType: clientProject ? "client" : "manager", viewAsValue: null,
      dateFrom: null, dateTo: null, origin: null, periodWeeks: "mtd",
    };

    const [base, defaultBody, brainContext] = await Promise.all([
      loadLtlBase(),
      clientProject ? null : loadDefaultBody(),
      loadBrainContext().catch(() => ""),
    ]);
    const body = defaultBody || computeDashboard(base, params);
    const allProjects = body.ltl.allProjects || [];
    const text = removeAccents(message);

    // ── 1. Router: intent only; the tools below decide on hard signals too.
    let intent = "DATA_QUERY";
    try {
      const routerRes = await generateFast({
        systemPrompt: "Chỉ trả về JSON hợp lệ, không có text nào khác.",
        userPrompt: `Phân loại câu hỏi của quản lý vận hành LTL: "${message}"
Chọn MỘT intent:
- ORDER_LOOKUP (tra cứu 1 hay nhiều mã đơn cụ thể)
- ROUTE_COMPARE (so sánh/hỏi về tuyến, tỉnh đi → tỉnh đến, chặng)
- DAMAGE_QUERY (bể vỡ, hư hỏng, bồi thường, khiếu nại, nguyên nhân hỏng)
- DATA_QUERY (số đơn, sản lượng, on-time, late, đơn treo, đơn chờ lấy, dự án, kho LTL)
- UNSUPPORTED (hỏi dữ liệu FTL/chuyến xe/xe tải, doanh thu/NSR/KPI doanh thu, dự báo, tạo/giao task)
- CHITCHAT (chào hỏi, khen, mắng, nói chuyện phiếm)
Lưu ý: hỏi "tuyến LTL nào nên chuyển sang FTL" là ROUTE_COMPARE/DAMAGE_QUERY, không phải UNSUPPORTED.
Trả về: {"intent":"TÊN_INTENT"}`,
        temperature: 0.1,
      });
      const m = routerRes.text.match(/\{[\s\S]*\}/);
      if (m) intent = JSON.parse(m[0]).intent || intent;
    } catch (e) {
      console.warn("[ai-chat] router failed, fallback DATA_QUERY:", e.message);
    }

    const codes = extractOrderCodes(message);
    if (intent === "UNSUPPORTED" || (UNSUPPORTED_WORDS.test(text) && !codes.length)) {
      return res.status(200).json({ ok: true, reply: UNSUPPORTED_REPLY });
    }

    // ── 2. Tools (deterministic, same snapshot as the dashboard)
    const ctx = buildContext(body, base);
    const months = extractMonths(message);
    let projects = matchProjects(message, allProjects);
    if (clientProject) projects = [clientProject];

    if (codes.length) {
      let found = lookupOrders(base, codes);
      if (clientProject) found = found.map((o) => (o.timThay && o.duAn !== clientProject ? { maDon: o.maDon, timThay: false, ghiChu: "Không thuộc dự án của bạn" } : o));
      ctx.traCuuDon = found;
    }

    // Exact numbers for the month/project the question names — the same
    // computation the dashboard runs when those filters are selected.
    if (months || (projects.length && !clientProject)) {
      const k = computeDashboard(base, { ...params, months, projects: projects.length ? projects : params.projects, kpiOnly: true });
      ctx.soLieuDungTheoCauHoi = {
        phamVi: `${months ? months.map((m) => `T${m}`).join(", ") : "toàn bộ từ 07/2026"} · ${projects.length ? projects.join(", ") : "tất cả dự án"}`,
        tongDon: k.totalOrders, tyLeOntime: k.ontimePct == null ? null : Math.round(k.ontimePct * 10) / 10, donLate: k.lateCount, caBeVo: k.totalBroken,
      };
      if (projects.length) {
        ctx.soLieuDungTheoCauHoi.onTimeTungDuAn = Object.fromEntries(
          Object.entries(k.ontimeByProject || {}).filter(([n]) => projects.includes(n))
            .map(([n, o]) => [n, { tyLeOntime: pctOf(o.ontime, o.ontime + o.late), donLate: o.late, donDaDanhGia: o.ontime + o.late }]),
        );
      }
    }

    // Week-by-week movers for the current month (for "tuần này giảm do khách nào").
    const curMonth = new Date(Date.now() + 7 * 3600 * 1000).getUTCMonth() + 1;
    if (/tuan/.test(text)) {
      const weekly = transformLTL(base.ltlRows.filter((r) => !isPendingPickup(r)), { months: [curMonth], filterMode: "pickup", projects: params.projects });
      const weeks = Object.keys(weekly.ordersByMonth || {}).map(Number).sort((a, b) => a - b);
      if (weeks.length >= 2) {
        const [wPrev, wLast] = weeks.slice(-2);
        const movers = Object.entries(weekly.ordersByProjectAndWeek || {})
          .map(([name, byWeek]) => ({ duAn: name, tuanTruoc: byWeek[wPrev] || 0, tuanNay: byWeek[wLast] || 0, chenhLech: (byWeek[wLast] || 0) - (byWeek[wPrev] || 0) }))
          .filter((m) => m.chenhLech !== 0);
        ctx.soSanhTuanTrongThang = {
          thang: `T${curMonth}`, tuanTruoc: wPrev, tuanGanNhat: wLast,
          soDonTheoTuan: weekly.ordersByMonth,
          giamNhieuNhat: movers.filter((m) => m.chenhLech < 0).sort((a, b) => a.chenhLech - b.chenhLech).slice(0, 5),
          tangNhieuNhat: movers.filter((m) => m.chenhLech > 0).sort((a, b) => b.chenhLech - a.chenhLech).slice(0, 5),
        };
      }
    }

    const provinces = matchProvinces(message, base.ltlRows);
    if (provinces.length && (intent === "ROUTE_COMPARE" || ROUTE_WORDS.test(text) || provinces.length >= 2)) {
      ctx.soSanhTuyen = {
        phamVi: `${months ? months.map((m) => `T${m}`).join(", ") : "toàn bộ từ 07/2026"} · ${projects.length ? projects.join(", ") : "tất cả dự án"} · tỉnh: ${provinces.join(", ")}`,
        tuyen: compareRoutes(base, { provinces, months, projects: projects.length ? projects : params.projects }),
      };
    }

    if (intent === "DAMAGE_QUERY" || DAMAGE_WORDS.test(text)) {
      ctx.nguyenNhanBeVo = damageReport(base, { projects: projects.length ? projects : params.projects });
      ctx.tuyenTyLeBeVoCao = (body.aiInsights?.breakageRoutes || []).slice(0, 5)
        .map((r) => ({ tuyen: r.route, tongDon: r.total, caBeVo: r.damaged, tyLePct: r.rate, goiY: r.suggestion }));
    }

    // ── 3. Synthesizer
    const historyFormatted = Array.isArray(history) && history.length
      ? history.map((h) => `${h.role === "user" ? "Đại Ca" : "Tiểu Đệ"}: ${h.text}`).join("\n")
      : "(chưa có)";
    const chitchat = intent === "CHITCHAT"
      ? "\nĐây là câu giao tiếp phiếm: trả lời ngắn, vui vẻ, lịch sự; không cần nêu số liệu nếu không liên quan."
      : "";

    let replyText = "";
    try {
      // Compact JSON (no indentation) keeps the prompt under Groq's TPM cap.
      const result = await generateWithFallback({
        systemPrompt: SYSTEM_PROMPT + brainContext,
        userPrompt: `DỮ LIỆU (JSON, chỉ được dùng số trong này):\n${JSON.stringify(ctx)}\n\nLỊCH SỬ HỘI THOẠI:\n${historyFormatted}\n\nCÂU HỎI CỦA ĐẠI CA: "${message}"${chitchat}\n\nTrả lời đúng trọng tâm theo các quy tắc. Nếu DỮ LIỆU không có thông tin cần thiết, nói rõ là chưa có số liệu.`,
        temperature: 0.1,
      });
      // Smaller fallback models sometimes slip out of persona.
      replyText = result.text.replace(/(^|[^\p{L}])(tôi|Tôi)(?![\p{L}])/gu, (m, pre) => pre + "Tiểu Đệ");
    } catch (providerErr) {
      console.warn("[ai-chat] All providers failed:", providerErr.message);
      replyText = "Dạ Đại Ca, Tiểu Đệ tạm thời mất kết nối với các máy chủ AI 🙇‍♂️ Đại Ca thử lại sau ít phút giúp em nhé!";
    }

    // Fire-and-forget: learn from this exchange (lib/ai-brain.js).
    if (replyText) {
      extractInsightsFromChat({
        message,
        reply: replyText,
        userName: session.user.name || session.user.email,
        projectsList: allProjects.map((name) => ({ name })),
      })
        .then((insights) => insights.length > 0 && saveBrainInsights(insights.map((i) => ({ ...i, source: session.user.email || "chat" }))))
        .catch((e) => console.warn("[ai-chat] brain save error:", e.message));
    }

    return res.status(200).json({ ok: true, reply: replyText });
  } catch (err) {
    console.error("[/api/ai-chat] Error:", err);
    return res.status(500).json({ error: "Lỗi xử lý AI Agent: " + err.message });
  }
}
