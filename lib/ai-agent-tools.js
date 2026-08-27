import { createTasks } from "./tasks";
import { parseDate } from "./transform-ltl";
import { findPic } from "./pic-directory";

/**
 * Utility: Remove accents for Vietnamese fuzzy matching
 */
export function removeAccents(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * Tool 1: Dynamic LTL Order Query & Filter Engine
 */
export function queryOrders(filteredLTL, params = {}) {
  const { client, province, warehouse, date, status } = params;
  const clientClean = client ? removeAccents(client) : "";
  const provinceClean = province ? removeAccents(province) : "";
  const warehouseClean = warehouse ? removeAccents(warehouse) : "";
  const statusClean = status ? removeAccents(status) : "";

  const matched = filteredLTL.filter((r) => {
    if (clientClean) {
      const c = removeAccents(r["client_name"]);
      if (!c.includes(clientClean)) return false;
    }
    if (provinceClean) {
      const giao = removeAccents(r["kho_giao"] || r["warehouse_giao"]);
      const lay = removeAccents(r["kho_lay"] || r["warehouse_lay"]);
      if (!giao.includes(provinceClean) && !lay.includes(provinceClean)) return false;
    }
    if (warehouseClean) {
      const giao = removeAccents(r["kho_giao"] || r["warehouse_giao"]);
      const lay = removeAccents(r["kho_lay"] || r["warehouse_lay"]);
      if (!giao.includes(warehouseClean) && !lay.includes(warehouseClean)) return false;
    }
    if (date) {
      const d = parseDate(r["pickup_time"]);
      if (!d) return false;
      const dateKey = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (dateKey !== date && !r["pickup_time"].includes(date)) return false;
    }
    if (statusClean) {
      const st = removeAccents(r["status"]);
      if (!st.includes(statusClean)) return false;
    }
    return true;
  });

  const totalCount = matched.length;
  let totalWeightKg = 0;
  let deliveredCount = 0;
  let ontimeCount = 0;

  matched.forEach((r) => {
    const w = parseFloat(r["weight"]) || 0;
    totalWeightKg += w;
    const st = String(r["status"] || "").toLowerCase();
    if (st === "delivered") {
      deliveredCount++;
      const odr = String(r["odr_success"] || "").toLowerCase();
      if (odr === "ontime") ontimeCount++;
    }
  });

  return {
    totalOrders: totalCount,
    totalWeightTon: (totalWeightKg / 1000).toFixed(1),
    deliveredCount,
    ontimeCount,
    ontimePct: deliveredCount > 0 ? ((ontimeCount / deliveredCount) * 100).toFixed(1) + "%" : "N/A",
  };
}

/**
 * Tool 2: Project Revenue & SLA Performance Engine
 */
export function getProjectPerformance(projectsList, params = {}) {
  const { projectName, picName } = params;
  const projClean = projectName ? removeAccents(projectName) : "";
  const picClean = picName ? removeAccents(picName) : "";

  return projectsList.filter((p) => {
    if (projClean) {
      const nameClean = removeAccents(p.name);
      if (!nameClean.includes(projClean) && !projClean.split(" ").some(w => w.length >= 3 && nameClean.includes(w))) return false;
    }
    if (picClean) {
      const picNameClean = removeAccents(p.pic);
      if (!picNameClean.includes(picClean)) return false;
    }
    return true;
  });
}

/**
 * Tool 3: Damage & Operational Risk Claims Engine
 */
export function getDamageAndRiskReport(rawDamage, params = {}) {
  const { client, route } = params;
  const clientClean = client ? removeAccents(client) : "";
  const routeClean = route ? removeAccents(route) : "";

  const cases = (rawDamage || []).filter((r) => {
    if (clientClean) {
      const c = removeAccents(r["client_name"] || r["TÊN DỰ ÁN"] || r["Khách hàng"]);
      if (!c.includes(clientClean)) return false;
    }
    if (routeClean) {
      const rt = removeAccents(r["tuyen"] || r["tuyến"] || r["route"]);
      if (!rt.includes(routeClean)) return false;
    }
    return true;
  });

  return {
    totalDamageCases: cases.length,
    cases: cases.slice(0, 5),
  };
}

/**
 * Tool 4: Operational Task Creator Tool
 */
export async function createTaskForStaff({ title, picName, project, deadline, notes }, actor) {
  if (!title || !picName) throw new Error("Thiếu tiêu đề hoặc người phụ trách task");

  // Resolve against the real staff directory instead of guessing an email
  // from the name — a guessed "firstname@ghn.vn" almost never matches the
  // actual account (e.g. "Đạt" -> real "datnt2@ghn.vn", guessed "dat@ghn.vn"),
  // so the task silently never reaches the intended person's task list.
  const staff = findPic(picName);
  if (!staff) {
    throw new Error(
      `Không tìm thấy nhân sự "${picName}" trong danh sách PIC. Vui lòng chỉ rõ tên (Duy Tú, Kim Diện, Nguyễn Thành Đạt, Thúy Vi) hoặc dùng email.`
    );
  }

  // Deadline must be a plain "YYYY-MM-DD" (matching the manual task form's
  // <input type="date">) — createTaskEvent() sends it straight through as
  // Google Calendar's all-day-event `date` field, which rejects a full ISO
  // datetime string. Passing one through here silently failed calendar
  // event creation (caught, returns null) on every AI-created task while
  // the sheet row itself still looked fine, so it went unnoticed.
  const defaultDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const taskGroup = [
    {
      title,
      pic: staff.email,
      picName: staff.name,
      project: project || "Điện Máy",
      deadline: (deadline || defaultDeadline).slice(0, 10),
      notes: notes || "Tạo tự động qua AI Agent",
    },
  ];
  return await createTasks(taskGroup, actor);
}

/**
 * Tool 5: Run-rate Revenue & KPI Predictor Engine
 */
export function predictRevenueTarget(projectsList, params = {}) {
  const { clientOrProject } = params;
  const targetClean = clientOrProject ? removeAccents(clientOrProject) : "";
  const matched = projectsList.filter((p) => removeAccents(p.name).includes(targetClean));

  const now = new Date();
  const dayOfMonth = now.getDate() || 12;
  const totalDaysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() || 31;
  const monthProgressPct = ((dayOfMonth / totalDaysInMonth) * 100).toFixed(1);

  const results = matched.map((p) => {
    const target = parseFloat(String(p.doanhThuDuKien).replace(/[^\d]/g, "")) || 0;
    const actual = parseFloat(String(p.doanhThuThucTeThangNay).replace(/[^\d]/g, "")) || 0;
    const projectedEndMonth = Math.round((actual / dayOfMonth) * totalDaysInMonth);
    const kpiCompletionPct = target > 0 ? ((projectedEndMonth / target) * 100).toFixed(1) : "N/A";

    return {
      projectName: p.name,
      doanhThuDuKien: p.doanhThuDuKien,
      doanhThuThucTeHienTai: p.doanhThuThucTeThangNay,
      duBaoCuoiThang: projectedEndMonth.toLocaleString("vi-VN") + "đ",
      kpiCompletionPct: kpiCompletionPct !== "N/A" ? parseFloat(kpiCompletionPct) : 0,
      kpiDisplay: kpiCompletionPct + "%",
      monthProgressPct: monthProgressPct + "%",
      rawProjected: projectedEndMonth
    };
  });
  
  // Sort by projected end month revenue (descending)
  results.sort((a, b) => b.rawProjected - a.rawProjected);
  
  return results;
}
