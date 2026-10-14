/**
 * scripts/seed_sops_knowledge.mjs
 * Seed/update SOP entries trong Vercel Blob sops-knowledge.json
 * Chạy: node scripts/seed_sops_knowledge.mjs
 */
import { readFileSync } from "fs";
import { put, get } from "../node_modules/@vercel/blob/dist/index.js";

// ── Load .env.local ───────────────────────────────────────────────────────────
const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=["']?(.+?)["']?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!TOKEN) throw new Error("Missing BLOB_READ_WRITE_TOKEN in .env.local");

const BLOB_PATH = "sops-knowledge.json";

// ── Helpers ───────────────────────────────────────────────────────────────────
async function loadKB() {
  try {
    const blob = await get(BLOB_PATH, { access: "private", token: TOKEN });
    if (!blob) { console.log("  (empty KB, starting fresh)"); return []; }
    const text = await new Response(blob.stream).text();
    const j = JSON.parse(text);
    return Array.isArray(j) ? j : [];
  } catch (e) {
    console.warn("loadKB error:", e.message, "– starting fresh");
    return [];
  }
}

async function saveKB(entries) {
  await put(BLOB_PATH, JSON.stringify(entries, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: TOKEN,
  });
}

function entry(id, title, category, content, tags) {
  return {
    id,
    title,
    category,
    content: content.slice(0, 10000),
    tags: tags || [],
    updatedAt: new Date().toISOString(),
    updatedBy: "seed-script",
  };
}

// ── SOP DigiWorld miền Bắc ───────────────────────────────────────────────────
const digiworld = entry(
  "sop_digiworld_bn",
  "SOP DigiWorld B2B miền Bắc",
  "vận chuyển",
  `SOP Vận hành B2B Điện Máy - DigiWorld miền Bắc

## I. Chân dung khách hàng
- Khách hàng: DigiWorld | Client ID: 5409695
- Shop ID LTL: 653382 | Shop ID FTL: 6534079
- Ngành hàng: Điện tử (IT, RAM), Điện máy (Tủ lạnh, Tivi)
- Dịch vụ: FTL (2 xe 1T9 + 1 xe 8T/ngày) + LTL (1 xe 8T/ngày)
- Sản lượng: 250 CBM/ngày; Trial: 30% (~75 CBM/ngày)
- Kho lấy hàng: Kho Bigway, Kim Nỗ, Đông Anh
- Tuyến giao: FTL miền Bắc-miền Bắc; LTL cả nước
- Onboard: 20/07/2026

## II. Quy trình FTL (13 bước)
1. Tiếp nhận Booking: DigiWorld gửi file Excel qua email/group hàng ngày
   - Cut-off trước 12:00 ngày D → xe đến 13:30 ngày D
   - Cut-off trước 17:00 ngày D → xe đến 08:00 ngày D+1
2. Kiểm tra & Xác nhận: CS tổng hợp booking chuẩn (mã DO, SKU, số lượng, kích thước, trọng lượng, loại hàng, điểm giao)
3. Lập kế hoạch vận tải:
   - Xe 1T9: 12 CBM, sàn 7m²
   - Xe 5T: 20 CBM, sàn 12m²
   - Xe 8T: 40 CBM, sàn 20m²
   - FTL chỉ nhận 1-3 điểm giao
4. Điều xe: GSVT phản hồi trong 1 tiếng; gửi BKS xe, tài xế, CCCD cho DigiWorld xác nhận
5. Check-in kho: Tài xế xuất trình BKS, CCCD, áo phản quang, giày
6. Tiếp nhận hàng: Chỉ nhận hàng nguyên vẹn (không đứt seal, không móp thùng); quay video hiện trạng; ký nhận 100%
7. Chất xếp + niêm phong: Seal cáp/nhựa, chụp ảnh 2-3 góc, gửi vào Gtalk nội bộ
8. Nhận chứng từ: Lệnh xuất bán + Phiếu serial + HĐGTGT (mỗi loại 1 bản/bộ)
   → Thu hồi tờ lệnh xuất bán có 4 chữ ký trong 24h sau GTC
9. Rời kho: Cập nhật "Đã lấy hàng" trên hệ thống; không tự ý dỡ niêm phong
10. Giao hàng & đồng kiểm: BẮT BUỘC QUAY VIDEO tại điểm nhận
    - Cao Phong: không booking, T2-CN 08:00-16:00
    - Điện Máy Xanh: cần booking giờ giao với kho GXT
    - Nguyễn Kim: không booking, 08:00-16:00
11. Đối chiếu & ký nhận: nếu từ chối → lập Biên bản trả hàng có chữ ký, quấn màng co hoàn về
12. Hoàn tất: Upload ảnh POD lên Gtalk + hệ thống GHN ngay sau GTC
13. Thu hồi chứng từ: ePOD upload ngay; POD cứng về kho lấy trong 24h sau GTC

### Timeline ePOD (2.1.1):
- 09:30 ngày D: CS tổng hợp ePOD cần gửi
- 16:00 D – 10:00 D+1: GSVT tick trạng thái (Đã gửi/chưa gửi/thất lạc)
- 10:00 D+1: CS check + nhắc bổ sung qua Gtalk
- 10:00 – 17:00 D+1: GSVT bổ sung ePOD còn thiếu
- 17:00 D+1: CS chốt danh sách thiếu
- 09:00 D+2 – 15:00 D+3: GSVT đi trình ký lại + gửi lại ePOD

## III. Quy trình LTL (14 bước)
Route: Kho DigiWorld → Kho B2B → Kho HAN02 → KTC/KCT → Kho GXT → Giao hàng
Bước 1-8 tương tự FTL (tiếp nhận, kiểm tra, lập kế hoạch, điều xe, check-in, nhận hàng, chất xếp, nhận chứng từ)
9. Trung chuyển:
   - Kiểm tra seal + lập biên bản mở niêm phong nếu bất thường tại mỗi kho
   - Đối chiếu kiện hàng tại từng điểm; tái niêm phong sau mỗi điểm
   - Ghép hàng Ecom tại kho HAN02 trước khi về KTC
10. Xuất kho đi giao từ kho GXT → điểm nhận cuối
11-14. Tương tự FTL (giao hàng, đối chiếu, hoàn tất, thu hồi chứng từ)

## IV. SLA (tính từ Hà Nội)
- HN → HN: D+1
- HN → Miền Bắc gần (Bắc Ninh, Hải Phòng, Nam Định, Thanh Hóa, Quảng Ninh...): D+2
- HN → Miền Trung (Nghệ An, Đà Nẵng, Huế, Quảng Bình, Tuyên Quang...): D+3
- HN → Miền Nam (HCM, Bình Dương, Đồng Nai, Khánh Hòa, Bình Định...): D+4
- HN → Miền Nam xa (Cần Thơ, Long An, Vũng Tàu, Bến Tre, Trà Vinh...): D+5
- HN → Tây Nguyên & vùng xa (An Giang, Đăk Lăk, Cà Mau, Kiên Giang...): D+6
Ngoại lệ SLA: qua chủ nhật, LTC sau 19:00 → +1 ngày

POD cứng: tài xế nộp 2-3 ngày sau GTC; GHN trả DigiWorld max 7 ngày từ GTC
Hoàn hàng: theo yêu cầu DigiWorld từng trường hợp

## V. KPI
- Ontime giao: 95%
- Ontime return: tính từ ngày GTB, SLA theo SLA giao, target 98%
- Ontime chứng từ: tính từ ngày GTC, SLA 7 ngày
- Ngoại lệ KPI: qua chủ nhật, LTC sau 19:00 → +1 ngày

## VI. PIC
- SD: Nguyễn Thành Tân, Nguyễn Thành Đạt
- BD: Nguyễn Phú Tuấn
- Transportation FTL: Nguyễn Đức Cương
- Finance: Nguyễn Võ Quỳnh Dao
- OS: Đỗ Thị Hồng Hạnh
- CI: Nguyễn Thụy Vinh
- CS: Mai Công Nhật Quỳnh`,
  ["DigiWorld", "FTL", "LTL", "B2B", "miền Bắc", "điện máy", "SLA", "KPI"]
);

// ── SOP PSD B2B (Nam + Trung + Bắc) ─────────────────────────────────────────
const psd = entry(
  "sop_psd_b2b",
  "SOP PSD B2B (Petrosetco Distribution)",
  "vận chuyển",
  `SOP Vận hành B2B Điện Máy - PSD (Petrosetco Distribution)

## I. Chân dung khách hàng
- Khách hàng: Công ty CP Dịch vụ Phân phối Tổng hợp Dầu khí (Petrosetco Distribution - PSD)
- Client ID: 5399007
- Ngành hàng: Điện thoại (Apple, Samsung), Laptop/IT (Dell, VSP), Tủ lạnh (LG, Hitachi), TV (Coocaa), Casper
- Giá trị hàng: Apple 30-150tr; LG 10-200tr; Dell 20-100tr; Hitachi 40-60tr
- Volume: 50-200 CBM/ngày; HCM chiếm 50%, HN chiếm 20%
- Đặc điểm: Hàng giá trị cao, dễ vỡ, nguyên seal; TEM KHÔNG được dán trực tiếp lên kiện
- Booking: API từ SF → GHN hệ thống; hỗ trợ on-demand 4-6h (Van, Truck 2T, Bike)

## II. Kho & Cut-off

### Miền Nam (onboard 21/07/2026)
- Shop ID: 6530404
- Kho: KCN Đông Hưng, Dĩ An, Bình Dương
- Cut-off: trước 11:00 ngày D → xe đến 13:30 ngày D
- Cut-off: trước 17:00 ngày D-1 → xe đến 13:30 ngày D
- Dịch vụ: LTL B2B + B2C đến kho ĐMX, khách lẻ, siêu thị

### Miền Trung (onboard 17/08/2026)
- Kho: KLN đường số 3, KCN Hòa Khánh, Đà Nẵng
- Cut-off: trước 10:00 ngày D → xe đến 11:00 ngày D
- Cut-off: trước 16:00 ngày D → xe đến 16:30 ngày D
- LƯU Ý: KHÔNG thu hồi chứng từ bản cứng, chỉ thu ePOD
- Hoàn hàng về kho Trung: LG, CASPER HA, COMFEE, ELECTROLUX
- Hoàn hàng về kho Nam: các nhãn còn lại

### Miền Bắc (PSL)
- PSL Thạch Thất: Shop ID 6521368
- PSL Tràng An: Shop ID 6584304

## III. SLA (theo SLA Bulky - phân 3 vùng)
- Vùng 1 (Nam): HCM, Bình Dương, Đồng Nai, Vũng Tàu, ĐBSCL, Tây Nguyên...
- Vùng 2 (Trung): Đà Nẵng, Quảng Bình, Quảng Nam, Quảng Ngãi, Quảng Trị, Huế
- Vùng 3 (Bắc): Hà Nội, Hải Phòng, các tỉnh miền Bắc, Nghệ An, Hà Tĩnh
SLA nội thành: 2-3 ngày; Nội vùng: 2-4 ngày; Liên vùng: 3-5 ngày; Liên vùng tỉnh: 4-6 ngày
Xã/Huyện: cộng thêm 1 ngày

## IV. Quy trình vận hành
1. Booking qua API SF → GHN; CS kiểm tra đủ thông tin
2. Lập kế hoạch: Xe 1T9 12CBM / Xe 5T 20CBM / Xe 8T 40CBM; cố định 2 xe 8T đầu vận hành
3. Check-in kho: CCCD, áo phản quang, giày; điền thông tin tại bảo vệ
4. Tiếp nhận hàng: kiểm đếm + quay video ngoại quan; từ chối kiện móp/rách/dán băng keo lạ
5. Chất xếp: xếp theo tuyến giao, niêm phong seal, chụp ảnh 2-3 góc
6. Nhận chứng từ tại kho (Nam/Trung): Phiếu xuất kho + Hóa đơn VAT + Phiếu serial
7. Giao hàng: BẮT BUỘC QUAY VIDEO; ĐMX booking giờ; Cao Phong/NK không cần booking
8. Thu hồi: POD cứng tài xế nộp 2-3 ngày; GHN trả PSD max 7 ngày từ GTC
   Miền Trung: chỉ thu ePOD, không thu bản cứng
9. Hoàn hàng: theo chỉ định PSD từng trường hợp`,
  ["PSD", "Petrosetco", "B2B", "điện máy", "LTL", "miền Nam", "miền Trung", "miền Bắc", "Apple", "LG"]
);

// ── SOP Hisense B2B ───────────────────────────────────────────────────────────
const hisense = entry(
  "sop_hisense_b2b",
  "SOP Hisense B2B",
  "vận chuyển",
  `SOP Vận hành B2B Điện Máy - Hisense

## I. Chân dung khách hàng
- Khách hàng: Hisense (điện tử gia dụng)
- Client ID FTL: 5229706 | Shop ID FTL: 6328385
- Client ID LTL: 5266220 | Shop ID LTL: 6370353
- Kho lấy hàng: BW Dong An 2 Logistics Park, KCN Đồng An, Bình Hòa, Bình Dương (HCM)
- Volume: 100-150 CBM/ngày; onboard 25/05/2026
- FTL (≤3 điểm giao): xe GSVT cố định (3 xe 8T)
- LTL (>3 điểm giao): xe KHL linh động

## II. Booking & Cut-off
- FTL & LTL cut-off: trước 11:00 ngày D → xe đến 13:30 ngày D
- FTL & LTL cut-off: trước 16:30 ngày D → xe đến sáng ngày D+1
- Flow booking: Hisense/SF gửi → GHN via Zalo/nền tảng
- Thời gian chốt booking: 2 tiếng kể từ khi SF gửi

## III. Quy trình lấy hàng tại kho
1. Check-in: điền thông tin tại quầy bảo vệ kho Hisense
2. Tiếp nhận hàng:
   - Kiểm đếm số lượng theo PO/DN; kiểm tra ngoại quan từng kiện
   - GSVT GHN: kiểm tra chứng từ, in tem mã GHN, xử lý sự cố
   - Tủ lạnh/máy giặt: LUÔN đặt đứng, KHÔNG nằm ngang (cả Hisense và GHN phụ trách)
3. Chứng từ nhận tại kho:
   - Phiếu xuất kho (2 bản)
   - Danh sách Serial (1 bản)
   - Hóa đơn VAT (1 bản)
   - PO (1 bản) – chỉ khi bên nhận là siêu thị điện máy, The Giới Di Động
4. Ký nhận: tài xế + đại diện kho Hisense ký POD
5. LƯU Ý: Sau giao thành công → thu hồi Phiếu xuất kho có chữ ký KH

## IV. Trung chuyển LTL
Route: Kho Hisense → Kho B2B → Kho HCM01 → KTC/KCT → Kho GXT → Giao hàng
- Kiểm tra seal tại mỗi điểm; lập biên bản mở niêm phong nếu bất thường
- Ghép hàng Ecom tại kho HCM01 trước khi sang KTC

## V. Giao hàng
- Cao Phong: không cần booking, T2-CN 08:00-16:00; đến kho nộp chứng từ, để SĐT, lấy số thứ tự
- Điện Máy Xanh: cần đặt lịch trước; kho GXT xác nhận khung giờ
- Siêu thị: không cần booking
- Nguyễn Kim: không cần booking, 08:00-16:00
- Tài xế liên hệ người nhận trước 1 tiếng
- BẮT BUỘC: POD phải có tối thiểu 3 chữ ký (Kho xuất, Người nhận, Tài xế)
- SLA báo cáo sự cố: 30 phút; HISENSE phản hồi: 30 phút

## VI. Thu hồi chứng từ
- POD cứng: tài xế nộp D+2 về văn phòng HCM
- Bàn giao hàng tháng: từ ngày 26/D đến cuối/D (nội dung từ 26/D-1 đến 25/D)
- Đơn vị: SF → Hisense
- SLA POD Return (FTL): N+4 đến N+8 tùy vùng; (LTL): N+6 đến N+10
- Email xác nhận giao thành công: trong 6h từ GTC

## VII. PIC
- SD FTL: Nguyễn Thành Đạt (datnt2@ghn.vn)
- SD LTL: Tống Duy Tú (tutd@ghn.vn)
- CS: Mai Công Nhật Quỳnh (quynhmcn@ghn.vn)
- OS: Đỗ Thị Hồng Hạnh`,
  ["Hisense", "FTL", "LTL", "B2B", "điện máy", "BW Dong An", "Bình Dương"]
);

// ── SOP Elmich B2B ────────────────────────────────────────────────────────────
const elmich = entry(
  "sop_elmich_b2b",
  "SOP Elmich B2B",
  "vận chuyển",
  `SOP Vận hành B2B Điện Máy - Elmich

## I. Chân dung khách hàng
- Khách hàng: Công ty CP ELMICH | Client ID: 4691072
- Ngành hàng: Gia dụng (Chảo, nồi cơm điện, bình giữ nhiệt...)
- Loại dịch vụ: LTL B2B từ kho tổng ELMICH đến hệ thống siêu thị
- Volume: 20-25 CBM/ngày
- Kho lấy 1: Đường Ngô Gia Bảy, Xã Bình Mỹ, Ninh Bình (Hà Nam cũ) | Shop ID: 5675645
- Kho lấy 2: Số 1 Nhà Vườn, Yên Xá, Tân Triều, Hà Nội | Shop ID: 6467559
- Tuyến giao: Tập trung miền Trung → Bắc; HN và Hải Phòng sản lượng cao nhất

## II. Booking & Cut-off
- Trước 16:00 ngày D-1: Elmich gửi file booking qua Zalo/Mail (bắt buộc có CBM)
- 18:00 ngày D-1: GHN chốt số lượng đơn lấy ngày D
- 11:00 ngày D: xe GHN đến kho lấy hàng
- Booking gồm: danh sách đơn xuất kho, thông tin điểm giao, số kiện, trọng lượng, kích thước, chủng loại

## III. Quy trình lấy hàng tại kho
1. Tài xế đến kho 09:00; xuất trình CCCD, áo phản quang, giày
2. Kiểm đếm: kiểm tra hàng chẵn (seal hộp đầy đủ) + hàng lẻ (đếm từng sản phẩm trong thùng)
3. Quay video ngoại quan + ký nhận 100%; từ chối kiện móp/rách/dán băng keo lạ
4. Chứng từ nhận tại kho:
   - 02 Phiếu xuất kho
   - 01 Hóa đơn
   - 01 Phiếu Serial
   → BẮT BUỘC thu hồi 01 Phiếu xuất kho khi rời kho (trả 01 cho kho)
5. Niêm phong seal cáp/nhựa; chụp ảnh 2-3 góc; gửi Telegram nội bộ
6. Cập nhật "Đã lấy hàng" trên hệ thống

## IV. Trung chuyển (Miền Bắc)
Route: Kho Elmich → Kho B2B → HAN02/Hưng Yên → KTC/KCT
- Kiểm tra seal tại mỗi điểm trung chuyển
- Ghép hàng Ecom tại HAN02 trước khi sang KTC

## V. Giao hàng
- Trung Tâm Thương Mại (Lotte...): không booking, T2-CN 08:00-16:00; đến hầm xe đăng ký "Giao hàng cho Siêu thị"; Thu hồi: Hóa đơn VAT
- Minimart/Winmart: không booking, 08:00-16:00; gặp trực tiếp NV cửa hàng; Thu hồi: Phiếu PO
- Tòa nhà công ty: gọi SĐT KH; Thu hồi: Phiếu xuất kho
- Cao Phong: không booking, T2-CN 08:00-16:00; nộp chứng từ, để SĐT, lấy số thứ tự
- Điện Máy Xanh: booking giờ giao qua kho GXT
- Nguyễn Kim: không booking, 08:00-16:00
- BẮT BUỘC QUAY VIDEO ngoại quan tại điểm nhận để miễn trừ trách nhiệm

## VI. Thu hồi chứng từ
- ePOD upload lên hệ thống GHN ngay sau GTC
- POD cứng: tài xế nộp 2-3 ngày sau GTC; GHN trả Elmich max 7-10 ngày từ GTC
- Chứng từ bàn giao hàng tháng qua OS team; lưu trữ tại VP HCM (Thành Thái)
- Địa chỉ hoàn trả chứng từ: Đường Ngô Gia Bảy, Xã Bình Mỹ, Ninh Bình; Chị Mai kho TP (0966495198)

## VII. SLA tuyến (từ Ninh Bình)
- Hà Nam, Đà Nẵng, Lai Châu: D+1/D+3
- HN, Bắc Ninh, Hưng Yên: D+2/D+3
- Hải Phòng, Thanh Hóa, Nghệ An: D+2/D+4
- Khánh Hòa, Đồng Nai, HCM: D+4/D+5
- ĐBSCL, Tây Nguyên, vùng xa: D+5/D+6

## VIII. KPI
- Ontime giao: ≥95%; Mất/hỏng: ≤0.5%/tháng; Hoàn: ≤0.5%/tháng
- SLA POD: 7 ngày từ GTC; SLA Return: case by case
- SLA không tính Chủ nhật/ngày lễ

## IX. PIC
- SD: Nguyễn Thành Đạt (datnt2@ghn.vn), Tống Duy Tú (tutd@ghn.vn)
- CS: Huỳnh Diệu Thuận (thuanhd@ghn.vn)
- BD: Lê Thị Thanh Hoa (hoaltt@ghn.vn)
- OS: Nguyễn Ngọc Nhiệm (nhiemnn@ghn.vn)`,
  ["Elmich", "LTL", "B2B", "gia dụng", "miền Bắc", "siêu thị", "Winmart", "Lotte"]
);

// ── SOP Aqua B2B ──────────────────────────────────────────────────────────────
const aqua = entry(
  "sop_aqua_b2b",
  "SOP Aqua B2B",
  "vận chuyển",
  `SOP Vận hành B2B Điện Máy - Aqua B2B

## I. Chân dung khách hàng
- Khách hàng: Công ty Aqua | Client ID: 4964358 (Aqua B2B)
- Ngành hàng: Điện tử gia dụng (Tivi, Tủ lạnh, Máy giặt, Máy lạnh)
- Kho lấy hàng:
  + ICD Đồng Nai (kho chính - Miền Nam)
  + Kho Hưng Yên (Miền Bắc)
- Cách tạo đơn: mỗi DN trên waybill = 1 mã đơn GHN

## II. Booking & Cut-off
- Booking qua Zalo (SF/Aqua → GHN)
- Trước 12:30 ngày D → xe đến trước 16:00 ngày D
- Sau 12:30 ngày D → xe đến sáng ngày D+1
- Booking gửi sau 17:00 → GHN phản hồi kế hoạch trước 10:00 D+1
- Thông tin tài xế gửi: trước 14h (chuyến chiều) / trước 20h (chuyến sáng hôm sau)

## III. Phân loại hình thức
- FTL: 1-3 điểm giao (không cần ghép kho)
- LTL: 3+ điểm giao (qua kho trung chuyển)
- Xe: 1T9 12 CBM / 5T 20 CBM / 8T 40 CBM

## IV. Lấy hàng tại kho ICD Đồng Nai
1. Check-in: tài xế đăng ký trước với bảo vệ (ICD có danh sách)
2. Tiếp nhận hàng:
   - Đội hiện trường GHN có mặt hỗ trợ tài xế
   - Kiểm đếm theo PO/DN/Serial; từ chối kiện bất thường
   - Tủ lạnh/máy giặt: LUÔN đặt đứng, KHÔNG nằm ngang
   - Tivi: đứng đúng chiều, không để dưới kiện nặng, có đệm lót
   - Dán nhãn GHN lên dây rút (KHÔNG dán trực tiếp lên thùng) cho hàng LTL
3. Chứng từ nhận tại kho (theo điểm giao):
   - "Công ty": Phiếu xuất kho (1) + Hóa đơn VAT (1) + Phiếu giao nhận hàng hóa (2)
   - Điểm còn lại: Phiếu xuất kho (1) + Hóa đơn VAT (1) + Phiếu giao nhận hàng hóa (2) + Phiếu serial (1)
4. Ký nhận: cả 2 bên ký; tài xế xuất trình Phiếu xuất kho cho bảo vệ khi ra

## V. Giao hàng
- ĐMX và Cao Phong: đặt lịch trước 1-2 ngày; siêu thị/NK không cần booking
- Cao Phong: nộp chứng từ, để SĐT, chờ gọi; T2-CN 08:00-16:00
- POD phải có TỐI THIỂU 3 chữ ký: Kho xuất hàng + Người nhận + Tài xế
- Tài xế cần chụp ảnh tình trạng kiện hàng trước khi mở tại điểm giao
- LTL sau giao: tài xế "revert" trên app; FTL: CS báo OM hoàn tất đơn
- Email xác nhận giao thành công trong 6h từ GTC

## VI. Xử lý từ chối
- ĐMX: có thể nhận 1 phần (cần biên bản sự cố + biên bản trả + hóa đơn GTGT) hoặc trả toàn bộ
- Cao Phong: trả toàn bộ; GHN đề xuất 2 phương án (điều chỉnh hóa đơn / đổi kiện mới)
- Hàng hoàn mặc định về kho xuất ban đầu

## VII. Thu hồi chứng từ
- POD cứng: tài xế gửi về trong D+2 (tỉnh xa D+3)
- GHN gửi POD gốc cho Aqua trong 7 ngày từ GTC
- POD hợp lệ: đủ chữ ký bên giao + bên nhận + bên xuất; Phiếu serial phải có dấu mộc đỏ Aqua (trừ NK)

## VIII. SLA leadtime (từ Đồng Nai)
- Đồng Nai/HCM/Bình Dương/Vũng Tàu/Long An/Tiền Giang/Bến Tre: D+1
- Bình Định, Phú Yên, Khánh Hòa, Ninh Thuận, Gia Lai, KonTum, Đăk Lăk, Lâm Đồng: D+2
- ĐBSCL (Cần Thơ, Vĩnh Long, Kiên Giang, An Giang, Cà Mau...): D+2

### Từ Hưng Yên (Miền Bắc):
- HN/Hà Nam/Hải Dương/Hải Phòng/Thái Bình/Nam Định/Ninh Bình/Bắc Ninh/Vĩnh Phúc: D+1 (HY→HY: D+0)
- Hòa Bình/Tuyên Quang/Bắc Kạn/Lạng Sơn/Thái Nguyên/Bắc Giang/Quảng Ninh/Phú Thọ/Thanh Hóa: D+1
- Nghệ An/Hà Tĩnh/Lào Cai/Điện Biên/Yên Bái/Sơn La/Hà Giang/Cao Bằng: D+2

## IX. Escalation & PIC
- Escalation khẩn: Nguyễn Thành Tân (tannt@ghn.vn, 0932207179)
- CS GHN: Mai Ý Nhi (nhimy@ghn.vn, 0339696916)
- CS sự cố: Trần Anh Thư (thuta@ghn.vn, 0931921520)
- Commercial GHN: Ngô Thanh Tính (tinhnt@ghn.vn)
- PIC chính Aqua/SF: Huỳnh Anh Dũng (0913703012, huynh.anh.dung@sf-express.com)
- PIC Miền Bắc Aqua: Trần Thị Như Phương (0353390998)
- PIC Miền Nam Aqua: Đỗ Thị Thanh Ngân (0367676973)`,
  ["Aqua", "B2B", "FTL", "LTL", "điện máy", "ICD Đồng Nai", "Hưng Yên", "SF Express"]
);

// ── SOP Smartlink B2B ─────────────────────────────────────────────────────────
const smartlink = entry(
  "sop_smartlink_b2b",
  "SOP Smartlink B2B",
  "vận chuyển",
  `SOP Vận hành B2B Điện Máy - Smartlink (|B2B GHN| SOP SMARTLINK OFFICIAL v2.0)

## I. Chân dung khách hàng
- Khách hàng: CÔNG TY TNHH CÔNG NGHỆ SMART-LINK VIỆT NAM
- Client ID: 5438335 (từ 01/10/2026 – hiện tại) | trước: 5507636 (21/09-30/09)
- Sản phẩm: Robot hút bụi, đồng hồ, điện thoại, đồ gia dụng (brand: Dreame độc quyền, Eufy, Amazfit, Bear, Joyoung, Soundcore)
- Giá trị TB/đơn: ~20 triệu VNĐ
- Sản lượng: 2-5 tấn/ngày

## II. Kho lấy hàng & Cut-off
- Địa chỉ: Lô 3G-9, Đường số 14, KCN SLP Park Long Hậu, Cần Giuộc, Long An
  Định vị: 10° 37' 55.591" N 106° 42' 13.5832" E
- PIC kho: Mr. Dương – SĐT: 0367 757 177
- Giờ kho: 08:00-20:00 (không nghỉ trưa)
- Giờ lấy hàng: cố định 13:00-18:00, thứ 2 - thứ 7
- Cổng lấy hàng B2B: Cổng 13, 14, 15
- Booking: Smartlink gửi 15:00-17:45 ngày D; CS tạo đơn trong vòng 1h

## III. Quy trình lấy hàng (tại kho Smartlink)
- Xe cố định: 1 xe 5T + 02 nhân sự onsite cố định (giai đoạn trial)
- Gửi thông tin xe trước cho Smartlink: BKS xe, tài xế, SĐT, CCCD; nhân sự onsite: CCCD + SĐT
- Quy cách tạo đơn: 1 mã SO Smartlink = 1 mã đơn GHN = 1/nhiều kiện
  (Mã SO là 6 số, tương đương PO, là cơ sở tính công nợ)
- Nhân sự GHN đồng kiểm với nhân viên Smartlink:
  * Số kiện thực nhận khớp biên bản bàn giao
  * Mã hàng/SKU trên kiện khớp chứng từ mã SO tương ứng
- Dán mã đơn GHN + chứng từ lên kiện sau khi đối chiếu xong
- Riêng đơn AEON: ghi chú thêm mã đơn hàng riêng của AEON bên cạnh mã SO

## IV. Giao hàng
- KHÔNG liên hệ người gửi/người nhận khi giao – mọi vấn đề liên hệ CS
- Bộ chứng từ tiêu chuẩn: 5 tờ
  * 01 Hóa đơn VAT
  * 02 Đơn đặt hàng Smartlink
  * 01 Biên bản bàn giao hàng hóa/thiết bị
  * 01 Đơn đặt hàng riêng (nếu điểm giao yêu cầu: AEON, CellphoneS, Nguyễn Kim)
- Upload 2 ảnh EPOD lên hệ thống GHN:
  * 1 ảnh: người nhận ký biên bản + có mộc điểm giao
  * 1 ảnh: đơn hàng tại điểm giao
- Không thu hồi chứng từ bản cứng (ePOD là cơ sở đối soát công nợ – thiếu/sai phải ký lại)

## V. Đặc thù từng điểm giao
| Điểm giao | Booking | Xếp tài | Giờ giao |
|---|---|---|---|
| Cao Phong | Không cần | Có | 08:00-16:00 (T7: 09:00-11:00, 14:00-16:00) |
| ĐMX/MWG cửa hàng | Không cần | - | - |
| ĐMX/MWG kho | Booking tại logistic.thegioididong.com | - | T2-T7 |
| AEON SOUTH RDC | CS booking (app AEON trước 18h ngày D) | Có | 07:00-15:00 |
| EMART | Đăng ký tại cổng | Có | - |
| Con Cưng | Theo hệ thống QR | Có | - |
| CellphoneS | Không cần | Không | - |
| Nguyễn Kim | Không cần | Có | 08:00-21:00 |
| FPT Shop | Không cần | Không | 08:00-22:00 |
| FRT kho tổng | - | Mùa cao điểm | T2-sáng T7: 08:00-17:00 |
| Thiên Nam Hòa | Không cần | Không | - |
| Viettel Store | Không cần | Không | - |

Giao AEON SOUTH RDC – trình tự:
1. Quét QR check-in cổng (bảo vệ giữ CCCD, cấp thẻ NCC)
2. Nộp chứng từ: Phiếu DO + Hóa đơn điện tử + chứng từ phụ
3. Di chuyển xe vào dock theo chỉ định
4. AEON quét HHT, kiểm hạn SD, ghi số lượng vào phiếu
5. Nhận chứng từ trả về; quét QR check-out
Lưu ý AEON từ chối nếu: vượt SL PO, hàng hỏng, hạn SD thiếu (<70% nội địa/<50% NK), thiếu CT

Con Cưng – yêu cầu trang bị: áo phản quang + giày bảo hộ + cục chặn bánh xe (2 cái)
Cao Phong – địa chỉ kho tổng HCM: 277B Cách Mạng Tháng 8, Q.10 (tòa nhà Thiên Nam Hòa, xuống hầm)

## VI. Xử lý sự cố & hoàn hàng
- Tất cả đơn hoàn về: quấn xốp nổ 3 lớp; hoàn trong 7 ngày kể từ xác nhận hoàn
- AEON từ chối: ghi nhận lý do, báo Rillnet → CS liên hệ Smartlink
- Mất chứng từ: báo Rillnet xin lại, có chứng từ kho in lại rồi giao
- Xe sự cố: báo Gtalk nhóm dự án Smartlink để CS/SD trao đổi dời PO

## VII. PIC GHN
- Giải pháp vận hành (SD): Tân Nguyễn Thành | Vi Diệp Thúy
- Booking (CS): Quỳnh Mai Công Nhật
- Sorting (OS): Hạnh Đỗ Thị Hồng
- PIC Smartlink: Mr. Dương – 0367 757 177`,
  ["Smartlink", "LTL", "B2B", "điện máy", "Dreame", "Eufy", "Long An", "AEON", "Cao Phong", "DMX"]
);

// ── Danh sách entries cần seed ───────────────────────────────────────────────
const ENTRIES = [
  digiworld,
  psd,
  hisense,
  elmich,
  aqua,
  smartlink,
];

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("📚 Loading existing knowledge base...");
  const existing = await loadKB();
  console.log(`  Found ${existing.length} existing entries`);

  let updated = [...existing];
  for (const e of ENTRIES) {
    const idx = updated.findIndex((x) => x.id === e.id);
    if (idx >= 0) {
      updated[idx] = e;
      console.log(`  ✏️  Updated: [${e.id}] ${e.title} (${e.content.length} chars)`);
    } else {
      updated.push(e);
      console.log(`  ➕ Added:   [${e.id}] ${e.title} (${e.content.length} chars)`);
    }
  }

  console.log(`\n💾 Saving ${updated.length} entries to Vercel Blob...`);
  await saveKB(updated);
  console.log("✅ Done!");

  // Verify
  const verify = await loadKB();
  console.log(`\n🔍 Verification: ${verify.length} entries in KB:`);
  for (const e of verify) {
    console.log(`  - [${e.id}] ${e.title} (${e.content.length} chars, cat: ${e.category})`);
  }
}

main().catch((e) => { console.error("❌ ERROR:", e.message); process.exit(1); });
