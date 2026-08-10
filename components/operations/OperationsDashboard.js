import React, { useState, useEffect } from "react";
import { downloadCSV } from "../../lib/csv-export";
import { PIC_NAMES, getTaskOutcome, groupTaskStatus } from "./utils";
import TaskKpiCards from "./cards/TaskKpiCards";
import ProjectStatsCards from "./cards/ProjectStatsCards";
import RevenueCards from "./cards/RevenueCards";
import TaskFilters from "./filters/TaskFilters";
import ProjectFilters from "./filters/ProjectFilters";
import TaskTable from "./tables/TaskTable";
import ProjectTable from "./tables/ProjectTable";
import AddTaskModal from "./modals/AddTaskModal";
import EditTaskModal from "./modals/EditTaskModal";
import AddProjectModal from "./modals/AddProjectModal";
import EditProjectModal from "./modals/EditProjectModal";

export default function OperationsDashboard({ rawData, userRole }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [picFilter, setPicFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeSubTab, setActiveSubTab] = useState("projects");

  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskPicFilter, setTaskPicFilter] = useState("all");
  const [taskStatusFilter, setTaskStatusFilter] = useState("all");
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [editingTaskGroup, setEditingTaskGroup] = useState(null);
  
  const [currentUser, setCurrentUser] = useState({ role: "manager", pic: null });
  const [kpiSyncStatus, setKpiSyncStatus] = useState(null);
  const [ontimeByProject, setOntimeByProject] = useState({});

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProject, setEditingProject] = useState(null);

  const fetchTasks = () => {
    setTasksLoading(true);
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((json) => { if (json.ok) setTasks(json.tasks || []); })
      .catch((e) => console.error("Failed to load tasks:", e))
      .finally(() => setTasksLoading(false));
  };

  useEffect(() => { fetchTasks(); }, []);

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

  useEffect(() => {
    fetch("/api/kpi-sync-status")
      .then((r) => r.json())
      .then((json) => { if (json.ok) setKpiSyncStatus(json); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/ontime-by-project")
      .then((r) => r.json())
      .then((json) => { if (json.ok) setOntimeByProject(json.ontimeByProject || {}); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (currentUser.role === "sd3" && currentUser.pic) {
      setPicFilter(currentUser.pic);
    }
  }, [currentUser]);

  const taskGroupCount = new Set(tasks.map((t) => t.groupId || t.id)).size;

  const handleToggleTaskStatus = async (id, newStatus, note) => {
    const now = new Date().toISOString();
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: newStatus, updatedAt: now, ...(note !== undefined ? { completionNote: note } : {}) } : t)));
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus, note }),
      });
      const json = await res.json();
      if (!json.ok) {
        alert(json.error || "Không thể cập nhật task.");
        fetchTasks();
      }
    } catch (e) {
      fetchTasks();
    }
  };

  const handleDeleteTask = async (id) => {
    const prevTasks = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      const res = await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!json.ok) setTasks(prevTasks);
    } catch (e) {
      setTasks(prevTasks);
    }
  };

  // Projects calculations
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
      const picEmail = String(p.pic || "").toLowerCase();
      const picName = String(PIC_NAMES[p.pic] || "").toLowerCase();
      if (!name.includes(q) && !checklist.includes(q) && !notes.includes(q) && !sla.includes(q) && !picEmail.includes(q) && !picName.includes(q)) return false;
    }
    if (picFilter !== "all" && p.pic !== picFilter) return false;
    if (modelFilter !== "all" && p.model !== modelFilter) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  const totalCount = filteredProjects.length;
  const inProgressCount = filteredProjects.filter(p => p.status === "Đang thực hiện").length;
  const doneCount = filteredProjects.filter(p => p.status === "Done").length;
  const parseRevenue = (val) => {
    const numStr = String(val || "").replace(/[^\d]/g, "");
    return numStr ? parseInt(numStr) : 0;
  };

  const totalRevenue = filteredProjects.reduce((sum, p) => sum + parseRevenue(p.revenue), 0);
  const totalRrNsr = filteredProjects.reduce((sum, p) => sum + parseRevenue(p.rrNsr), 0);
  const canSeeRevenue = userRole === "manager" || userRole === "sd3";

  const revenueByPic = {};
  const revenueByStatus = {};
  // Ontime % per PIC — weighted (not averaged) across their projects, so a
  // 9-project PIC's 90% isn't diluted the same as a 1-project PIC's 90%.
  // Joined by project name against the LTL sheet's client_name (case/space
  // insensitive — the two sheets don't always agree on casing, e.g. "AQUA
  // B2C" here vs "Aqua B2C" there). A project whose name doesn't match
  // anything there at all (genuinely different naming, or no LTL volume
  // yet) is simply left out of the ontime total rather than guessed.
  const ontimeByProjectNormalized = {};
  Object.entries(ontimeByProject).forEach(([name, v]) => {
    ontimeByProjectNormalized[name.trim().toLowerCase()] = v;
  });
  const ontimeByPic = {};
  filteredProjects.forEach((p) => {
    const rev = parseRevenue(p.revenue);
    const rrNsr = parseRevenue(p.rrNsr);
    const picKey = PIC_NAMES[p.pic] || p.pic || "Chưa gán";
    if (!revenueByPic[picKey]) revenueByPic[picKey] = { revenue: 0, rrNsr: 0, count: 0 };
    revenueByPic[picKey].revenue += rev;
    revenueByPic[picKey].rrNsr += rrNsr;
    revenueByPic[picKey].count += 1;

    const statusKey = p.status || "Chưa cập nhật";
    if (!revenueByStatus[statusKey]) revenueByStatus[statusKey] = { revenue: 0, rrNsr: 0, count: 0 };
    revenueByStatus[statusKey].revenue += rev;
    revenueByStatus[statusKey].rrNsr += rrNsr;
    revenueByStatus[statusKey].count += 1;

    const projOntime = ontimeByProjectNormalized[String(p.name || "").trim().toLowerCase()];
    if (projOntime) {
      if (!ontimeByPic[picKey]) ontimeByPic[picKey] = { ontime: 0, late: 0, projectsWithData: 0 };
      ontimeByPic[picKey].ontime += projOntime.ontime || 0;
      ontimeByPic[picKey].late += projOntime.late || 0;
      ontimeByPic[picKey].projectsWithData += 1;
    }
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

  // Task filtering and grouping
  const filteredTasks = tasks.filter((t) => {
    if (taskPicFilter !== "all" && t.pic !== taskPicFilter) return false;
    if (taskStatusFilter !== "all" && getTaskOutcome(t) !== taskStatusFilter) return false;
    return true;
  });
  const taskGroupsMap = new Map();
  filteredTasks.forEach((t) => {
    const gid = t.groupId || t.id;
    if (!taskGroupsMap.has(gid)) taskGroupsMap.set(gid, []);
    taskGroupsMap.get(gid).push(t);
  });
  const taskGroups = Array.from(taskGroupsMap.values());

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
          📋 Quản Lý Task & Deadline Vận Hành SD3 ({taskGroupCount})
        </button>
      </div>

      {activeSubTab === "tasks" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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

          <TaskKpiCards taskGroups={taskGroups} />
          
          <TaskFilters 
            taskPicFilter={taskPicFilter} setTaskPicFilter={setTaskPicFilter}
            taskStatusFilter={taskStatusFilter} setTaskStatusFilter={setTaskStatusFilter} 
          />

          <TaskTable
            taskGroups={taskGroups} tasksLoading={tasksLoading}
            currentUser={currentUser} isManager={isManager}
            handleToggleTaskStatus={handleToggleTaskStatus} handleDeleteTask={handleDeleteTask}
            onEditTask={(members) => setEditingTaskGroup(members)}
          />

          {showAddTaskModal && (
            <AddTaskModal
              onClose={() => setShowAddTaskModal(false)}
              onSuccess={(newTasks, distinctPics) => {
                setTasks((prev) => [...newTasks, ...prev]);
                setShowAddTaskModal(false);
                if (distinctPics.length === 1) {
                  setTaskPicFilter(distinctPics[0]);
                  setPicFilter(distinctPics[0]);
                }
              }}
            />
          )}

          {editingTaskGroup && (
            <EditTaskModal
              members={editingTaskGroup}
              onClose={() => setEditingTaskGroup(null)}
              onSuccess={(updatedTasks) => {
                const byId = new Map(updatedTasks.map((t) => [t.id, t]));
                setTasks((prev) => prev.map((t) => byId.has(t.id) ? byId.get(t.id) : t));
                setEditingTaskGroup(null);
              }}
            />
          )}
        </div>
      ) : (
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
              <div style={{ background: "rgba(var(--brand-rgb),0.1)", border: "1px solid rgba(var(--brand-rgb),0.2)", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
                👤 Vai trò: <strong style={{ color: "var(--cyan)" }}>{isManager ? "Manager (Xem toàn bộ)" : currentUser.role === "cs" ? "CS" : "Chuyên viên SD"}</strong>
                {currentUser.pic && <span> | Tên: <strong style={{ color: "var(--green)" }}>{PIC_NAMES[currentUser.pic] || currentUser.pic}</strong></span>}
              </div>
            </div>
          </div>

          <ProjectStatsCards 
            totalCount={totalCount} inProgressCount={inProgressCount} 
            doneCount={doneCount} canSeeRevenue={canSeeRevenue} 
            totalRevenue={totalRevenue} totalRrNsr={totalRrNsr} 
          />

          {canSeeRevenue && (totalRevenue > 0 || totalRrNsr > 0) && (
            <RevenueCards
              totalRevenue={totalRevenue} totalRrNsr={totalRrNsr}
              kpiSyncStatus={kpiSyncStatus} revenueByPic={revenueByPic} revenueByStatus={revenueByStatus}
              ontimeByPic={ontimeByPic}
            />
          )}

          <ProjectFilters 
            searchQuery={searchQuery} setSearchQuery={setSearchQuery} 
            picFilter={picFilter} setPicFilter={setPicFilter} 
            modelFilter={modelFilter} setModelFilter={setModelFilter} 
            statusFilter={statusFilter} setStatusFilter={setStatusFilter} 
            currentUser={currentUser} uniquePics={uniquePics} 
            uniqueModels={uniqueModels} uniqueStatuses={uniqueStatuses} 
          />

          <ProjectTable 
            filteredProjects={filteredProjects} loading={loading} 
            canSeeRevenue={canSeeRevenue} currentUser={currentUser} 
            isManager={isManager} onEditProject={(p) => setEditingProject(p)} 
          />

          {showAddModal && (
            <AddProjectModal 
              onClose={() => setShowAddModal(false)}
              onSuccess={() => { setShowAddModal(false); fetchProjects(); }}
              canSeeRevenue={canSeeRevenue}
            />
          )}

          {editingProject && (
            <EditProjectModal 
              editingProject={editingProject}
              onClose={() => setEditingProject(null)}
              onSuccess={() => { setEditingProject(null); fetchProjects(); }}
              isManager={isManager} canSeeRevenue={canSeeRevenue}
            />
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
