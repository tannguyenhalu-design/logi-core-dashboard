import { useState, useEffect } from "react";

function fmtDate(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
}

export default function TabOperations({ rawData }) {
  const [loading, setLoading] = useState(false);
  const [updates, setUpdates] = useState({});
  const [picFilter, setPicFilter] = useState("all");
  const [clientFilter, setClientFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all"); // all, late, damage
  const [statusFilter, setStatusFilter] = useState("all"); // all, pending, processing, resolved, compensated
  
  // Local changes for form inputs before hitting save
  const [formNotes, setFormNotes] = useState({});
  const [formStatus, setFormStatus] = useState({});
  const [formPics, setFormPics] = useState({});
  const [savingOrder, setSavingOrder] = useState(null);

  // Fetch operational updates from /api/operations
  useEffect(() => {
    async function fetchUpdates() {
      try {
        const res = await fetch("/api/operations");
        const json = await res.json();
        if (json.ok && json.store?.order_updates) {
          setUpdates(json.store.order_updates);
        }
      } catch (err) {
        console.error("Failed to load operations updates:", err);
      }
    }
    fetchUpdates();
  }, []);

  if (!rawData) return <div className="spinner" />;

  const { ltl = [], damage = [], user = {}, picMapping = {} } = rawData;

  // Extract all Late orders (odr_success === 'late' or status !== 'delivered' but passed deadline)
  // Let's filter only July 2026 onwards (already done in API, so we just filter from ltl list)
  const lateOrders = ltl.filter(r => {
    const isLate = String(r.odr_success || "").toLowerCase().trim() === "late";
    return isLate;
  }).map(r => ({
    id: r.order_code,
    order_code: r.order_code,
    client_name: r.client_name,
    type: "late",
    label: "Đơn Giao Trễ",
    pickup_time: r.pickup_time,
    warehouse_lay: r.warehouse_lay || "Không rõ",
    warehouse_giao: r.warehouse_giao || "Không rõ",
    details: `Trễ giao nhận. Hạn giao: ${r.deadline ? r.deadline.slice(0,10) : "Không rõ"}. Ngày giao thực tế: ${r.delivered_time ? r.delivered_time.slice(0,10) : "Chưa giao"}.`,
    offence_place: "",
  }));

  // Extract all Damage cases
  const damageCases = damage.map(r => ({
    id: r.order_code || `dmg-${Math.random()}`,
    order_code: r.order_code || "Không có mã",
    client_name: r.client_name,
    type: "damage",
    label: "Ca Hư Hỏng",
    pickup_time: r.pickup_time || r.case_date,
    warehouse_lay: r.warehouse_lay || "Không rõ",
    warehouse_giao: r.warehouse_giao || "Không rõ",
    details: `${r.damage_type || "Hư hỏng"}: ${r.damage_details || "Không có mô tả chi tiết"}.`,
    offence_place: r.offence_place || "Không rõ",
  }));

  // Combine issues
  const allIssues = [...lateOrders, ...damageCases];

  // Set default PIC filter based on logged-in user if they are a PIC
  useEffect(() => {
    if (user.role === "pic" && user.pic) {
      setPicFilter(user.pic);
    }
  }, [user]);

  // List of unique PIC names from mapping
  const uniquePics = [...new Set(Object.values(picMapping))].sort();

  // List of unique Client names
  const uniqueClients = [...new Set(allIssues.map(i => i.client_name))].sort();

  // Handle saving an update
  const handleSave = async (orderCode) => {
    const status = formStatus[orderCode] || updates[orderCode]?.status || "Chưa xử lý";
    const note = formNotes[orderCode] === undefined ? (updates[orderCode]?.note || "") : formNotes[orderCode];
    const pic = formPics[orderCode] || updates[orderCode]?.pic || picMapping[allIssues.find(i => i.order_code === orderCode)?.client_name] || null;

    setSavingOrder(orderCode);
    try {
      const res = await fetch("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_code: orderCode, status, pic, note }),
      });
      const json = await res.json();
      if (json.ok && json.store?.order_updates) {
        setUpdates(json.store.order_updates);
        // Clear local input buffers
        const newNotes = { ...formNotes };
        delete newNotes[orderCode];
        setFormNotes(newNotes);
      }
    } catch (err) {
      alert("Lỗi lưu trạng thái: " + err.message);
    } finally {
      setSavingOrder(null);
    }
  };

  // Filter issues list
  const filteredIssues = allIssues.filter(issue => {
    const update = updates[issue.order_code] || {};
    
    // 1. PIC filter
    const assignedPic = update.pic || picMapping[issue.client_name] || "Không có PIC";
    if (picFilter !== "all" && assignedPic !== picFilter) return false;

    // 2. Client filter
    if (clientFilter !== "all" && issue.client_name !== clientFilter) return false;

    // 3. Type filter
    if (typeFilter !== "all" && issue.type !== typeFilter) return false;

    // 4. Status filter
    const currentStatus = update.status || "Chưa xử lý";
    if (statusFilter !== "all") {
      if (statusFilter === "pending" && currentStatus !== "Chưa xử lý") return false;
      if (statusFilter === "processing" && currentStatus !== "Đang xử lý") return false;
      if (statusFilter === "resolved" && currentStatus !== "Đã xong") return false;
      if (statusFilter === "compensated" && currentStatus !== "Chờ đền bù") return false;
    }

    return true;
  });

  // Calculate dynamic stats
  const totalCount = filteredIssues.length;
  const pendingCount = filteredIssues.filter(i => (updates[i.order_code]?.status || "Chưa xử lý") === "Chưa xử lý").length;
  const processingCount = filteredIssues.filter(i => updates[i.order_code]?.status === "Đang xử lý").length;
  const resolvedCount = filteredIssues.filter(i => updates[i.order_code]?.status === "Đã xong").length;
  const compensatedCount = filteredIssues.filter(i => updates[i.order_code]?.status === "Chờ đền bù").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header Info */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: "16px 20px", borderRadius: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: "var(--text-primary)" }}>Team Vận Hành LTL — Xử Lý Sự Cố</h3>
          <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--text-muted)" }}>
            Thao tác trực tiếp trạng thái xử lý đơn Late / Bể vỡ & Phân công PIC vận hành.
          </p>
        </div>
        <div style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.2)", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}>
          👤 Vai trò: <strong style={{ color: "var(--cyan)" }}>{user.role === "pic" ? "PIC Vận Hành" : "Manager (Xem toàn bộ)"}</strong>
          {user.pic && <span> | Tên PIC: <strong style={{ color: "var(--green)" }}>{user.pic}</strong></span>}
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid-4">
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase" }}>Tổng Sự Cố</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--text-primary)" }}>{totalCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Late & Bể vỡ đang lọc</div>
        </div>
        <div style={{ background: "rgba(244,63,94,0.05)", border: "1px solid rgba(244,63,94,0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase" }}>Chưa Xử Lý</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--red)" }}>{pendingCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Đang chờ liên hệ/xác minh</div>
        </div>
        <div style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase" }}>Đang Xử Lý</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--amber)" }}>{processingCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Đã liên hệ, đang xử lý</div>
        </div>
        <div style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.15)", padding: 16, borderRadius: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase" }}>Đã Xong / Đền bù</div>
          <div style={{ fontSize: 24, fontWeight: "bold", margin: "6px 0", color: "var(--green)" }}>{resolvedCount + compensatedCount}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Xử lý dứt điểm / có kết quả</div>
        </div>
      </div>

      {/* Filter Row */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--border)", padding: 16, borderRadius: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {/* Filter PIC (Only manager can change, PIC is locked to their own name) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Lọc theo PIC</label>
          <select 
            value={picFilter} 
            onChange={(e) => setPicFilter(e.target.value)}
            disabled={user.role === "pic"}
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, cursor: user.role === "pic" ? "not-allowed" : "pointer" }}
          >
            <option value="all">Tất cả PIC</option>
            {uniquePics.map(pic => (
              <option key={pic} value={pic}>{pic}</option>
            ))}
            <option value="Không có PIC">Không có PIC</option>
          </select>
        </div>

        {/* Filter Client */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Lọc theo Khách hàng</label>
          <select 
            value={clientFilter} 
            onChange={(e) => setClientFilter(e.target.value)}
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6 }}
          >
            <option value="all">Tất cả Khách hàng</option>
            {uniqueClients.map(client => (
              <option key={client} value={client}>{client}</option>
            ))}
          </select>
        </div>

        {/* Filter Issue Type */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 120 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Loại Sự Cố</label>
          <select 
            value={typeFilter} 
            onChange={(e) => setTypeFilter(e.target.value)}
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6 }}
          >
            <option value="all">Tất cả sự cố</option>
            <option value="late">Đơn Giao Trễ</option>
            <option value="damage">Ca Hư Hỏng</option>
          </select>
        </div>

        {/* Filter Status */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>Trạng Thái Vận Hành</label>
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6 }}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="pending">Chưa xử lý</option>
            <option value="processing">Đang xử lý</option>
            <option value="resolved">Đã xong</option>
            <option value="compensated">Chờ đền bù</option>
          </select>
        </div>
      </div>

      {/* Issues List Container */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filteredIssues.map((issue) => {
          const update = updates[issue.order_code] || {};
          const currentStatus = formStatus[issue.order_code] || update.status || "Chưa xử lý";
          const currentPic = formPics[issue.order_code] || update.pic || picMapping[issue.client_name] || "Không có PIC";
          const currentNote = formNotes[issue.order_code] === undefined ? (update.note || "") : formNotes[issue.order_code];
          
          let statusColor = "rgba(100,116,139,0.15)";
          if (currentStatus === "Đang xử lý") statusColor = "rgba(245,158,11,0.2)";
          if (currentStatus === "Đã xong") statusColor = "rgba(16,185,129,0.2)";
          if (currentStatus === "Chờ đền bù") statusColor = "rgba(244,63,94,0.2)";

          return (
            <div 
              key={issue.id} 
              style={{ 
                background: "rgba(255,255,255,0.01)", 
                border: "1px solid var(--border)", 
                borderRadius: 12, 
                padding: "16px 20px", 
                display: "flex", 
                flexDirection: "column", 
                gap: 14,
                boxShadow: "0 4px 6px rgba(0,0,0,0.05)"
              }}
            >
              {/* Card Title Row */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ 
                    fontSize: 11, 
                    fontWeight: 600, 
                    padding: "4px 8px", 
                    borderRadius: 4, 
                    background: issue.type === "late" ? "rgba(244,63,94,0.15)" : "rgba(245,158,11,0.15)",
                    color: issue.type === "late" ? "var(--red)" : "var(--amber)"
                  }}>
                    {issue.label}
                  </span>
                  <strong style={{ fontSize: 14, fontFamily: "monospace", color: "var(--cyan)" }}>
                    {issue.order_code}
                  </strong>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    ({issue.client_name})
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Trạng thái:
                  </span>
                  <span style={{ 
                    fontSize: 12, 
                    fontWeight: 600, 
                    padding: "4px 10px", 
                    borderRadius: 20, 
                    background: statusColor, 
                    color: currentStatus === "Chưa xử lý" ? "var(--text-secondary)" : currentStatus === "Đang xử lý" ? "var(--amber)" : currentStatus === "Đã xong" ? "var(--green)" : "var(--red)",
                    border: "1px solid rgba(255,255,255,0.05)"
                  }}>
                    {currentStatus}
                  </span>
                </div>
              </div>

              {/* Details and Warehouses info */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, background: "rgba(255,255,255,0.01)", padding: 12, borderRadius: 8, border: "1px solid rgba(255,255,255,0.02)" }}>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Nội Dung Sự Cố</div>
                  <div style={{ fontSize: 13, color: "var(--text-primary)", marginTop: 4 }}>{issue.details}</div>
                  {issue.offence_place && (
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                      📍 Nơi phát hiện: <strong>{issue.offence_place}</strong>
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" }}>Tuyến Vận Chuyển</div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                    Kho Lấy: <strong>{issue.warehouse_lay}</strong> ➔ Kho Giao: <strong>{issue.warehouse_giao}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                    Ngày: {issue.pickup_time ? issue.pickup_time.slice(0, 16) : "Không có thông tin"}
                  </div>
                </div>
              </div>

              {/* Operations Input Row */}
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
                {/* Change Status select */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 150 }}>
                  <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Thay đổi Trạng thái</label>
                  <select 
                    value={currentStatus}
                    onChange={(e) => setFormStatus({ ...formStatus, [issue.order_code]: e.target.value })}
                    style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                  >
                    <option value="Chưa xử lý">Chưa xử lý</option>
                    <option value="Đang xử lý">Đang xử lý</option>
                    <option value="Đã xong">Đã xong</option>
                    <option value="Chờ đền bù">Chờ đền bù</option>
                  </select>
                </div>

                {/* Change PIC select */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 160 }}>
                  <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Phân công PIC</label>
                  <select 
                    value={currentPic}
                    onChange={(e) => setFormPics({ ...formPics, [issue.order_code]: e.target.value })}
                    disabled={user.role === "pic"}
                    style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 13, cursor: user.role === "pic" ? "not-allowed" : "pointer" }}
                  >
                    {uniquePics.map(pic => (
                      <option key={pic} value={pic}>{pic}</option>
                    ))}
                    <option value="Không có PIC">Không có PIC</option>
                  </select>
                </div>

                {/* Note input */}
                <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
                  <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Ghi chú xử lý (Nhật ký vận hành)</label>
                  <input 
                    type="text"
                    value={currentNote}
                    onChange={(e) => setFormNotes({ ...formNotes, [issue.order_code]: e.target.value })}
                    placeholder="Nhập ghi chú chi tiết ở đây (ví dụ: đã gọi tài xế, đang xác minh bể vỡ...)"
                    style={{ background: "#0f172a", border: "1px solid var(--border)", color: "#fff", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}
                  />
                </div>

                {/* Save button */}
                <button
                  onClick={() => handleSave(issue.order_code)}
                  disabled={savingOrder === issue.order_code}
                  style={{ 
                    background: "var(--cyan)", 
                    color: "#fff", 
                    border: "none", 
                    padding: "9px 18px", 
                    borderRadius: 6, 
                    fontWeight: 600, 
                    cursor: "pointer", 
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    transition: "all 0.2s"
                  }}
                >
                  {savingOrder === issue.order_code ? (
                    <>
                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" style={{ width: 12, height: 12, display: "inline-block", border: "2px solid #fff", borderRightColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }}></span>
                      Lưu...
                    </>
                  ) : (
                    "Lưu Lại"
                  )}
                </button>
              </div>

              {/* History log footer */}
              {update.updatedAt && (
                <div style={{ borderTop: "1px dashed rgba(255,255,255,0.05)", paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--text-muted)" }}>
                  <span>
                    ✏️ Ghi chú cũ: <em style={{ color: "var(--text-secondary)" }}>"{update.note || "(trống)"}"</em>
                  </span>
                  <span>
                    Cập nhật bởi: <strong style={{ color: "var(--cyan)" }}>{update.updatedBy}</strong> ({fmtDate(update.updatedAt)})
                  </span>
                </div>
              )}
            </div>
          );
        })}

        {filteredIssues.length === 0 && (
          <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--border)", borderRadius: 12, padding: "40px 20px", textAlign: "center", color: "var(--text-muted)" }}>
            ✨ Không tìm thấy sự cố nào cần xử lý với bộ lọc hiện tại!
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
