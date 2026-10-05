# Tổng hợp Hệ thống SD3 Dashboard Điện Máy
> Tài liệu tổng hợp mọi vấn đề nghiệp vụ, kỹ thuật và AI mà hệ thống đã xử lý.
> Cập nhật lần cuối: 2026-10-04. Nguồn chuẩn: `SYSTEM_SPEC.md`.

---

## 1. Hệ thống là gì?

Dashboard nội bộ GHN theo dõi chất lượng vận chuyển **LTL Điện Máy** — từ đơn hàng, on-time, hư hỏng, đến báo cáo công ty và thử nghiệm giải pháp. Dữ liệu lấy từ Google Sheets (scraper tự động), lưu snapshot trên Vercel Blob, phục vụ ~4 vai trò (Manager, SD3, CS, Client) qua web app Next.js.

**Phạm vi dữ liệu:** Đơn LTL Điện Máy từ 01/07/2026, ~131.344 dòng, ~13 khách chủ lực (Aqua, LG, Hisense, DigiWorld, PSD, Samsung, Casper, v.v.).

---

## 2. Vấn đề nghiệp vụ đã xử lý

### 2.1 Theo dõi chất lượng vận chuyển
| Vấn đề | Cách xử lý |
|---|---|
| Không biết on-time thực tế đang ở đâu | Dashboard LTL: thẻ KPI on-time, so sánh cùng kỳ, cảnh báo dự án < 90% |
| Không biết đơn nào sắp trễ hạn hôm nay | Lọc nhanh "⏰ Đến hạn hôm nay" — danh sách đơn đã lấy, chưa giao, hạn = hôm nay |
| Đơn treo không ai xử lý nhiều ngày | Khung "Đơn treo / cần chú ý" với danh sách đơn và kho liên quan |
| Không biết tuyến nào rủi ro cao | Lọc nhanh "⚠ Tuyến rủi ro cao"; bản đồ heatmap theo tỉnh giao |
| Sụt giảm on-time không phát hiện kịp | Widget "Cần can thiệp ngay hôm nay": top 3 vấn đề = tuyến trễ SLA + bể vỡ tăng đột biến + on-time giảm mạnh |

### 2.2 Quản lý hư hỏng (Hư hỏng & Rủi ro)
| Vấn đề | Cách xử lý |
|---|---|
| Không biết bể vỡ tập trung ở tuyến/kho nào | Ma trận Kho lấy × Miền giao; top tuyến rủi ro; điểm nóng trên bản đồ |
| Không biết tổng tiền đền cho khách | Khung "💰 Tiền đền cho khách" theo kỳ + dự án + tuyến; đối chiếu với Rillnet |
| Ca bể vỡ còn mở chưa xử lý | Khung "Ca còn mở" — tách riêng ca chưa đóng |
| Khách nào tái phát bể vỡ nhiều | Khung "Tuyến/khách tái phát" — đếm ca lặp lại cùng tuyến |
| Không biết chặng nào nghi vấn | Khung "Chặng nghi vấn theo tuyến" — lọc đơn có ca ở cùng chặng nhiều lần |
| Số tiền đền lấy ở đâu | Scraper Rillnet lấy tự động tiền đền cho 82/82 ca đã chốt (596,5 triệu đồng) |

### 2.3 Báo cáo công ty định kỳ
| Vấn đề | Cách xử lý |
|---|---|
| Mỗi tuần phải tính tay báo cáo Excel | Tab "Báo cáo công ty": tải Excel 1 click (Ontime · Bể vỡ · Hàng hoàn · FTL · Insight) |
| Số thay đổi sau khi đã gửi | "Chốt số" lưu báo cáo vào Blob; mục "Số đã đổi kể từ lúc chốt" |
| Báo cáo 2 tuần chỉ so đúng 2 tuần trước | Bố cục 4 tuần + cột "2 tuần trước" + "Kỳ này" + ± (triển khai 28/09) |
| Không biết cách tính on-time của công ty | Khớp công thức: cờ `odr_success`, loại đơn hoàn/huỷ — trùng 41/41 ô với file công ty |
| Báo cáo kỳ giữa chừng khi sếp cần gấp | Kỳ "đang diễn ra" hiện đầu ô chọn kỳ, số đến thời điểm đó |
| B2B/B2C bố cục khác nhau từng khách | "Cài đặt kênh khách hàng": Manager cấu hình kênh + dòng riêng + thứ tự cho từng khách |

### 2.4 Đo lường giải pháp cải tiến (Sổ tay)
| Vấn đề | Cách xử lý |
|---|---|
| Không biết giải pháp tách tuyến có thật sự hiệu quả không | Sổ tay: đo trước/sau từ snapshot LTL + ca Rillnet, không tính tay |
| Số "trước/sau" phụ thuộc mùa vụ, không khách quan | Nhóm đối chứng = đơn cùng khách ngoài phạm vi giải pháp → hiệu quả ròng |
| Giải pháp nhiều giai đoạn (Trial 1 → Trial 2 → Nhân rộng) khó theo dõi | Mô hình giải pháp nhiều giai đoạn, chip trạng thái, biểu đồ tuần theo từng giai đoạn |
| Sau khi thành công không biết có duy trì không | "Theo dõi sau thành công": bảng tháng/tuần + cảnh báo ⚠ khi bể vỡ tăng hoặc on-time giảm |
| Cohort vs real-time: 2 cách tính bể vỡ cho kết quả khác nhau | "Đối soát 2 góc nhìn": ma trận cohort × real-time + cảnh báo khi ngược hướng |
| Giải pháp chỉ phủ 3% đơn — khoảng trống còn lại ở đâu | "Độ phủ tách tuyến + khoảng trống mở rộng": tỉnh/kho chưa áp dụng + ứng viên đủ volume |
| Không có số tiền để tính ROI | Dòng tiền đền cho khách (CS nhập) trong bảng trước/sau + ước tính tiết kiệm có đối chứng |

---

## 3. Tính năng kỹ thuật đã xây

### 3.1 Kiến trúc dữ liệu
- **Google Sheets** (nguồn thô): `raw_ontime`, `raw_damage_cases`, `ActionTrials`, `ActionSolutions`, `ClientChannels`, `AI_Brain`, `Warehouses`, `WarehouseAlias`, `KhoGiaoTongTai`, `client_industry`
- **Snapshot Vercel Blob**: 2 blob — BASE (~765 KB gzip, toàn bộ LTL) + DEFAULT (~159 KB gzip, view mặc định tính sẵn). Dựng 3 lần/ngày (09:00/13:00/18:00 VN) hoặc khi bấm "Đồng bộ Google Sheet"
- **SQLite local** (`scripts/sync_to_db.js`): lưu tạm dữ liệu trước khi ghi Sheets; `CUT_DATE=2026-07-01` lọc đơn trước tháng 7

### 3.2 Scraper tự động
| Scraper | Môi trường | Lịch | Vai trò |
|---|---|---|---|
| `sheet_scraper.py` | Railway + Windows Task Scheduler | 3 lần/ngày | Đọc `raw_ontime` từ Sheets GHN, ghi DB → Sheets |
| `rillnet_scraper.py` | Railway + Windows | 3 lần/ngày | Đọc ca bể vỡ + tiền đền từ Rillnet (CDP) |
| `kpi_scraper.py` | Windows (chạy nhưng bỏ qua lỗi) | 3 lần/ngày | KPI portal — xác nhận không cần nữa 04/10 |

**Cơ chế alert (04/10):** `run_scraper.bat` kiểm exit code từng scraper → popup `msg *` trên màn hình Windows nếu fail.

**Đăng nhập Chrome bot:** User tự đăng nhập GHN SSO qua cửa sổ Chrome thật. Claude không bao giờ đăng nhập thay.

### 3.3 Auth & phân quyền
- GHN SSO v2 (OIDC), không dùng next-auth — tự viết `iron-session` + `jose`
- Cố ý không check `aud` (token GHN luôn `aud` rỗng); chống replay bằng `nonce`
- 4 vai trò: `manager`, `sd3`, `cs`, `client` (+ `pending` = chưa duyệt)
- Manager-only: quản lý user, nhật ký, trạng thái hệ thống, bộ não Tiểu Đệ, chuyển góc nhìn (viewAs)
- CS: không AI chat (chặn server), không doanh thu

### 3.4 Bản đồ tỉnh thành
- 69 tỉnh SVG + heatmap 4 chế độ (% on-time / % bể vỡ / đơn / tấn)
- Phóng/thu/kéo chỉ đổi `viewBox` (không reload)
- **Lớp Kho** (29/09): 98 chấm kho xám, to theo đơn/ngày; bấm/rê → chi tiết kho lấy + kho giao (TB, P90, ngày cao nhất)
- Toạ độ thật 93 kho giao từ tab "danh sách kho giao" GHN (98% lượt đơn có vị trí)
- Rê chuột ~9ms/lần; gom hover theo `requestAnimationFrame`

### 3.5 Cache & hiệu năng
| Tầng | TTL / cơ chế |
|---|---|
| Browser — default query | `private, max-age=60, stale-while-revalidate=300` (04/10) |
| Browser — query có bộ lọc | `private, no-store` |
| Snapshot BASE (instance) | Kiểm ETag Blob mỗi 60s |
| Full response theo bộ lọc | 5 phút, khoá theo `builtAt` + bộ lọc |
| Báo cáo công ty | 60s, khoá theo snapshot + phiên bản cấu hình kênh |
| Nhật ký | 30s/instance |
| Danh sách kỳ chốt | 5 phút/instance |

**Giữ ấm (tránh cold start Vercel):**
- Railway: `keep_warm.sh` cron `*/5 7-19 * * *`
- Windows Task Scheduler `LogicoreKeepWarm` (04/10): mỗi 5 phút, 07:00–23:00 VN → `scripts/keep_warm.ps1` ping Bearer CRON_SECRET

**Kết quả đo thực (04/10):** `/dashboard` lạnh 2,0s → ấm 152ms; Vercel function cold 519ms vs warm 270ms.

**Tối ưu payload:**
- `/api/data` mặc định: 1,15 MB → 343 KB (bản đồ tải riêng `part=map`)
- Báo cáo công ty tab mở: 778 KB → 33 KB (details tải khi bấm)
- Bỏ `aiInsights.periodComparison` + `ltl.originDetailsMap` (không component nào đọc)

### 3.6 Sự cố đã vá

| # | Ngày | Vấn đề | Cách sửa |
|---|---|---|---|
| #23 | 14/08 | CDN cache `s-maxage` → unauthenticated request nhận 200 với dữ liệu đầy đủ | Chuyển sang `private, no-store`; bỏ `s-maxage` vĩnh viễn |
| #33 | 27/09 | Sheet tự đảo ngày/tháng `case_date` → ca bể vỡ tính sai tuần | Ghi `RAW` để tránh Google Sheets tự parse |
| #35 | 28/09 | Commit phiên song song kéo code dở vào main | Revert `019666e`, kiểm lại |
| #36 | 02/10 | Ô "Tổng hợp" Rillnet trả 0 từ ~16/09 | Sửa selector + chờ biến `TT`/`BEVO_RAW`/`TAX` tải xong (tối đa 45s) |
| #37 | 03/10 | Thiếu Komex, Pico, Smartlink (482 đơn) | Thêm vào phạm vi; scraper ghi nhãn ngành `client_industry` |

---

## 4. AI — Tiểu Đệ SD3

### 4.1 Kiến trúc đa tác tử (Kế hoạch F · F2, deploy 03/10)
```
Câu hỏi user
    → Planner (1 lần gọi AI nhanh, JSON: phân rã bước + chọn tác tử + ngữ cảnh)
    → 3 tác tử chạy song song trên snapshot trong bộ nhớ:
        Tác tử 1 · Số liệu    — đơn, tấn, on-time, tuyến
        Tác tử 2 · Hư hỏng   — ca Rillnet, chặng nghi vấn, tiền đền
        Tác tử 3 · Giải pháp — Sổ tay GP-…, cohort/real-time, độ phủ
    → Aggregator (1 lần gọi AI, chỉ chép số do tác tử trả → không bịa số)
    → Câu trả lời + thẻ nguồn SourceChip + StepsPanel
```

**Quy tắc chống bịa số:** AI không tự cộng/trừ — mọi con số do tác tử module code tính từ snapshot. Tác tử trả `{số đã tính, nguồn[]}`.

### 4.2 Bộ nhớ AI Brain
- **Ngắn hạn:** 12 tin gần nhất + ngữ cảnh `{dự án, kỳ, giải pháp, tỉnh}` → câu hỏi bồi ("còn tháng 8?") biết đang nói gì. Lưu `sessionStorage`, không mất khi tải lại.
- **Dài hạn (tab `AI_Brain`):** Cột `Status` = `Đề xuất / Đã duyệt / Bỏ` + `VerifiedBy` + `VerifiedAt`. Chỉ insight "Đã duyệt" nạp như kiến thức chắc chắn. 97 insight cũ chuyển sang "Đề xuất" để Manager rà dần.
- **Duyệt câu trả lời:** Manager bấm nút dưới mỗi câu → lưu mục đã duyệt kèm nguồn + giờ dữ liệu; chỉ dạy cách trả lời / định nghĩa / quy tắc, **KHÔNG tái dùng số cũ** (số luôn tính lại từ snapshot mới).

### 4.3 Thẻ nguồn (SourceChip)
Hệ thống gắn tự động từ metadata tác tử — không do AI viết (không bịa nguồn). Gồm: Snapshot LTL (giờ dựng), Rillnet Báo cáo bể vỡ (vàng nếu > 24h chưa sync), Sổ tay GP-…, Danh sách kho GHN, Bộ nhớ đã duyệt. Khung "Các bước Tiểu Đệ đã làm" bấm mở được.

### 4.4 Phân quyền AI
- CS: bị chặn hoàn toàn ở server
- Client: chỉ dự án của mình
- Tác tử Giải pháp (Sổ tay): chỉ Manager + SD3

### 4.5 4 nhà cung cấp AI dự phòng
`lib/ai-providers.js`: Gemini → Groq → (2 fallback khác) — nếu 1 nhà lỗi tự chuyển sang nhà kế.

---

## 5. Tích hợp & đồng bộ dữ liệu

### 5.1 Google Sheets ↔ Dashboard
- **Apps Script** (tannt@ghn.vn): tự đồng bộ FTL data mỗi 2h vào tab `ftl_order_history`
- **Scraper → Sheets**: `sync_to_db.js` merge theo `order_code`, swap nguyên tử (tab staging → tab chính) → không có khoảng trống dữ liệu trong lúc ghi
- **Vercel cron**: dựng snapshot lúc 09:00/13:00/18:00 VN (hoặc sau khi scraper Railway xong)

### 5.2 Rillnet (ca bể vỡ)
- Scraper đọc trang "📦 Báo cáo bể vỡ" + `truythu.html` qua CDP
- Chờ biến `TT`/`BEVO_RAW`/`TAX` tải xong (tối đa 45s) trước khi đọc tiền đền
- Không đọc ô `noi_dung` (23% có số điện thoại — tránh lộ PII)
- `--dry` để chạy thử không ghi: `python3 rillnet_scraper.py --dry`

### 5.3 Xuất dữ liệu
| Format | Nơi dùng |
|---|---|
| Excel (.xlsx) | Báo cáo công ty (6 sheet), Sổ tay cải tiến, Báo cáo đánh giá giải pháp |
| Word (.docx) | Báo cáo giải pháp Sổ tay (thư viện `docx 9.8`) |
| In / PDF | `window.print()` CSS `@media print`, A4 |
| Copy văn bản | Gạch đầu dòng để dán slide/email |
| CSV | Tab Dashboard LTL |

---

## 6. Bảo mật

- **CDN**: chỉ `private` — Vercel Edge/CDN không bao giờ cache. Sự cố #23 (14/08) xác nhận rủi ro `s-maxage`.
- **SWR cache `max-age=60`** chỉ áp dụng default query (không bộ lọc nào). `private` = browser-only, không CDN.
- **Audit log**: mọi thao tác ghi (tạo/sửa/xoá user, chốt số, thay đổi cài đặt, AI duyệt) đều ghi Nhật ký.
- **Ảnh giải pháp**: lưu Vercel Blob `private` — phải đăng nhập mới xem (`/api/trials?image=<path>`).
- **⚠ Không bao giờ**: cào portal.ghn.vn hoặc bất kỳ portal nội bộ GHN bằng browser automation (bị team tech GHN nhắc nhở 27/08/2026).

---

## 7. Trạng thái hiện tại (04/10/2026)

| Hạng mục | Trạng thái |
|---|---|
| Dashboard LTL (Tổng quan · Bản đồ · Hư hỏng) | ✅ Production |
| Báo cáo công ty (Excel + chốt số) | ✅ Production |
| Sổ tay Cải tiến (nhiều giai đoạn + đối soát + độ phủ) | ✅ Production (F1 code 03/10) |
| Tiểu Đệ đa tác tử (Planner + 3 tác tử + Brain) | ✅ Production (F2 deploy 03/10) |
| Tiền đền cho khách (Rillnet scraper) | ✅ Production (E1 deploy 02/10) |
| Bản đồ tỉnh + Lớp kho | ✅ Production |
| Giao diện mobile (< 768px) | ✅ Production |
| Windows Task Scheduler giữ ấm | ✅ Chạy từ 04/10 |
| TELEGRAM_BOT_TOKEN alert scraper | ⏳ Chưa cấu hình trên Railway |
| KPI portal scraper | ⚠ Chạy nhưng bỏ qua lỗi — xác nhận không cần nữa |

---

## 8. Số đo thực tế (04/10/2026)

| Chỉ số | Giá trị |
|---|---|
| DB rows (sau CUT_DATE 01/07) | 131.344 |
| LTL rows trong snapshot | 32.149 |
| Snapshot BASE size | ~765 KB gzip |
| Snapshot DEFAULT size | ~159 KB gzip |
| `/dashboard` cold start | ~2.000ms |
| `/dashboard` warm | 152ms |
| `/api/data` cold | ~519ms |
| `/api/data` warm | ~270ms |
| Tổng tiền đền khách đã chốt | 596,5 triệu đồng (82 ca) |
| Giải pháp trong Sổ tay | 3 (PSD CCDC, Tách tuyến vận chuyển, PSD Miền Trung) |
| Kho giao có vị trí chắc chắn | 93/93 (98% lượt đơn) |
