import { useState, useEffect } from "react";

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

export default function TabOperations({ rawData }) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [picFilter, setPicFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  
  // Expanded project ID state for showing detail SLA/checklist
  const [expandedId, setExpandedId] = useState(null);

  const { user = {} } = rawData || {};

  const fetchProjects = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/projects");
      const json = await res.json();
      if (json.ok) {
        setProjects(json.projects || []);
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
    if (user.role === "pic" && user.pic) {
      // Find matching email or PIC name
      const matchedEmail = Object.keys(PIC_NAMES).find(email => PIC_NAMES[email] === user.pic);
      if (matchedEmail) {
        setPicFilter(matchedEmail);
      }
    }
  }, [user]);

  // Unique list of PIC emails
  const uniquePics = [...new Set(projects.map(p => p["ĐẢM NHIỆM"]).filter(Boolean))].sort();

  // Unique list of Operating Models
  const uniqueModels = [...new Set(projects.map(p => p["MÔ HÌNH VẬN HÀNH"]).filter(Boolean))].sort();

  // Unique list of Statuses
  const uniqueStatuses = [...new Set(projects.map(p => p["TRẠNG THÁI"]).filter(Boolean))].sort();

  // Filter projects list
  const filteredProjects = projects.filter(p => {
    // 1. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const name = String(p["TÊN DỰ ÁN"] || "").toLowerCase();
      const checklist = String(p["CHECK LIST CÔNG VIỆC"] || "").toLowerCase();
      const sla = String(p["Logic SLA"] || "").toLowerCase();
      if (!name.includes(q) && !checklist.includes(q) && !sla.includes(q)) return false;
    }

    // 2. PIC filter
    if (picFilter !== "all" && p["ĐẢM NHIỆM"] !== picFilter) return false;

    // 3. Model filter
    if (modelFilter !== "all" && p["MÔ HÌNH VẬN HÀNH"] !== modelFilter) return false;

    // 4. Status filter
    if (statusFilter !== "all" && p["TRẠNG THÁI"] !== statusFilter) return false;

    return true;
  });

  // Calculate dynamic stats
  const totalCount = filteredProjects.length;
  const inProgressCount = filteredProjects.filter(p => p["TRẠNG THÁI"] === "Đang thực hiện").length;
  const doneCount = filteredProjects.filter(p => p["TRẠNG THÁI"] === "Done").length;
  
  // Calculate total expected revenue
  const totalRevenue = filteredProjects.reduce((sum, p) => {
    const revStr = String(p["Doanh Thu dự kiến"] || "").replace(/[^\d]/g, "");
    if (!revStr) return sum;
    return sum + parseInt(revStr);
  }, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header Panel */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: "16px 20px", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>Team Vận Hành SD3 — Theo Dõi Dự Án Mới</h3>
          <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            Bảng theo dõi tiến độ chuẩn bị và onboard dự án mới của team Solution Điện Máy.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button 
            onClick={fetchProjects}
            disabled={loading}
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "#fff", padding: "8px 16px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}
          >
            🔄 Tải Lại
          </button>
          <div style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
            👤 Vai trò: <strong style={{ color: "var(--cyan)" }}>{user.role === "pic" ? "PIC Vận Hành" : "Manager (Xem toàn bộ)"}</strong>
          </div>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid-4">
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Tổng Dự Án</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--text-primary)" }}>{totalCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Đang theo dõi trong danh sách</div>
        </div>
        <div style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Đang Thực Hiện</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--amber)" }}>{inProgressCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Dự án đang triển khai viết SOP/Onsite</div>
        </div>
        <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Đã Hoàn Thành (Done)</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--green)" }}>{doneCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Dự án đã bàn giao và chạy ổn định</div>
        </div>
        <div style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Doanh Thu Dự Kiến</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--cyan)" }}>
            {totalRevenue > 0 ? (totalRevenue / 1000000000).toFixed(1).replace(".0", "") + " Tỷđ" : "0đ"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Tổng quy mô doanh thu ước tính</div>
        </div>
      </div>

      {/* Filter Row */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 16, borderRadius: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        {/* Search */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 200 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Tìm kiếm dự án</label>
          <input 
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên dự án, checklist, logic SLA..."
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
          />
        </div>

        {/* Filter PIC */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Lọc theo PIC</label>
          <select 
            value={picFilter} 
            onChange={(e) => setPicFilter(e.target.value)}
            disabled={user.role === "pic"}
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, cursor: user.role === "pic" ? "not-allowed" : "pointer" }}
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
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6 }}
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
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6 }}
          >
            <option value="all">Tất cả trạng thái</option>
            {uniqueStatuses.map(status => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Projects Table Container */}
      <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", overflowX: "auto" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "40px 0" }}>
            <div className="spinner" />
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
                <th style={{ textAlign: "right", padding: "12px 8px" }}>Doanh Thu Dự Kiến</th>
                <th style={{ textAlign: "center", padding: "12px 8px" }}>Trạng Thái</th>
                <th style={{ textAlign: "center", padding: "12px 8px" }}>Tài Liệu SOP</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p, idx) => {
                const projName = p["TÊN DỰ ÁN"];
                const isExpanded = expandedId === projName;
                const picEmail = p["ĐẢM NHIỆM"];
                const picName = PIC_NAMES[picEmail] || picEmail || "Chưa phân công";
                const currentJob = p["CÔNG VIỆC"] || "—";
                const expectedOb = p["Dự kiến OB "] || "—";
                const revenue = p["Doanh Thu dự kiến"];
                const status = p["TRẠNG THÁI"] || "Đang thực hiện";
                const model = p["MÔ HÌNH VẬN HÀNH"] || "—";
                const sopText = p["LINK SOP"] || "";
                const hasSop = sopText.trim().length > 0;
                
                let statusColor = "rgba(100,116,139,0.15)";
                if (status === "Đang thực hiện") statusColor = "rgba(245,158,11,0.2)";
                if (status === "Done") statusColor = "rgba(16,185,129,0.2)";

                return (
                  <>
                    {/* Main Row */}
                    <tr 
                      key={projName}
                      onClick={() => setExpandedId(isExpanded ? null : projName)}
                      style={{ 
                        borderBottom: "1px solid rgba(255,255,255,0.05)", 
                        cursor: "pointer", 
                        background: isExpanded ? "rgba(59, 130, 246, 0.05)" : "transparent",
                        transition: "all 0.2s"
                      }}
                      className="hover-row"
                    >
                      <td style={{ padding: "14px 8px", fontWeight: 600, color: "var(--text-primary)" }}>
                        📂 {projName} {isExpanded ? "▲" : "▼"}
                      </td>
                      <td style={{ padding: "14px 8px", color: "var(--cyan)" }}>
                        👤 {picName}
                      </td>
                      <td style={{ padding: "14px 8px" }}>
                        <span style={{ fontSize: 11, background: "rgba(255,255,255,0.05)", padding: "4px 8px", borderRadius: 4, color: "var(--text-secondary)" }}>
                          {model}
                        </span>
                      </td>
                      <td style={{ padding: "14px 8px", color: "var(--text-secondary)" }}>
                        {currentJob}
                      </td>
                      <td style={{ padding: "14px 8px", color: "var(--text-secondary)" }}>
                        {expectedOb}
                      </td>
                      <td style={{ padding: "14px 8px", textAlign: "right", fontWeight: 600 }}>
                        {formatRevenue(revenue)}
                      </td>
                      <td style={{ padding: "14px 8px", textAlign: "center" }}>
                        <span style={{ 
                          fontSize: 11, 
                          fontWeight: 600, 
                          padding: "4px 8px", 
                          borderRadius: 20, 
                          background: statusColor, 
                          color: status === "Done" ? "var(--green)" : "var(--amber)"
                        }}>
                          {status}
                        </span>
                      </td>
                      <td style={{ padding: "14px 8px", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
                        {hasSop ? (
                          <a 
                            href={sopText.startsWith("http") ? sopText : `https://docs.google.com/document/d/`}
                            target="_blank" 
                            rel="noreferrer" 
                            style={{ 
                              background: "rgba(59,130,246,0.15)", 
                              color: "var(--cyan)", 
                              padding: "4px 10px", 
                              borderRadius: 6, 
                              fontSize: 11,
                              fontWeight: 600,
                              textDecoration: "none",
                              border: "1px solid rgba(59,130,246,0.2)"
                            }}
                          >
                            Mở SOP 🔗
                          </a>
                        ) : (
                          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>Chưa có</span>
                        )}
                      </td>
                    </tr>

                    {/* Expanded Detail Row */}
                    {isExpanded && (
                      <tr style={{ background: "rgba(0,0,0,0.2)" }}>
                        <td colSpan={8} style={{ padding: "16px 20px" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
                            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 14, borderRadius: 8 }}>
                              <h5 style={{ margin: "0 0 6px 0", fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase" }}>📋 Checklist Công Việc</h5>
                              <div style={{ fontSize: 13, color: "var(--text-primary)", whiteSpace: "pre-wrap", lineHeight: "1.4" }}>
                                {p["CHECK LIST CÔNG VIỆC"] || "Không có thông tin chi tiết checklist."}
                              </div>
                            </div>
                            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 14, borderRadius: 8 }}>
                              <h5 style={{ margin: "0 0 6px 0", fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase" }}>⚙️ Logic SLA Vận Hành</h5>
                              <div style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: "1.4" }}>
                                {p["Logic SLA"] || "Không có cấu hình SLA đặc biệt."}
                              </div>
                            </div>
                          </div>
                          
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 11, color: "var(--text-muted)" }}>
                            <span>📧 Liên hệ PIC: <strong style={{ color: "var(--cyan)" }}>{picEmail}</strong></span>
                            <span>Mô hình: <strong style={{ color: "var(--green)" }}>{p["MÔ HÌNH VẬN HÀNH"]}</strong></span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
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
    </div>
  );
}
