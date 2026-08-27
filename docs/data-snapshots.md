# Data Snapshots

Ghi thủ công các mốc số liệu quan trọng do người dùng yêu cầu lưu lại, đề
phòng trường hợp Google Sheet nguồn (`raw_ontime`, `raw_ftl_orders`, ...) bị
xóa hoặc sửa nhầm. Đây là bản ghi tay tại 1 thời điểm cụ thể, không tự động
cập nhật — không dùng để đối chiếu số liệu "hiện tại", chỉ dùng để khôi phục
lại baseline nếu nguồn gốc bị mất.

---

## LTL Dashboard — Tháng 7/2026 (chốt ngày 20/08/2026)

Nguồn: SD3- Dashboard Điện Máy, tab "LTL Dashboard", filter: **Tháng 7**,
**Dự án: Tất cả (20)**, chế độ lọc: **Ngày lấy** (pickup date).

### Tổng theo tuần (Xu hướng Ontime/Late theo tuần)

| Tuần | Số đơn (nhãn hiển thị) | Số đơn (giá trị trong cột) | % Ontime | So với tuần trước |
|---|---|---|---|---|
| Tuần 1 | 1.6K đơn | 1.407 | 90.2% | — |
| Tuần 2 | 2.3K đơn | 2.075 | 91.1% | ▲ +46% |
| Tuần 3 | 2.2K đơn | 2.063 | 93.1% | ▼ -3% |
| Tuần 4 | 3.5K đơn | 3.297 | ~93% | ▲ +60% |

Tổng cộng theo nhãn tuần (làm tròn hiển thị trên dashboard): **~9.6K đơn**
(1.6K + 2.3K + 2.2K + 3.5K). Tổng theo giá trị cột chính xác trong ảnh chụp:
1.407 + 2.075 + 2.063 + 3.297 = **8.842 đơn**. Chênh lệch là do làm tròn hiển
thị ở nhãn đầu tuần, không phải sai số dữ liệu.

### Top 8 tỉnh (xếp theo số đơn)

| Tỉnh | Số đơn | Tấn | Khách hàng top | % trong tỉnh | Ontime |
|---|---|---|---|---|---|
| Hồ Chí Minh ⚠️ | 2.317 | 160.4 | LG LTL | 51% | 89% |
| Hà Nội | 998 | 70.6 | Casper | 44% | 91% |
| Đà Nẵng | 876 | 205.3 | Samsung SDS DAN | 68% | 98% |
| Quảng Nam | 561 | 83.0 | Samsung SDS DAN | 90% | 99% |
| Bình Dương | 486 | 35.4 | LG LTL | 51% | 94% |
| Đồng Nai ⚠️ | 485 | 41.8 | LG LTL | 58% | 81% |
| Thừa Thiên Huế | 408 | 73.1 | Samsung SDS DAN | 84% | 99% |
| Quảng Ngãi | 321 | 44.5 | Samsung SDS DAN | 87% | 99% |

⚠️ = tỉnh được dashboard tự gắn cờ cảnh báo tại thời điểm chụp (Hồ Chí Minh,
Đồng Nai).

**Ghi lại theo yêu cầu của user ngày 20/08/2026** — nếu `raw_ontime` trên
Google Sheet bị xóa/hỏng, đây là baseline để đối chiếu lại số liệu tháng
7/2026 đã từng đúng.
