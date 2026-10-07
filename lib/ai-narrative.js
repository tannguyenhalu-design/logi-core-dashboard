/**
 * lib/ai-narrative.js
 * Turns the already-computed LTL insight numbers (breakage routes, capacity
 * routes, period-comparison deltas) into a short Vietnamese narrative via
 * Gemini — the rest of the AI Insights tab is rule-based math; this is the
 * one call that actually reasons over it in natural language.
 */
import { generateWithFallback } from "./ai-providers";

const SYSTEM_PROMPT = `Bạn là chuyên viên phân tích vận hành logistics cho đội Solution Điện Máy tại GHN.
Bạn nhận một khối JSON số liệu đã tính sẵn (nội dung và cấu trúc có thể khác nhau tuỳ màn hình — dự án, task, tuyến vận chuyển, so sánh kỳ...) và viết nhận định ngắn cho người đọc.

QUY TẮC BẮT BUỘC:
- CHỈ được nhắc tới số liệu/tên xuất hiện đúng trong JSON được cung cấp. Tuyệt đối không bịa thêm số liệu, tên tuyến, tên dự án, hay % nào không có trong JSON.
- Nếu JSON không chứa trường nào đó (ví dụ không có "route"/"tuyến"), không được tự suy diễn hay nhắc tới khái niệm đó.

ĐỊNH DẠNG BẮT BUỘC — người đọc lướt nhanh, KHÔNG đọc đoạn văn dài:
- Viết dạng bullet ("- " đầu dòng), TỐI ĐA 6 bullet, mỗi bullet 1 câu ngắn (không quá ~20 từ).
- Mỗi bullet phải thuộc đúng 1 trong các loại sau, và bắt đầu bằng emoji tương ứng:
  🆕 = khách hàng kỳ trước không có đơn nhưng kỳ này có đơn trở lại (trường "newOrReturningClients" nếu có trong JSON) — nêu tên khách và số đơn. KHÔNG khẳng định đây là khách hoàn toàn mới hay khách cũ quay lại (dữ liệu không phân biệt được điều đó), chỉ nói "có đơn trở lại".
  🔴 hoặc ⚠️ = một chỉ số cụ thể (ontime, hư hỏng, số đơn, sản lượng...) đang có vấn đề — nêu ĐÚNG TÊN chỉ số + con số, không viết chung chung "cần chú ý". Nếu JSON có trường "damageByProject" (danh sách dự án đang có ca hư hỏng trong kỳ, đã xếp theo số ca giảm dần) — LUÔN dành riêng ít nhất 1 bullet loại này nêu tên (các) dự án có nhiều ca hư hỏng nhất kèm đúng số ca (và % thay đổi so với kỳ trước nếu có) — đây là loại thông tin người đọc quan tâm nhất, không được gộp chung chung hay bỏ qua chỉ vì đã có bullet khác về hư hỏng toàn hệ thống.
  📉 = khách hàng/tuyến giảm rõ rệt so với kỳ trước — nêu tên + % giảm.
  📈 = khách hàng ĐÃ CÓ SẴN (không phải mới/quay lại) tăng trưởng mạnh (trường "growingClients" nếu có) — nêu tên + % tăng. Đây là tin tốt, viết bằng giọng ghi nhận thành tích, không phải cảnh báo.
  🎉 = một chỉ số vận hành cải thiện rõ rệt thành tin đáng khoe — đặc biệt: khách hàng có bể vỡ kỳ trước nhưng kỳ này về 0 (trường "damageResolvedClients" nếu có), hoặc chỉ số hư hỏng/late toàn hệ thống giảm mạnh. Nêu cụ thể tên khách/chỉ số, không nói chung chung "vận hành tốt".
  ✅ = chỉ dùng khi thực sự không có bullet nào khác để viết (không có vấn đề, không có tăng trưởng nổi bật, không có tin gì đặc biệt) — tối đa 1 bullet loại này, không cố bịa.
- KHÔNG được để toàn bộ nhận định chỉ toàn cảnh báo/giảm sút — nếu JSON có "growingClients" hoặc "damageResolvedClients" khác rỗng, LUÔN dành ít nhất 1 bullet 📈 hoặc 🎉 cho tin tốt đó, đặt xen giữa các bullet vấn đề chứ không dồn hết xuống cuối hay bỏ qua.
- Thứ tự: bullet nghiêm trọng nhất (🔴) đứng đầu nếu có, nhưng tin tốt (📈/🎉/🆕) không bị đẩy xuống cuối cùng chỉ vì là tin tốt — ưu tiên theo mức độ đáng chú ý, không theo cực tính tốt/xấu. Nếu có đề xuất hành động, gộp luôn vào cuối bullet đó (không viết thành câu riêng).
- Không dùng markdown heading (#), không in đậm toàn câu, không mở đầu bằng câu chào hỏi hay giới thiệu.
- Nếu JSON có danh sách khách hàng mới xuất hiện (đơn kỳ trước = 0, kỳ này > 0) — LUÔN đưa ít nhất 1 khách vào bullet 🆕 nếu có, đây là loại thông tin người đọc quan tâm nhất.

KHI PHÂN TÍCH BỂ VỠ/HƯ HỎNG (nếu JSON có "breakageRoutes"/"damageRootCauses"/"damageTrend"/"recentCases") — người đọc cần đủ thông tin để tự đưa ra phương án vận hành, không chỉ biết "có vấn đề":
- Nếu có "damageTrend": so curDamageCount với prevDamageCount, nói rõ xu hướng đang XẤU ĐI hay TỐT LÊN cho đúng phạm vi (scope) đó — dùng 🔴/⚠️ nếu tăng, 🎉 nếu giảm về 0 hoặc giảm mạnh. Đừng chỉ nêu số hiện tại mà bỏ qua so sánh.
- Nếu có "recentCases" (nghĩa là tổng số ca đang ít, dưới 8 ca — tỷ lệ % theo tuyến lúc này KHÔNG đủ ý nghĩa thống kê): PHẢI nhắc cụ thể ít nhất 1 mã đơn (orderCode) + kho (warehouse) hoặc chặng (leg) liên quan trong bullet, thay vì chỉ nói "X% bể vỡ" — vì với mẫu quá nhỏ, con số % dễ gây hiểu lầm nghiêm trọng hơn thực tế.
- Nếu có "damageRootCauses.byLeg": chặng nào chiếm tỷ trọng cao nhất thì đề xuất hành động cụ thể theo ĐÚNG chặng đó (vd nếu "Trung chuyển → Kho giao" chiếm đa số, đề xuất kiểm tra đóng gói/thao tác tại bước trung chuyển, không đề xuất chung chung).
- Nếu có "damageRootCauses.byClient": PHẢI nêu tên (các) dự án/khách hàng chiếm tỷ trọng ca hư hỏng cao nhất kèm số ca + % trong ít nhất 1 bullet riêng — người đọc cần biết hư hỏng đang tập trung ở dự án nào để làm việc trực tiếp với khách/kho phụ trách dự án đó, đây là ưu tiên cao hơn cả phân tích theo chặng (byLeg).`;

function generateFallbackNarrative(insights) {
  const parts = [];
  if (insights.overall) {
    const o = insights.overall;
    const ordersDirection = (o.ordersDeltaPct ?? 0) >= 0 ? "tăng" : "giảm";
    const weightDirection = (o.weightDeltaPct ?? 0) >= 0 ? "tăng" : "giảm";
    const ontimeDirection = (o.ontimeDeltaPoints ?? 0) >= 0 ? "tăng" : "giảm";

    const overallEmoji = (o.ontimeDeltaPoints ?? 0) < 0 || (o.ordersDeltaPct ?? 0) < 0 ? "⚠️" : "✅";
    parts.push(
      `${overallEmoji} Tổng quan so với cùng kỳ: Số đơn ${ordersDirection} ${Math.abs(o.ordersDeltaPct || 0)}%, khối lượng ${weightDirection} ${Math.abs(o.weightDeltaPct || 0)}%, Ontime ${ontimeDirection} ${Math.abs(o.ontimeDeltaPoints || 0)} điểm.`
    );
  }
  if (insights.warningItems && insights.warningItems.length > 0) {
    const names = insights.warningItems.slice(0, 5).map((w) => w.name).join(", ");
    parts.push(
      `📉 ${insights.warningItems.length} khách hàng/tuyến cần ưu tiên kiểm tra do giảm sút: ${names}.`
    );
  }
  if (insights.newOrReturningClients && insights.newOrReturningClients.length > 0) {
    const names = insights.newOrReturningClients.slice(0, 5).map((c) => `${c.name} (${c.orders} đơn)`).join(", ");
    parts.push(`🆕 Có đơn trở lại/mới trong kỳ: ${names}.`);
  }
  if (insights.growingClients && insights.growingClients.length > 0) {
    const g = insights.growingClients[0];
    parts.push(`📈 ${g.name} tăng trưởng mạnh, đơn hàng tăng ${g.ordersDeltaPct}% so với kỳ trước.`);
  }
  if (insights.damageResolvedClients && insights.damageResolvedClients.length > 0) {
    const names = insights.damageResolvedClients.map((c) => c.name).join(", ");
    parts.push(`🎉 ${names} không còn ghi nhận ca bể vỡ nào trong kỳ này.`);
  }
  if (insights.damageByProject && insights.damageByProject.length > 0) {
    const names = insights.damageByProject.slice(0, 3).map((c) => `${c.name} (${c.damageCount} ca)`).join(", ");
    parts.push(`🔴 Dự án đang có ca hư hỏng trong kỳ: ${names}.`);
  }
  if (insights.damageRootCauses?.byClient?.length > 0) {
    const top = insights.damageRootCauses.byClient[0];
    parts.push(`🔴 Dự án "${top.label}" chiếm tỷ trọng ca hư hỏng cao nhất: ${top.count} ca (${top.pct}%).`);
  }
  if (insights.breakageRoutes && insights.breakageRoutes.length > 0) {
    const r = insights.breakageRoutes[0];
    parts.push(`🔴 Tuyến ${r.route} ghi nhận tỷ lệ hư hỏng cao đáng chú ý (${r.rate}% với ${r.damaged} ca).`);
  }
  if (parts.length === 0) {
    return "- ✅ Tình hình vận hành ổn định, sản lượng và chỉ số đúng giờ duy trì đạt kế hoạch.";
  }
  return parts.map((p) => `- ${p}`).join("\n");
}

const SYSTEM_PROMPT_MAP = `Bạn là chuyên viên phân tích vận hành logistics cho đội Solution Điện Máy tại GHN.
Bạn nhận một khối JSON số liệu tổng hợp theo ngành hàng + địa lý (tỉnh thành, kho) và viết nhận định ngắn.

QUY TẮC BẮT BUỘC:
- CHỈ được nhắc tới số liệu/tên xuất hiện đúng trong JSON. Tuyệt đối không bịa thêm số liệu.
- Nếu JSON không chứa trường nào, không tự suy diễn hay nhắc tới khái niệm đó.

ĐỊNH DẠNG — người đọc lướt nhanh, KHÔNG đọc đoạn văn dài:
- Viết dạng bullet ("- " đầu dòng), TỐI ĐA 6 bullet, mỗi bullet 1 câu ngắn (không quá ~20 từ).
- Mỗi bullet bắt đầu bằng 1 emoji theo loại:
  🔴 = vấn đề nghiêm trọng (ontime < 85%, kho vượt 90% tải, tỉnh nhiều hư hỏng) — nêu tên tỉnh/kho + con số cụ thể.
  ⚠️ = cảnh báo cần theo dõi (ontime 85–90%, kho 70–90% tải).
  📊 = so sánh giữa ngành (STTP vs DM, NHC vs tổng) hoặc so kỳ trước.
  📍 = coverage gap — tỉnh/vùng thiếu phủ sóng hoặc không có kho.
  📈 = điểm sáng — tỉnh ontime tốt, kho dư năng lực, ngành tăng trưởng.
  🎯 = đề xuất hành động cụ thể — kho cần ưu tiên, tỉnh cần tăng cường.
  ✅ = chỉ khi thực sự không có vấn đề nào — tối đa 1 bullet.
- Thứ tự: bullet nghiêm trọng nhất đứng đầu. Nếu có điểm sáng, không bị dồn xuống cuối.
- Không dùng markdown heading, không in đậm toàn câu, không mở đầu bằng câu chào.
- Nếu JSON có "coverageGap": LUÔN có ít nhất 1 bullet 📍 nêu tỉnh thiếu phủ sóng.
- Nếu JSON có "nearCapWarehouses": LUÔN có ít nhất 1 bullet 🔴/⚠️ nêu tên kho + % tải.

KHI PHÂN TÍCH NGÀNH STTP (thực phẩm):
- Lưu ý SLA thực phẩm thường chặt hơn DM — nếu có so sánh ontimeSttp vs ontimeDm, đánh giá theo tỷ lệ, không chỉ con số tuyệt đối.

KHI PHÂN TÍCH NGÀNH NHC (nội thất chung):
- Tập trung vào mạng lưới tỉnh: tỉnh nào có đơn mà không có kho giao gần, shipper nhân lực mỏng.

KHI PHÂN TÍCH TỔNG 4 NGÀNH:
- Ưu tiên so sánh cross-industry, bottleneck hạ tầng kho ảnh hưởng toàn bộ.`;

function generateFallbackMapNarrative(mapIndustry, data) {
  const parts = [];
  const industryLabel = mapIndustry === "nhc" ? "NHC" : mapIndustry === "sttp" ? "STTP" : mapIndustry === "all" ? "Tổng 4 ngành" : "Điện Máy";

  if (data.nearCapWarehouses?.length > 0) {
    const top = data.nearCapWarehouses[0];
    const color = top.utilPct >= 90 ? "🔴" : "⚠️";
    parts.push(`${color} Kho ${top.label} đang ở ${top.utilPct}% tải GTC — cần theo dõi sát.`);
  }
  if (data.lowOntimeProvinces?.length > 0) {
    const p = data.lowOntimeProvinces[0];
    parts.push(`🔴 ${p.name} ontime ${p.ontimePct}% — thấp nhất ${industryLabel}, ưu tiên kiểm tra.`);
  }
  if (data.coverageGap?.length > 0) {
    const names = data.coverageGap.slice(0, 3).map((p) => p.name).join(", ");
    parts.push(`📍 Tỉnh có đơn ${industryLabel === "Điện Máy" ? "DM" : industryLabel} nhưng chưa có kho phủ: ${names}.`);
  }
  if (data.topProvinces?.length > 0) {
    const p = data.topProvinces[0];
    parts.push(`📈 ${p.name} dẫn đầu sản lượng ${industryLabel} với ${p.orders} đơn.`);
  }
  if (data.nearCapProvinces?.length > 0) {
    const p = data.nearCapProvinces[0];
    parts.push(`⚠️ Tỉnh ${p.name} đang ở ${p.pct}% năng lực kho (tổng 4 ngành).`);
  }
  if (parts.length === 0) {
    return `- ✅ Vận hành ${industryLabel} ổn định trên bản đồ tỉnh thành hiện tại.`;
  }
  return parts.map((p) => `- ${p}`).join("\n");
}

export async function generateMapNarrative(mapIndustry, data) {
  const industryLabel = mapIndustry === "nhc" ? "NHC" : mapIndustry === "sttp" ? "STTP" : mapIndustry === "all" ? "Tổng 4 ngành" : "Điện Máy";
  try {
    const result = await generateWithFallback({
      systemPrompt: SYSTEM_PROMPT_MAP,
      userPrompt: `Ngành đang xem: ${industryLabel}\n\nDữ liệu (JSON) — chỉ dùng đúng thông tin trong đây:\n\n${JSON.stringify(data, null, 2)}\n\nViết nhận định ngắn cho tab bản đồ tỉnh thành.`,
      temperature: 0.3,
    });
    if (result.text) return result.text;
  } catch (err) {
    console.warn(`[ai-narrative] Map narrative failed (${err.message}), using fallback.`);
  }
  return generateFallbackMapNarrative(mapIndustry, data);
}

export async function generateInsightNarrative(insights) {
  // Used to retry only across 3 Gemini models — if Gemini alone was
  // rate-limited/over quota, every attempt failed together and this
  // silently dropped to the bare-bones fallback text below (no bullets,
  // no emoji, missing the 🆕 new-client callout entirely). Route through
  // the shared provider chain instead (Groq first, Gemini as backup) so a
  // Gemini-only outage doesn't take the narrative down with it.
  try {
    const result = await generateWithFallback({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Dữ liệu (JSON) cần phân tích — chỉ dùng đúng thông tin trong đây:\n\n${JSON.stringify(insights, null, 2)}\n\nViết nhận định.`,
      temperature: 0.3,
    });
    if (result.text) return result.text;
  } catch (err) {
    console.warn(`[ai-narrative] All providers failed (${err.message}), using fallback text.`);
  }
  return generateFallbackNarrative(insights || {});
}
