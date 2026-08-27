import { readFileSync } from "fs";
import { google } from "googleapis";

const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const BRAIN_SHEET_NAME = "AI_Brain";
const spreadsheetId = process.env.GOOGLE_SHEET_ID_PROJECTS || process.env.SHEET_ID_PROJECTS || process.env.GOOGLE_SHEET_ID;

function getAuth() {
  const keyFile = String(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || "").trim();
  const scopes = ["https://www.googleapis.com/auth/spreadsheets"];
  if (keyFile) {
    return new google.auth.GoogleAuth({ keyFile, scopes });
  }
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY env var");
  const credentials = JSON.parse(keyJson);
  return new google.auth.GoogleAuth({ credentials, scopes });
}

async function ensureBrainSheet(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === BRAIN_SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: BRAIN_SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${BRAIN_SHEET_NAME}'!A1:H1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["Timestamp", "Type", "Topic", "Insight", "Source", "Confidence", "UsedCount", "LastUsed"]],
      },
    });
    console.log("Created AI_Brain sheet with headers.");
  }
}

const BRAIN_TYPES = {
  USER_PREF: "user_preference",
  BUSINESS: "business_insight",
  CORRECTION: "correction",
  FAQ: "faq",
  PATTERN: "pattern",
};

const insights = [
  {
    type: BRAIN_TYPES.PATTERN,
    topic: "PSD vận hành",
    insight: "Dự án PSD (Miền Nam/Trung/Bắc): kho lấy hàng tại KCN Đông Hưng, Dĩ An, Bình Dương. Volume 50-200 CBM/ngày (HCM ~50%, Hà Nội ~20%). Cut-off booking: 11h00 → xe pick 13h30 cùng ngày; sau 17h00 hôm trước → pick 13h30 hôm sau. SLA 2-6 ngày tùy cấp vùng, đơn ở xã/huyện +1 ngày.",
    confidence: 0.85,
    source: "SOP PSD (Google Doc)",
  },
  {
    type: BRAIN_TYPES.PATTERN,
    topic: "FRT hư hỏng - sản phẩm để đứng",
    insight: "SOP FRT kho tổng B2C có bảng chi tiết 'sản phẩm phải để đứng' theo từng BRAND/model (vd tủ lạnh, máy giặt LG...). Đây là nguyên nhân hư hỏng phổ biến nếu tài xế/kho không tuân thủ tư thế vận chuyển đúng (nằm ngang thay vì đứng có thể hỏng máy nén tủ lạnh). Kho giao từ Miền Nam và Hà Nội (Km16+800 QL3, Cụm CN Ô tô Nguyên Khê).",
    confidence: 0.85,
    source: "SOP FRT kho tổng B2C (Google Doc)",
  },
  {
    type: BRAIN_TYPES.BUSINESS,
    topic: "Hisense SLA chứng từ chậm",
    insight: "Dự án Hisense (kho Bình Dương): SLA thu hồi chứng từ/POD khá chậm, N+4 ngày (HCM, Đông Nam Bộ) đến N+7 ngày (Tây Nguyên, Nam Trung Bộ). Đây là điểm cần cải thiện vận hành nếu khách phàn nàn về tốc độ đối soát.",
    confidence: 0.8,
    source: "SOP Hisense (Google Doc)",
  },
  {
    type: BRAIN_TYPES.PATTERN,
    topic: "AQUA B2B KPI hợp đồng",
    insight: "Dự án AQUA B2B có KPI hợp đồng rõ ràng: tỷ lệ lấy hàng đúng giờ ≥98%, tỷ lệ hàng hư hỏng ≤1%, thời gian thu hồi POD ≤3 ngày. Kho tại Đồng Nai, phủ khu vực Nam Trung Bộ/Tây Nguyên. Đây là SOP mẫu mực nhất trong các dự án Điện Máy về độ chi tiết.",
    confidence: 0.9,
    source: "SOP AQUA B2B (Google Doc)",
  },
  {
    type: BRAIN_TYPES.PATTERN,
    topic: "Quy trình xử lý hư hỏng chuẩn (AQUA)",
    insight: "Quy trình xử lý hàng hư hỏng/móp méo chuẩn của AQUA B2B (có thể áp dụng tham khảo cho khách khác): (1) Lập biên bản sự cố tại chỗ ngay khi phát hiện - ghi mã vận đơn, tình trạng hư hỏng, ảnh hiện trường, chữ ký người nhận; (2) Phân định trách nhiệm - bất khả kháng (GHN chỉ hỗ trợ hoàn hàng, không đền bù) vs lỗi vận chuyển/đóng gói kém/tai nạn xe (GHN chịu trách nhiệm theo chính sách); (3) Quy trình đền bù - trao đổi và chốt giá trị thiệt hại với khách khi GHN có lỗi.",
    confidence: 0.85,
    source: "SOP AQUA B2B (Google Doc)",
  },
  {
    type: BRAIN_TYPES.PATTERN,
    topic: "LG Serial Number & TMS",
    insight: "Dự án LG (Electronics South + FTL) yêu cầu quản lý chặt chẽ theo số Serial (hàng giá trị cao, cần truy vết). Booking gửi qua hệ thống TMS trước 16h00 ngày D-1. Xe GHN có mặt tại ICD lúc 14h00 hàng ngày để lấy hàng LTL. Có RACI rõ: CS trực hệ thống nhận thông tin, Tài xế kiểm đếm + thao tác App RTMS, Đội GXT chịu trách nhiệm giao hàng nguyên vẹn + upload POD trong ngày.",
    confidence: 0.8,
    source: "SOP LG (Google Doc)",
  },
  {
    type: BRAIN_TYPES.PATTERN,
    topic: "Casper đặc thù hàng hóa",
    insight: "Dự án Casper (B2C, giao lẻ) là hàng cồng kềnh dễ vỡ (điều hòa, máy giặt, máy lọc không khí, tủ lạnh...), cần đặt đúng chiều khi vận chuyển. Giao daily bằng xe 8T/15T từ kho vùng (Miền Bắc/Trung/Nam). Casper còn có dịch vụ riêng 'Lắp Đặt GHN - 3T': tháo dỡ/lắp đặt/bảo trì điện máy + thiết bị nội thất thông minh tại HCM và Hà Nội - dịch vụ giá trị gia tăng ngoài vận chuyển thuần túy.",
    confidence: 0.8,
    source: "SOP Casper B2C + Casper Lắp Đặt (Google Docs)",
  },
  {
    type: BRAIN_TYPES.BUSINESS,
    topic: "Nguyễn Kim hàng không đóng gói",
    insight: "Dự án Nguyễn Kim (Miền Nam, Client ID 5425123): có mặt hàng được đánh dấu đặc biệt (highlight đỏ trong SOP) là 'hàng không đóng gói' - rủi ro hư hỏng cao hơn bình thường do thiếu lớp bảo vệ. Cần lưu ý khi phân tích nguyên nhân bể vỡ/hư hỏng cho khách này, và có thể là điểm cần đề xuất khách bổ sung đóng gói.",
    confidence: 0.75,
    source: "SOP Nguyễn Kim (Google Doc)",
  },
  {
    type: BRAIN_TYPES.PATTERN,
    topic: "Elmich khu vực Bắc",
    insight: "Dự án Elmich: kho lấy hàng tại Ninh Bình (Hà Nam cũ), phủ toàn bộ khu vực miền Bắc (Hà Nội, Hải Phòng, Hưng Yên, Phú Thọ, Quảng Ninh, Thanh Hóa, Nghệ An, Hà Tĩnh, Lạng Sơn, Lào Cai, Thái Nguyên...).",
    confidence: 0.75,
    source: "SOP Elmich (Google Doc)",
  },
  {
    type: BRAIN_TYPES.FAQ,
    topic: "SOP chưa hoàn thiện",
    insight: "Một số dự án (KAROFI, Nguyễn Kim) dùng chung 1 template SOP (Chân dung khách hàng - Mô tả vận hành - SLA - PIC) nhưng phần SLA còn để trống/sơ khai, chưa điền đầy đủ. PIC team SD phụ trách các dự án này gồm Nguyễn Thành Tân và Tống Duy Tú. SOP của Midea và Thợ Điện Máy Xanh nằm trên Confluence nội bộ (giaohangnhanh.atlassian.net), cần tài khoản đăng nhập riêng để truy cập, chưa đọc được nội dung.",
    confidence: 0.7,
    source: "Khảo sát SOP tháng 8/2026",
  },
];

async function main() {
  console.log("spreadsheetId =", spreadsheetId);
  const auth = getAuth();
  const authClient = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: authClient });

  await ensureBrainSheet(sheets);

  const now = new Date().toISOString();
  const newRows = insights.map((ins) => [
    now,
    ins.type,
    ins.topic,
    ins.insight,
    ins.source,
    String(ins.confidence),
    "0",
    now,
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${BRAIN_SHEET_NAME}'!A:H`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: newRows },
  });

  console.log(`Wrote ${newRows.length} insights to AI_Brain sheet.`);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
