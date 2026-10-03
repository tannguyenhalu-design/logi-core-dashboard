/**
 * lib/display-flags.js — công tắc hiển thị (không đổi dữ liệu, chỉ ẩn/hiện).
 *
 * SHOW_TRUY_THU = false (user 03/10): chưa muốn xem số tiền TRUY THU nhân viên
 * (nội bộ). Số tiền thiệt hại hiển thị = TIỀN ĐỀN CHO KHÁCH do CS nhập theo mã
 * đơn (số dự kiến, cập nhật sau QC). Dữ liệu truy thu vẫn đồng bộ vào
 * raw_damage_causes như cũ; bật lại = đổi thành true.
 * Không áp cho báo cáo công ty (tab Báo cáo công ty / Excel gửi công ty).
 */
export const SHOW_TRUY_THU = false;
