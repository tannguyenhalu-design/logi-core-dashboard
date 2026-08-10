export const PIC_NAMES = {
  "tutd@ghn.vn": "Duy Tú",
  "diennk@giaohangnhanh.vn": "Kim Diện",
  "datnt2@ghn.vn": "Nguyễn Thành Đạt"
};

export function formatRevenue(val) {
  if (!val) return "—";
  const numStr = String(val).replace(/[^\d]/g, "");
  if (!numStr) return val;
  const num = parseInt(numStr);
  if (num >= 1000000000) {
    return (num / 1000000000).toFixed(1).replace(".0", "") + " Tỷđ";
  }
  if (num >= 1000000) {
    return (num / 1000000).toFixed(0) + " Trđ";
  }
  return num.toLocaleString("vi-VN") + "đ";
}

export const blankTaskRow = () => ({ title: "", pics: ["tutd@ghn.vn"], project: "Vận hành chung SD3", deadline: "", notes: "" });

export function getTaskOutcome(t) {
  const deadlineEnd = t.deadline ? new Date(`${t.deadline}T23:59:59`) : null;
  const isCompleted = t.status !== "in_progress";
  if (!isCompleted) {
    if (deadlineEnd && !isNaN(deadlineEnd.getTime()) && new Date() > deadlineEnd) return "overdue_open";
    return "in_progress";
  }
  const completedAt = t.updatedAt ? new Date(t.updatedAt) : null;
  if (!deadlineEnd || !completedAt || isNaN(deadlineEnd.getTime()) || isNaN(completedAt.getTime())) return "done_ontime";
  return completedAt <= deadlineEnd ? "done_ontime" : "done_late";
}

export function groupTaskStatus(members) {
  const outcomes = members.map(getTaskOutcome);
  if (outcomes.includes("overdue_open")) return "overdue_open";
  if (outcomes.includes("done_late")) return "done_late";
  if (outcomes.every((o) => o === "done_ontime")) return "done_ontime";
  return "in_progress";
}
