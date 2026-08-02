import { useState, useEffect } from "react";
import TruckLoader from "./TruckLoader";
import { downloadCSV } from "../lib/csv-export";

const PIC_NAMES = {
  "tutd@ghn.vn": "Duy Tú",
  "diennk@giaohangnhanh.vn": "Kim Diện",
  "datnt2@ghn.vn": "Nguyễn Tiến Đạt"
};

function formatRevenue(val) {
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

export default function TabOperations({ rawData, userRole }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [picFilter, setPicFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // Active sub-tab state ('projects' | 'tasks')
  const [activeSubTab, setActiveSubTab] = useState("projects");

  // Task & Deadline Tracker state
  const [tasks, setTasks] = useState([]);
  const [taskPicFilter, setTaskPicFilter] = useState("all");
  const [taskStatusFilter, setTaskStatusFilter] = useState("all");
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);

  // New task form state
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPic, setNewTaskPic] = useState("tutd@ghn.vn");
  const [newTaskProject, setNewTaskProject] = useState("Vận hành chung SD3");
  const [newTaskDeadline, setNewTaskDeadline] = useState("");
  const [newTaskNotes, setNewTaskNotes] = useState("");

  // Load tasks from localStorage or set initial tasks
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sd3_tasks_v1");
      if (saved) {
        setTasks(JSON.parse(saved));
      } else {
        const INITIAL_TASKS = [
          {
            id: "task-1",
            title: "Báo cáo ODR & SLA tuần 31 gửi Giám đốc Vận hành",
            pic: "diennk@giaohangnhanh.vn",
            picName: "Kim Diện",
            project: "Vận hành chung SD3",
            deadline: "2026-08-04",
            status: "ontime",
            notes: "Đã tổng hợp 100% dữ liệu từ các kho",
          },
          {
            id: "task-2",
            title: "Đối soát cước phí vận tải & doanh thu dự án Casper T7",
            pic: "tutd@ghn.vn",
            picName: "Duy Tú",
            project: "Casper",
            deadline: "2026-08-05",
            status: "in_progress",
            notes: "Đang kiểm tra 442 đơn giao",
          },
          {
            id: "task-3",
            title: "Rà soát & giải quyết đền bù 5 ca hư hỏng kho Bình Dương",
            pic: "datnt2@ghn.vn",
            picName: "Nguyễn Tiến Đạt",
            project: "Aqua B2C",
            deadline: "2026-08-03",
            status: "ontime",
            notes: "Đã chốt phương án đền bù với bảo hiểm",
          },
          {
            id: "task-4",
            title: "Nghiệm thu & cập nhật SOP vận hành dự án Aqua B2C",
            pic: "tutd@ghn.vn",
            picName: "Duy Tú",
            project: "Aqua B2C",
            deadline: "2026-08-01",
            status: "overdue",
            notes: "Cần bổ sung quy trình giao kho bãi",
          },
        ];
        setTasks(INITIAL_TASKS);
        localStorage.setItem("sd3_tasks_v1", JSON.stringify(INITIAL_TASKS));
      }
    } catch (e) {
      console.error("Failed to load tasks:", e);
    }
  }, []);

  const saveTasks = (newTasks) => {
    setTasks(newTasks);
    try {
      localStorage.setItem("sd3_tasks_v1", JSON.stringify(newTasks));
    } catch (e) {
      console.error("Failed to save tasks:", e);
    }
  };

  const handleAddTask = (e) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !newTaskDeadline) return;

    const newTask = {
      id: "task-" + Date.now(),
      title: newTaskTitle.trim(),
      pic: newTaskPic,
      picName: PIC_NAMES[newTaskPic] || newTaskPic,
      project: newTaskProject,
      deadline: newTaskDeadline,
      status: "in_progress",
      notes: newTaskNotes.trim(),
    };

    const updated = [newTask, ...tasks];
    saveTasks(updated);
    setShowAddTaskModal(false);
    setNewTaskTitle("");
    setNewTaskDeadline("");
    setNewTaskNotes("");
  };

  const handleToggleTaskStatus = (id, newStatus) => {
    const updated = tasks.map((t) => (t.id === id ? { ...t, status: newStatus } : t));
    saveTasks(updated);
  };

  const handleDeleteTask = (id) => {
    const updated = tasks.filter((t) => t.id !== id);
    saveTasks(updated);
  };

  // User session state returned from API
  const [currentUser, setCurrentUser] = useState({ role: "manager", pic: null });

  // Modal control states
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null); // hold project object currently being edited
  const [saving, setSaving] = useState(false);

  // Add project form states
  const [addName, setAddName] = useState("");
  const [addPic, setAddPic] = useState("");
  const [addRevenue, setAddRevenue] = useState("");
  const [addExpectedOb, setAddExpectedOb] = useState("");
  const [addModel, setAddModel] = useState("");
  const [addJob, setAddJob] = useState("");
  const [addSopLink, setAddSopLink] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addVolume, setAddVolume] = useState("");

  // Edit project buffer states
  const [editPic, setEditPic] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editJob, setEditJob] = useState("");
  const [editExpectedOb, setEditExpectedOb] = useState("");
  const [editRevenue, setEditRevenue] = useState("");
  const [editSopLink, setEditSopLink] = useState("");
  const [editModel, setEditModel] = useState("");
  const [editRecapStatus, setEditRecapStatus] = useState("");
  const [editRecapLink, setEditRecapLink] = useState("");
  const [editSopStatus, setEditSopStatus] = useState("");
  const [editKickoffStatus, setEditKickoffStatus] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editVolume, setEditVolume] = useState("");

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      const json = await res.json();
      if (json.ok) {
        setProjects(json.projects || []);
        if (json.user) {
          setCurrentUser(json.user);
        }
      }
    } catch (err) {
      console.error("Failed to load projects:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  // Sync default filter for PICs
  useEffect(() => {
    if (currentUser.role === "pic" && currentUser.pic) {
      setPicFilter(currentUser.pic);
    }
  }, [currentUser]);

  // Set edit buffer when starting to edit a project
  const startEditing = (p) => {
    setEditingProject(p);
    setEditPic(p.pic || "");
    setEditStatus(p.status || "Đang thực hiện");
    setEditJob(p.job || "");
    setEditExpectedOb(p.expectedOb || "");
    setEditRevenue(p.revenue || "");
    setEditSopLink(p.sopLink || "");
    setEditModel(p.model || "");
    setEditRecapStatus(p.recapStatus || "Chưa thực hiện");
    setEditRecapLink(p.recapLink || "");
    setEditSopStatus(p.sopStatus || "Chưa thực hiện");
    setEditKickoffStatus(p.kickoffStatus || "Chưa thực hiện");
    setEditNotes(p.notes || "");
    setEditVolume(p.volume || "");
  };

  // Submit project creation (Manager only)
  const handleAddProject = async (e) => {
    e.preventDefault();
    if (!addName.trim()) return;

    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: addName.trim(),
          pic: addPic,
          revenue: addRevenue.trim(),
          expectedOb: addExpectedOb.trim(),
          model: addModel.trim(),
          job: addJob.trim() || "Recap onsite",
          sopLink: addSopLink.trim(),
          notes: addNotes.trim(),
          volume: addVolume.trim(),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        // Reset form
        setAddName("");
        setAddPic("");
        setAddRevenue("");
        setAddExpectedOb("");
        setAddModel("");
        setAddJob("");
        setAddSopLink("");
        setAddNotes("");
        setAddVolume("");
        setShowAddModal(false);
        await fetchProjects();
      }
    } catch (err) {
      alert("Lỗi tạo dự án: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Submit project update (PIC or Manager)
  const handleUpdateProject = async (e) => {
    e.preventDefault();
    if (!editingProject) return;

    setSaving(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          name:          editingProject.name,
          pic:           editPic,
          status:        editStatus,
          job:           editJob,
          expectedOb:    editExpectedOb,
          revenue:       editRevenue,
          sopLink:       editSopLink,
          model:         editModel,
          recapStatus:   editRecapStatus,
          recapLink:     editRecapLink,
          sopStatus:     editSopStatus,
          kickoffStatus: editKickoffStatus,
          notes:         editNotes,
          volume:        editVolume,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setEditingProject(null);
        await fetchProjects();
      }
    } catch (err) {
      alert("Lỗi lưu dự án: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Filters calculation
  const uniquePics = [...new Set(projects.map(p => p.pic).filter(Boolean))].sort();
  const uniqueModels = [...new Set(projects.map(p => p.model).filter(Boolean))].sort();
  const uniqueStatuses = [...new Set(projects.map(p => p.status).filter(Boolean))].sort();

  const filteredProjects = projects.filter(p => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const name = String(p.name || "").toLowerCase();
      const checklist = String(p.checklist || "").toLowerCase();
      const notes = String(p.notes || "").toLowerCase();
      const sla = String(p.slaLogic || "").toLowerCase();
      if (!name.includes(q) && !checklist.includes(q) && !notes.includes(q) && !sla.includes(q)) return false;
    }
    if (picFilter !== "all" && p.pic !== picFilter) return false;
    if (modelFilter !== "all" && p.model !== modelFilter) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  // Stats
  const totalCount = filteredProjects.length;
  const inProgressCount = filteredProjects.filter(p => p.status === "Đang thực hiện").length;
  const doneCount = filteredProjects.filter(p => p.status === "Done").length;
  const parseRevenue = (val) => {
    const numStr = String(val || "").replace(/[^\d]/g, "");
    return numStr ? parseInt(numStr) : 0;
  };

  const totalRevenue = filteredProjects.reduce((sum, p) => sum + parseRevenue(p.revenue), 0);
  const canSeeRevenue = userRole === "manager" || userRole === "ops_specialist";

  const revenueByPic = {};
  const revenueByStatus = {};
  filteredProjects.forEach((p) => {
    const rev = parseRevenue(p.revenue);
    const picKey = PIC_NAMES[p.pic] || p.pic || "Chưa gán";
    if (!revenueByPic[picKey]) revenueByPic[picKey] = { revenue: 0, count: 0 };
    revenueByPic[picKey].revenue += rev;
    revenueByPic[picKey].count += 1;

    const statusKey = p.status || "Chưa cập nhật";
    if (!revenueByStatus[statusKey]) revenueByStatus[statusKey] = { revenue: 0, count: 0 };
    revenueByStatus[statusKey].revenue += rev;
    revenueByStatus[statusKey].count += 1;
  });

  const exportProjectsCSV = () => {
    downloadCSV(
      `VanHanhSD3_bao_cao_${new Date().toISOString().slice(0, 10)}.csv`,
      [
        { label: "Tên dự án", value: "name" },
        { label: "PIC", value: (p) => PIC_NAMES[p.pic] || p.pic || "" },
        { label: "Mô hình vận hành", value: "model" },
        { label: "Trạng thái", value: "status" },
        { label: "Công việc", value: "job" },
        { label: "Dự kiến OB", value: "expectedOb" },
        { label: "Doanh thu dự kiến", value: "revenue" },
        { label: "Last Mo. NSR", value: "lastMoNsr" },
        { label: "Dự kiến Volume", value: "volume" },
        { label: "RECAP status", value: "recapStatus" },
        { label: "SOP status", value: "sopStatus" },
        { label: "KICKOFF status", value: "kickoffStatus" },
      ],
      filteredProjects
    );
  };

  const isManager = currentUser.role === "manager";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, position: "relative" }}>
      {/* Sub-tab Navigation Bar */}
      <div style={{ display: "flex", gap: 12, borderBottom: "1px solid var(--border)", paddingBottom: 10 }}>
        <button
          onClick={() => setActiveSubTab("projects")}
          style={{
            padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer",
            background: activeSubTab === "projects" ? "var(--cyan)" : "var(--panel-bg-strong)",
            color: activeSubTab === "projects" ? "#0f172a" : "var(--text-secondary)",
            transition: "all 0.2s", display: "flex", alignItems: "center", gap: 6,
          }}
        >
          📌 Quản Lý Tiến Độ Dự Án SD3 ({projects.length})
        </button>
        <button
          onClick={() => setActiveSubTab("tasks")}
          style={{
            padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer",
            background: activeSubTab === "tasks" ? "var(--cyan)" : "var(--panel-bg-strong)",
            color: activeSubTab === "tasks" ? "#0f172a" : "var(--text-secondary)",
            transition: "all 0.2s", display: "flex", alignItems: "center", gap: 6,
          }}
        >
          📋 Quản Lý Task & Deadline Vận Hành SD3 ({tasks.length})
        </button>
      </div>

      {activeSubTab === "tasks" ? (
        /* ── SECTION: SD3 TASK & DEADLINE TRACKER ── */
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Header & Controls Bar */}
          <div style={{ background: "var(--panel-bg-strong)", border: "1px solid var(--border)", padding: 16, borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 8 }}>
                📋 Theo Dõi Task & Deadline Vận Hành SD3
              </h3>
              <p style={{ margin: "4px 0 0 0", fontSize: 12.5, color: "var(--text-muted)" }}>
                Quản lý tiến độ hoàn thành đúng hạn các công việc vận hành, báo cáo & đền bù của các PIC.
              </p>
            </div>
            <button
              onClick={() => setShowAddTaskModal(true)}
              style={{ background: "var(--green)", color: "var(--text-primary)", border: "none", padding: "8px 16px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
            >
              + Tạo Task Mới
            </button>
          </div>

          {/* Task KPI Summary Cards */}
          {(() => {
            const filteredTasks = tasks.filter((t) => {
              if (taskPicFilter !== "all" && t.pic !== taskPicFilter) return false;
              if (taskStatusFilter !== "all" && t.status !== taskStatusFilter) return false;
              return true;
            });
            const totalT = filteredTasks.length;
            const ontimeT = filteredTasks.filter((t) => t.status === "ontime").length;
            const inProgT = filteredTasks.filter((t) => t.status === "in_progress").length;
            const overdueT = filteredTasks.filter((t) => t.status === "overdue").length;
            const ontimePct = totalT > 0 ? Math.round((ontimeT / totalT) * 100) : 100;

            return (
              <>
                <div className="grid-4">
                  <div style={{ background: "var(--panel-bg-strong)", border: "1px solid var(--border)", padding: 14, borderRadius: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Tỷ Lệ Hoàn Thành Đúng Hạn</div>
                    <div style={{ fontSize: 24, fontWeight: "bold", margin: "4px 0", color: ontimePct >= 90 ? "var(--green)" : ontimePct >= 80 ? "var(--amber)" : "var(--red)" }}>
                      {ontimePct}%
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>KPI đúng hạn của team SD3</div>
                  </div>
                  <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.2)", padding: 14, borderRadius: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Hoàn Thành Đúng Hạn 🟢</div>
                    <div style={{ fontSize: 24, fontWeight: "bold", margin: "4px 0", color: "var(--green)" }}>{ontimeT} task</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Task làm xong đúng deadline</div>
                  </div>
                  <div style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.2)", padding: 14, borderRadius: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Đang Thực Hiện 🟡</div>
                    <div style={{ fontSize: 24, fontWeight: "bold", margin: "4px 0", color: "var(--amber)" }}>{inProgT} task</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Trong thời hạn làm việc</div>
                  </div>
                  <div style={{ background: "rgba(244,63,94,0.05)", border: "1px solid rgba(244,63,94,0.2)", padding: 14, borderRadius: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Trễ Hạn Deadline 🔴</div>
                    <div style={{ fontSize: 24, fontWeight: "bold", margin: "4px 0", color: "var(--red)" }}>{overdueT} task</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Task quá hạn cần xử lý gấp</div>
                  </div>
                </div>

                {/* Filter Controls Bar */}
                <div style={{ background: "var(--panel-bg-strong)", border: "1px solid var(--border)", padding: "10px 14px", borderRadius: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Lọc theo PIC:</label>
                    <select
                      value={taskPicFilter}
                      onChange={(e) => setTaskPicFilter(e.target.value)}
                      style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "4px 8px", borderRadius: 6, fontSize: 12 }}
                    >
                      <option value="all">Tất cả PIC</option>
                      <option value="tutd@ghn.vn">Duy Tú</option>
                      <option value="diennk@giaohangnhanh.vn">Kim Diện</option>
                      <option value="datnt2@ghn.vn">Nguyễn Tiến Đạt</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Trạng thái:</label>
                    <select
                      value={taskStatusFilter}
                      onChange={(e) => setTaskStatusFilter(e.target.value)}
                      style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "4px 8px", borderRadius: 6, fontSize: 12 }}
                    >
                      <option value="all">Tất cả trạng thái</option>
                      <option value="in_progress">🟡 Đang thực hiện</option>
                      <option value="ontime">🟢 Đã xong đúng hạn</option>
                      <option value="overdue">🔴 Trễ hạn (Overdue)</option>
                    </select>
                  </div>
                </div>

                {/* Task Table */}
                <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, textAlign: "left" }}>
                    <thead>
                      <tr style={{ background: "var(--table-header-bg)", color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>
                        <th style={{ padding: "10px 14px" }}>Tên Task / Công Việc</th>
                        <th style={{ padding: "10px 14px" }}>Người Đảm Nhiệm (PIC)</th>
                        <th style={{ padding: "10px 14px" }}>Dự Án</th>
                        <th style={{ padding: "10px 14px" }}>Hạn Chót (Deadline)</th>
                        <th style={{ padding: "10px 14px" }}>Trạng Thái & Đánh Giá</th>
                        <th style={{ padding: "10px 14px", textAlign: "right" }}>Thao Tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.length > 0 ? (
                        filteredTasks.map((t) => {
                          const isOverdue = t.status === "overdue";
                          const isOntime = t.status === "ontime";
                          return (
                            <tr key={t.id} style={{ borderBottom: "1px solid var(--border)", background: isOverdue ? "rgba(244, 63, 94, 0.05)" : "transparent" }}>
                              <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text-primary)" }}>
                                {t.title}
                                {t.notes && <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400, marginTop: 2 }}>{t.notes}</div>}
                              </td>
                              <td style={{ padding: "10px 14px", color: "var(--cyan)", fontWeight: 600 }}>
                                👤 {t.picName}
                              </td>
                              <td style={{ padding: "10px 14px", color: "var(--text-secondary)" }}>
                                {t.project}
                              </td>
                              <td style={{ padding: "10px 14px", fontWeight: 700, color: isOverdue ? "var(--red)" : "var(--text-primary)" }}>
                                📅 {t.deadline}
                              </td>
                              <td style={{ padding: "10px 14px" }}>
                                {isOntime && (
                                  <span style={{ fontSize: 11, background: "rgba(16,185,129,0.15)", color: "var(--green)", border: "1px solid var(--green)", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                                    🟢 Đúng hạn (Ontime)
                                  </span>
                                )}
                                {t.status === "in_progress" && (
                                  <span style={{ fontSize: 11, background: "rgba(245,158,11,0.15)", color: "var(--amber)", border: "1px solid var(--amber)", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                                    🟡 Đang làm
                                  </span>
                                )}
                                {isOverdue && (
                                  <span style={{ fontSize: 11, background: "rgba(244,63,94,0.15)", color: "var(--red)", border: "1px solid var(--red)", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                                    🚨 Trễ hạn (Overdue)
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: "10px 14px", textAlign: "right" }}>
                                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                                  <a
                                    href={(() => {
                                      const title = encodeURIComponent(`[SD3 Task] ${t.title}`);
                                      const dateStr = (t.deadline || "").replace(/-/g, "");
                                      const dates = dateStr ? `${dateStr}T090000/${dateStr}T180000` : "";
                                      const details = encodeURIComponent(`Nhiệm vụ vận hành SD3 GHN:\n- Tên công việc: ${t.title}\n- Dự án: ${t.project}\n- PIC đảm nhiệm: ${t.picName} (${t.pic})\n- Ghi chú: ${t.notes || "N/A"}`);
                                      const add = encodeURIComponent(t.pic || "");
                                      return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dates}&details=${details}&add=${add}`;
                                    })()}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Thêm lịch Google Calendar & tự động nhắc PIC"
                                    style={{
                                      background: "rgba(2, 132, 199, 0.12)",
                                      border: "1px solid var(--cyan)",
                                      color: "var(--cyan)",
                                      padding: "3px 8px",
                                      borderRadius: 4,
                                      fontSize: 11,
                                      textDecoration: "none",
                                      fontWeight: 600,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                    }}
                                  >
                                    📅 Lịch Google
                                  </a>
                                  <button
                                    onClick={() => handleToggleTaskStatus(t.id, t.status === "ontime" ? "in_progress" : "ontime")}
                                    style={{ background: "rgba(16,185,129,0.15)", border: "1px solid var(--green)", color: "var(--green)", padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
                                  >
                                    {t.status === "ontime" ? "Mở lại" : "✓ Xong đúng hạn"}
                                  </button>
                                  <button
                                    onClick={() => handleToggleTaskStatus(t.id, "overdue")}
                                    style={{ background: "rgba(244,63,94,0.15)", border: "1px solid var(--red)", color: "var(--red)", padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
                                  >
                                    ⚠️ Báo Trễ
                                  </button>
                                  <button
                                    onClick={() => handleDeleteTask(t.id)}
                                    style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-muted)", padding: "3px 6px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}
                                  >
                                    🗑️
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                            Chưa có task nào trong danh sách lọc.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Modal Add New Task */}
                {showAddTaskModal && (
                  <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
                    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, width: 440, maxWidth: "90vw", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                      <h3 style={{ margin: "0 0 16px 0", color: "var(--text-primary)", fontSize: 16 }}>+ Tạo Task & Gán Deadline Cho PIC</h3>
                      <form onSubmit={handleAddTask} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        <div>
                          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Tên Công Việc / Task:</label>
                          <input
                            type="text"
                            required
                            value={newTaskTitle}
                            onChange={(e) => setNewTaskTitle(e.target.value)}
                            placeholder="Ví dụ: Báo cáo ODR tuần 31 cho Director..."
                            style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 13, marginTop: 4 }}
                          />
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                          <div>
                            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Người Đảm Nhiệm (PIC):</label>
                            <select
                              value={newTaskPic}
                              onChange={(e) => setNewTaskPic(e.target.value)}
                              style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 12, marginTop: 4 }}
                            >
                              <option value="tutd@ghn.vn">Duy Tú</option>
                              <option value="diennk@giaohangnhanh.vn">Kim Diện</option>
                              <option value="datnt2@ghn.vn">Nguyễn Tiến Đạt</option>
                            </select>
                          </div>

                          <div>
                            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Hạn Chót (Deadline):</label>
                            <input
                              type="date"
                              required
                              value={newTaskDeadline}
                              onChange={(e) => setNewTaskDeadline(e.target.value)}
                              style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 12, marginTop: 4 }}
                            />
                          </div>
                        </div>

                        <div>
                          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Dự Án / Mảng Việc:</label>
                          <input
                            type="text"
                            value={newTaskProject}
                            onChange={(e) => setNewTaskProject(e.target.value)}
                            placeholder="Casper, Aqua B2C, Vận hành chung..."
                            style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 12, marginTop: 4 }}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600 }}>Ghi Chú / Yêu Cầu Kết Quả:</label>
                          <textarea
                            rows={2}
                            value={newTaskNotes}
                            onChange={(e) => setNewTaskNotes(e.target.value)}
                            placeholder="Nhập ghi chú chi tiết hoặc dán link kết quả..."
                            style={{ width: "100%", background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 10px", borderRadius: 6, fontSize: 12, marginTop: 4, resize: "none" }}
                          />
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
                          <button
                            type="button"
                            onClick={() => setShowAddTaskModal(false)}
                            style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 16px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}
                          >
                            Hủy Bỏ
                          </button>
                          <button
                            type="submit"
                            style={{ background: "var(--green)", color: "var(--text-primary)", border: "none", padding: "8px 20px", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                          >
                            Lưu Task Mới
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      ) : (
        /* ── SECTION: SD3 PROJECTS OVERBOARD (ORIGINAL SECTION) ── */
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: "16px 20px", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>Vận Hành SD3 — Theo Dõi Dự Án Mới</h3>
          <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            Bảng quản trị tiến độ và phân quyền onboard dự án của team Solution Điện Máy.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {isManager && (
            <button 
              onClick={() => setShowAddModal(true)}
              style={{ background: "var(--cyan)", color: "var(--text-primary)", border: "none", padding: "8px 16px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
            >
              + Tạo Dự Án Mới
            </button>
          )}
          <button
            onClick={fetchProjects}
            disabled={loading}
            style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 16px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
          >
            🔄 Tải Lại Dữ Liệu
          </button>
          <button
            onClick={exportProjectsCSV}
            style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 16px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
          >
            ⬇️ Xuất CSV
          </button>
          <div style={{ background: "rgba(20, 224, 196,0.1)", border: "1px solid rgba(20, 224, 196,0.2)", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
            👤 Vai trò: <strong style={{ color: "var(--cyan)" }}>{isManager ? "Manager (Xem toàn bộ)" : "PIC Vận Hành"}</strong>
            {currentUser.pic && <span> | Tên: <strong style={{ color: "var(--green)" }}>{PIC_NAMES[currentUser.pic] || currentUser.pic}</strong></span>}
          </div>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid-4">
        <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Tổng Dự Án</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--text-primary)" }}>{totalCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Đang theo dõi trong danh sách</div>
        </div>
        <div style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Đang Thực Hiện</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--amber)" }}>{inProgressCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Dự án đang viết SOP/Onsite</div>
        </div>
        <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Đã Hoàn Thành (Done)</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--green)" }}>{doneCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Dự án đã bàn giao và chạy ổn định</div>
        </div>
        {canSeeRevenue && (
          <div style={{ background: "rgba(20, 224, 196,0.05)", border: "1px solid rgba(20, 224, 196,0.15)", padding: 16, borderRadius: 12 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Doanh Thu Dự Kiến</div>
            <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--cyan)" }}>
              {totalRevenue > 0 ? (totalRevenue / 1000000000).toFixed(1).replace(".0", "") + " Tỷđ" : "0đ"}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tổng quy mô doanh thu ước tính</div>
          </div>
        )}
      </div>

      {/* Revenue breakdown by PIC / status — rolled up from "Doanh Thu Dự Kiến" per project */}
      {canSeeRevenue && totalRevenue > 0 && (
        <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: 16, borderRadius: 12 }}>
          <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text-primary)" }}>💰 Doanh Thu Dự Kiến — theo PIC & trạng thái</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>Theo PIC</div>
              {Object.entries(revenueByPic).sort((a, b) => b[1].revenue - a[1].revenue).map(([pic, v]) => (
                <div key={pic} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--panel-border-soft)", fontSize: 13 }}>
                  <span style={{ color: "var(--text-secondary)" }}>{pic} <span style={{ color: "var(--text-muted)", fontSize: 11 }}>({v.count} dự án)</span></span>
                  <b style={{ color: "var(--cyan)" }}>{formatRevenue(v.revenue)}</b>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 8 }}>Theo trạng thái</div>
              {Object.entries(revenueByStatus).sort((a, b) => b[1].revenue - a[1].revenue).map(([status, v]) => (
                <div key={status} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--panel-border-soft)", fontSize: 13 }}>
                  <span style={{ color: "var(--text-secondary)" }}>{status} <span style={{ color: "var(--text-muted)", fontSize: 11 }}>({v.count} dự án)</span></span>
                  <b style={{ color: "var(--green)" }}>{formatRevenue(v.revenue)}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Filter Row */}
      <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: 16, borderRadius: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        {/* Search */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Tìm kiếm dự án</label>
          <input 
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên dự án, checklist, logic SLA..."
            style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
          />
        </div>

        {/* Filter PIC */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Lọc theo PIC</label>
          <select 
            value={picFilter} 
            onChange={(e) => setPicFilter(e.target.value)}
            disabled={currentUser.role === "pic"}
            style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, cursor: currentUser.role === "pic" ? "not-allowed" : "pointer" }}
          >
            <option value="all">Tất cả PIC</option>
            {uniquePics.map(email => (
              <option key={email} value={email}>{PIC_NAMES[email] || email}</option>
            ))}
          </select>
        </div>

        {/* Filter Model */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Mô Hình Vận Hành</label>
          <select 
            value={modelFilter} 
            onChange={(e) => setModelFilter(e.target.value)}
            style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6 }}
          >
            <option value="all">Tất cả mô hình</option>
            {uniqueModels.map(model => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>

        {/* Filter Status */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Trạng Thái</label>
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6 }}
          >
            <option value="all">Tất cả trạng thái</option>
            {uniqueStatuses.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Projects Table Container */}
      <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", overflowX: "auto" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
            <TruckLoader />
          </div>
        ) : (
          <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "12px 8px" }}>Tên Dự Án</th>
                <th style={{ textAlign: "left", padding: "12px 8px" }}>Đảm Nhiệm (PIC)</th>
                <th style={{ textAlign: "left", padding: "12px 8px" }}>Mô Hình Vận Hành</th>
                <th style={{ textAlign: "left", padding: "12px 8px" }}>Công Việc</th>
                <th style={{ textAlign: "left", padding: "12px 8px" }}>Dự Kiến OB</th>
                {canSeeRevenue && <th style={{ textAlign: "right", padding: "12px 8px" }}>Doanh Thu Dự Kiến</th>}
                {canSeeRevenue && <th style={{ textAlign: "right", padding: "12px 8px" }}>Last Mo. NSR</th>}
                <th style={{ textAlign: "right", padding: "12px 8px" }}>Dự Kiến Volume</th>
                <th style={{ textAlign: "center", padding: "12px 8px" }}>Trạng Thái</th>
                <th style={{ textAlign: "center", padding: "12px 8px" }}>Tác vụ</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p) => {
                const picName = PIC_NAMES[p.pic] || p.pic || "Chưa phân công";
                
                let statusColor = "rgba(100,116,139,0.15)";
                if (p.status === "Đang thực hiện") statusColor = "rgba(245,158,11,0.2)";
                if (p.status === "Done") statusColor = "rgba(16,185,129,0.2)";

                const isAssignedPic = p.pic && p.pic === currentUser.pic;
                const canEdit = isManager || isAssignedPic;

                return (
                  <tr 
                    key={p.name}
                    style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                    className="hover-row"
                  >
                    <td style={{ padding: "14px 8px", fontWeight: 600, color: "var(--text-primary)" }}>
                      📂 {p.name}
                    </td>
                    <td style={{ padding: "14px 8px", color: "var(--cyan)" }}>
                      👤 {picName}
                    </td>
                    <td style={{ padding: "14px 8px" }}>
                      <span style={{ fontSize: 11, background: "var(--panel-glow)", padding: "4px 8px", borderRadius: 4, color: "var(--text-secondary)" }}>
                        {p.model}
                      </span>
                    </td>
                    <td style={{ padding: "14px 8px", color: "var(--text-secondary)" }}>
                      {p.job}
                    </td>
                    <td style={{ padding: "14px 8px", color: "var(--text-secondary)" }}>
                      {p.expectedOb}
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "right", fontWeight: 600 }}>
                      {formatRevenue(p.revenue)}
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "right", color: "var(--text-secondary)" }}>
                      {p.lastMoNsr ? formatRevenue(p.lastMoNsr) : "—"}
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "right", color: "var(--text-secondary)" }}>
                      {p.volume || "—"}
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "center" }}>
                      <span style={{ 
                        fontSize: 11, 
                        fontWeight: 600, 
                        padding: "4px 8px", 
                        borderRadius: 20, 
                        background: statusColor, 
                        color: p.status === "Done" ? "var(--green)" : "var(--amber)"
                      }}>
                        {p.status}
                      </span>
                    </td>
                    <td style={{ padding: "14px 8px", textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                        {/^https?:\/\//i.test(p.sopLink || "") ? (
                          <a
                            href={p.sopLink}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              background: "rgba(20, 224, 196,0.15)",
                              color: "var(--cyan)",
                              padding: "5px 10px",
                              borderRadius: 6,
                              fontSize: 11,
                              fontWeight: 600,
                              textDecoration: "none",
                              border: "1px solid rgba(20, 224, 196,0.2)"
                            }}
                          >
                            Mở SOP 🔗
                          </a>
                        ) : p.sopLink ? (
                          <span
                            title="Ô LINK SOP trên Sheet chỉ có tên/nhãn, không có URL thật — mở Sheet, bấm chuột phải vào ô này > Insert link để gắn lại link đầy đủ."
                            style={{ color: "var(--amber)", fontSize: 11, padding: "5px 10px", cursor: "help" }}
                          >
                            ⚠️ {p.sopLink} (chưa có link)
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: 11, padding: "5px 10px" }}>Chưa có SOP</span>
                        )}
                        <button
                          onClick={() => startEditing(p)}
                          style={{
                            background: canEdit ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)",
                            color: canEdit ? "var(--green)" : "var(--text-muted)",
                            border: `1px solid ${canEdit ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.05)"}`,
                            padding: "5px 10px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: "pointer"
                          }}
                        >
                          {canEdit ? "Chỉnh Sửa ✏️" : "Xem Chi Tiết 🔍"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {!loading && filteredProjects.length === 0 && (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)" }}>
            ✨ Không tìm thấy dự án nào khớp với điều kiện lọc!
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* 🟢 CREATE PROJECT MODAL (Manager only) */}
      {/* ======================================================== */}
      {showAddModal && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--input-bg)", border: "1px solid var(--border)", padding: 24, borderRadius: 16, width: "90%", maxWidth: 650, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 10px 25px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>➕ Khởi Tạo Dự Án Mới</h4>
              <button onClick={() => setShowAddModal(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer" }}>&times;</button>
            </div>

            <form onSubmit={handleAddProject} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Tên Dự Án *</label>
                  <input 
                    type="text" required value={addName} onChange={(e) => setAddName(e.target.value)}
                    placeholder="Nhập tên dự án (ví dụ: Casper B2B...)"
                    style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Phân công PIC</label>
                  <select 
                    value={addPic} onChange={(e) => setAddPic(e.target.value)}
                    style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                  >
                    <option value="">-- Chưa phân công --</option>
                    <option value="tutd@ghn.vn">Duy Tú (tutd@ghn.vn)</option>
                    <option value="diennk@giaohangnhanh.vn">Kim Diện (diennk@giaohangnhanh.vn)</option>
                    <option value="datnt2@ghn.vn">Nguyễn Tiến Đạt (datnt2@ghn.vn)</option>
                  </select>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {canSeeRevenue && (
                  <>
                    <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Doanh Thu Dự Kiến (VND)</label>
                    <input 
                      type="text" value={addRevenue} onChange={(e) => setAddRevenue(e.target.value)}
                      placeholder="Ví dụ: 500.000.000"
                      style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                    />
                  </>
                )}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Dự Kiến Onboarding (OB)</label>
                  <input 
                    type="text" value={addExpectedOb} onChange={(e) => setAddExpectedOb(e.target.value)}
                    placeholder="Ví dụ: Tháng 8/2026"
                    style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Mô hình vận hành</label>
                  <input 
                    type="text" value={addModel} onChange={(e) => setAddModel(e.target.value)}
                    placeholder="Ví dụ: LTL B2B"
                    style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Công việc hiện tại</label>
                  <input 
                    type="text" value={addJob} onChange={(e) => setAddJob(e.target.value)}
                    placeholder="Mặc định: Recap onsite"
                    style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Dự Kiến Volume</label>
                  <input 
                    type="text" value={addVolume} onChange={(e) => setAddVolume(e.target.value)}
                    placeholder="Ví dụ: 10.000 đơn/tháng"
                    style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Tài Liệu SOP Link</label>
                <input 
                  type="url" value={addSopLink} onChange={(e) => setAddSopLink(e.target.value)}
                  placeholder="Nhập đường dẫn Google Docs SOP..."
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Checklist Công Việc / Ghi chú</label>
                <textarea 
                  rows={3} value={addNotes} onChange={(e) => setAddNotes(e.target.value)}
                  placeholder="Nhập thông tin các hạng mục công việc cần chuẩn bị..."
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 13, resize: "none" }}
                />
              </div>

              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 10 }}>
                <button 
                  type="button" onClick={() => setShowAddModal(false)}
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                >
                  Hủy bỏ
                </button>
                <button 
                  type="submit" disabled={saving}
                  style={{ background: "var(--green)", color: "var(--text-primary)", border: "none", padding: "8px 24px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
                >
                  {saving ? "Đang tạo..." : "Khởi Tạo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 🔵 EDIT PROJECT MODAL (Manager or PIC) */}
      {/* ======================================================== */}
      {editingProject && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
          <div style={{ background: "var(--input-bg)", border: "1px solid var(--border)", padding: 24, borderRadius: 16, width: "90%", maxWidth: 650, display: "flex", flexDirection: "column", gap: 16, boxShadow: "0 10px 25px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>
                ✏️ Chỉnh Sửa Tiến Độ: <span style={{ color: "var(--cyan)" }}>{editingProject.name}</span>
              </h4>
              <button onClick={() => setEditingProject(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer" }}>&times;</button>
            </div>

            <form onSubmit={handleUpdateProject} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              
              {/* STEP 1, 2, 3 SECTION */}
              <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: 14, borderRadius: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                <h5 style={{ margin: 0, fontSize: 12, color: "var(--cyan)", textTransform: "uppercase" }}>🚩 Tiến độ chuyên viên (SD3 Pipeline)</h5>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {/* Step 1 */}
                  <div style={{ background: "rgba(0,0,0,0.15)", padding: 10, borderRadius: 6, border: "1px solid rgba(255,255,255,0.02)" }}>
                    <label style={{ fontSize: 11, fontWeight: "bold", display: "block", marginBottom: 4 }}>Bước 1: Recap Onsite</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <select 
                        value={editRecapStatus} onChange={(e) => setEditRecapStatus(e.target.value)}
                        style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px", borderRadius: 4, fontSize: 12 }}
                      >
                        <option value="Chưa thực hiện">Chưa thực hiện</option>
                        <option value="Đang thực hiện">Đang thực hiện</option>
                        <option value="Done">Done</option>
                      </select>
                      <input 
                        type="url" value={editRecapLink} onChange={(e) => setEditRecapLink(e.target.value)}
                        placeholder="Dán link report onsite..."
                        style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px", borderRadius: 4, fontSize: 12 }}
                      />
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div style={{ background: "rgba(0,0,0,0.15)", padding: 10, borderRadius: 6, border: "1px solid rgba(255,255,255,0.02)" }}>
                    <label style={{ fontSize: 11, fontWeight: "bold", display: "block", marginBottom: 4 }}>Bước 2: Viết SOP</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <select 
                        value={editSopStatus} onChange={(e) => setEditSopStatus(e.target.value)}
                        style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px", borderRadius: 4, fontSize: 12 }}
                      >
                        <option value="Chưa thực hiện">Chưa thực hiện</option>
                        <option value="Đang thực hiện">Đang thực hiện</option>
                        <option value="Done">Done</option>
                      </select>
                      <input 
                        type="url" value={editSopLink} onChange={(e) => setEditSopLink(e.target.value)}
                        placeholder="Dán link SOP docs..."
                        style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px", borderRadius: 4, fontSize: 12 }}
                      />
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div style={{ background: "rgba(0,0,0,0.15)", padding: 10, borderRadius: 6, border: "1px solid rgba(255,255,255,0.02)" }}>
                  <label style={{ fontSize: 11, fontWeight: "bold", display: "block", marginBottom: 4 }}>Bước 3: Kick OFF Onboard</label>
                  <select 
                    value={editKickoffStatus} onChange={(e) => setEditKickoffStatus(e.target.value)}
                    style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px", borderRadius: 4, fontSize: 12, width: "100%" }}
                  >
                    <option value="Chưa thực hiện">Chưa thực hiện</option>
                    <option value="Đang thực hiện">Đang thực hiện</option>
                    <option value="Done">Done</option>
                  </select>
                </div>
              </div>

              {/* MANAGER ADMIN SETUP SECTION */}
              <div style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", padding: 14, borderRadius: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                <h5 style={{ margin: 0, fontSize: 12, color: "var(--cyan)", textTransform: "uppercase" }}>⚙️ Thiết lập dự án {isManager ? "(Chỉnh sửa)" : "(Chỉ xem)"}</h5>
                
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Phân công PIC</label>
                    <select 
                      value={editPic} disabled={!isManager} onChange={(e) => setEditPic(e.target.value)}
                      style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                    >
                      <option value="">-- Chưa gán --</option>
                      <option value="tutd@ghn.vn">Duy Tú</option>
                      <option value="diennk@giaohangnhanh.vn">Kim Diện</option>
                      <option value="datnt2@ghn.vn">Nguyễn Tiến Đạt</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Trạng Thái Dự Án</label>
                    <select 
                      value={editStatus} disabled={!isManager} onChange={(e) => setEditStatus(e.target.value)}
                      style={{ background: "var(--input-bg)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                    >
                      <option value="Đang thực hiện">Đang thực hiện</option>
                      <option value="Done">Done</option>
                    </select>
                  </div>

                  {canSeeRevenue && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Doanh Thu Dự Kiến</label>
                      <input 
                        type="text" value={editRevenue} disabled={!isManager} onChange={(e) => setEditRevenue(e.target.value)}
                        style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                      />
                    </div>
                  )}

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Dự kiến OB</label>
                    <input 
                      type="text" value={editExpectedOb} disabled={!isManager} onChange={(e) => setEditExpectedOb(e.target.value)}
                      style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Mô hình vận hành</label>
                    <input 
                      type="text" value={editModel} disabled={!isManager} onChange={(e) => setEditModel(e.target.value)}
                      style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Công việc hiện tại</label>
                    <input 
                      type="text" value={editJob} disabled={!isManager} onChange={(e) => setEditJob(e.target.value)}
                      style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Dự kiến Volume</label>
                    <input 
                      type="text" value={editVolume} disabled={!isManager} onChange={(e) => setEditVolume(e.target.value)}
                      style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "6px 8px", borderRadius: 4, fontSize: 12 }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, color: "var(--text-secondary)" }}>Checklist Công Việc / Ghi chú</label>
                <textarea 
                  rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Nhập tiến độ cập nhật chi tiết..."
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 12px", borderRadius: 6, fontSize: 12, resize: "none" }}
                />
              </div>

              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 10 }}>
                <button 
                  type="button" onClick={() => setEditingProject(null)}
                  style={{ background: "var(--panel-glow)", border: "1px solid var(--border)", color: "var(--text-primary)", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                >
                  Đóng
                </button>
                <button 
                  type="submit" disabled={saving}
                  style={{ background: "var(--green)", color: "var(--text-primary)", border: "none", padding: "8px 24px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13 }}
                >
                  {saving ? "Đang lưu..." : "Lưu Cập Nhật"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </div>
      )}

      <style jsx global>{`
        .hover-row:hover {
          background: rgba(255, 255, 255, 0.02) !important;
        }
      `}</style>

    </div>
  );
}
