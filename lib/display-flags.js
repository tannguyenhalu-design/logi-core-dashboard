/**
 * lib/display-flags.js — công tắc hiển thị (không đổi dữ liệu, chỉ ẩn/hiện).
 *
 * SHOW_TRUY_THU = false (user 03/10): chưa muốn xem số tiền TRUY THU nhân viên
 * (nội bộ). Số tiền thiệt hại hiển thị = TIỀN ĐỀN CHO KHÁCH do CS nhập theo mã
 * đơn (số dự kiến, cập nhật sau QC). Dữ liệu truy thu vẫn đồng bộ vào
 * raw_damage_causes như cũ; bật lại = đổi thành true.
 * Áp luôn cho báo cáo công ty (user 03/10 "Ẩn luôn ở báo cáo công ty"): tab
 * Báo cáo công ty, dòng nhận xét từng khách, Excel gửi công ty.
 */
export const SHOW_TRUY_THU = false;

// Báo cáo đã chốt (locked) lưu sẵn câu nhận xét cũ có đoạn "; truy thu: ...":
// khi đang ẩn thì cắt đoạn đó lúc hiển thị / xuất Excel (không sửa bản đã chốt).
export const scrubTruyThu = (line) =>
  SHOW_TRUY_THU ? line : String(line).replace(/;\s*truy thu:[^.]*(?:\.\d+[^.]*)*\.?$/i, ".");
