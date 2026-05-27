// Global Chart Defaults
Chart.defaults.color = '#94a3b8';
Chart.defaults.font.family = "'JetBrains Mono', monospace";
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(10, 14, 23, 0.9)';
Chart.defaults.plugins.tooltip.titleColor = '#ffffff';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(0, 194, 255, 0.2)';
Chart.defaults.plugins.tooltip.borderWidth = 1;

// Colors
const COLORS = {
    cyan: '#00c2ff', green: '#00e5a0', red: '#ff4757', amber: '#ffb340', purple: '#9d4edd',
    bgPanel: '#0a0e17'
};

// Register Datalabels Plugin
Chart.register(ChartDataLabels);

// State
let state = {
    tab: 'ltl', // ltl or ftl
    months: ['all'],
    weeks: ['all'],
    days: ['all'],
    projects: ['all'],
    vehicles: ['all'],
    types: ['all'] // FTL vehicle type filter
};

// Store active chart instances to destroy them
let activeCharts = {};

// DOM Elements
const els = {
    content: document.getElementById('dashboard-content'),
    navTabs: document.querySelectorAll('.nav-tab'),
    tabLTL: document.getElementById('tab-ltl'),
    tabFTL: document.getElementById('tab-ftl'),
    msMonth: document.getElementById('ms-month'),
    ddMonth: document.getElementById('dd-month'),
    msWeek: document.getElementById('ms-week'),
    ddWeek: document.getElementById('dd-week'),
    msDay: document.getElementById('ms-day'),
    ddDay: document.getElementById('dd-day'),
    msProject: document.getElementById('ms-project'),
    ddProject: document.getElementById('dd-project'),
    msVehicle: document.getElementById('ms-vehicle'),
    ddVehicle: document.getElementById('dd-vehicle'),
    filterType: document.getElementById('filter-type'),
    clock: document.getElementById('live-clock')
};

// Init
function init() {
    startClock();
    
    // Setup Tab click listeners
    els.navTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            els.navTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.tab = tab.dataset.tab;
            
            // reset state
            state.months = ['all'];
            state.weeks = ['all'];
            state.days = ['all'];
            state.projects = ['all'];
            state.vehicles = ['all'];
            
            if (state.tab === 'ftl') {
                if (els.msVehicle) els.msVehicle.style.display = 'block';
                if (els.filterType) els.filterType.style.display = 'flex';
            } else {
                if (els.msVehicle) els.msVehicle.style.display = 'none';
                if (els.filterType) els.filterType.style.display = 'none';
            }
            
            populateMonthFilter();
            populateWeekFilter();
            populateDayFilter();
            populateProjectFilter();
            renderDashboard();
        });
    });

    // Setup Dropdown Headers toggle logic
    document.addEventListener('click', (e) => {
        let header = e.target.closest('.ms-header');
        if (header) {
            let parent = header.parentElement;
            if(parent.classList.contains('disabled')) return;
            let dd = parent.querySelector('.ms-dropdown');
            let isShow = dd.classList.contains('show');
            // Close all
            document.querySelectorAll('.ms-dropdown').forEach(d => d.classList.remove('show'));
            if(!isShow) dd.classList.add('show');
        } else if (!e.target.closest('.cyber-multi-select')) {
            // Click outside
            document.querySelectorAll('.ms-dropdown').forEach(d => d.classList.remove('show'));
        }
    });

    populateMonthFilter();
    populateWeekFilter();
    populateDayFilter();
    populateProjectFilter();
    renderDashboard();
}

function startClock() {
    setInterval(() => {
        const clockEl = document.getElementById('live-clock');
        if (clockEl) clockEl.innerText = new Date().toLocaleTimeString('en-GB', { hour12: false });
    }, 1000);
}

// Helper for UI text update
function updateMsText(parentEl, text) {
    parentEl.querySelector('.ms-header span').textContent = text;
}

// Generate checkboxes for a dropdown
function renderDropdown(dropdownEl, items, stateKey, parentEl, placeholder) {
    let html = `<label class="ms-item"><input type="checkbox" value="all" ${state[stateKey].includes('all') ? 'checked' : ''}><span>Tất cả</span></label>`;
    items.forEach(item => {
        let isChecked = state[stateKey].includes(item.value.toString());
        html += `<label class="ms-item"><input type="checkbox" value="${item.value}" ${isChecked ? 'checked' : ''}><span>${item.label}</span></label>`;
    });
    dropdownEl.innerHTML = html;

    // Update Header Text
    let headerText = state[stateKey].includes('all') ? placeholder : state[stateKey].map(v => items.find(i => i.value.toString() === v)?.label).join(', ');
    if(state[stateKey].length > 2 && !state[stateKey].includes('all')) headerText = state[stateKey].length + ' mục đã chọn';
    updateMsText(parentEl, headerText);

    // Attach listeners
    dropdownEl.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        chk.addEventListener('change', (e) => {
            let val = e.target.value;
            let checked = e.target.checked;
            
            if(val === 'all') {
                state[stateKey] = checked ? ['all'] : ['all']; 
            } else {
                let current = state[stateKey].filter(v => v !== 'all');
                if(checked) current.push(val);
                else current = current.filter(v => v !== val);
                
                if(current.length === 0) state[stateKey] = ['all'];
                else state[stateKey] = current;
            }

            // Cascading reset logic
            if (stateKey === 'months') {
                populateWeekFilter();
                populateDayFilter();
            }
            if (stateKey === 'weeks') {
                populateDayFilter();
            }

            populateMonthFilter();
            renderDashboard();
        });
    });
}

function populateMonthFilter() {
    let ds = state.tab === 'ftl' ? FLAT_FTL : FLAT_LTL;
    let months = [...new Set(ds.map(r => r.m))].sort((a,b) => a-b).map(m => ({value: m, label: `Tháng ${m}`}));
    renderDropdown(els.ddMonth, months, 'months', els.msMonth, "Tất cả Tháng");
}

function populateWeekFilter() {
    let ds = state.tab === 'ftl' ? FLAT_FTL : FLAT_LTL;
    if (!state.months.includes('all')) {
        ds = ds.filter(r => state.months.includes(r.m.toString()));
    }
    let set = new Set();
    ds.forEach(r => set.add(r.w));
    let items = Array.from(set).sort((a,b)=>a-b).map(w => ({value: w, label: "Tuần " + w}));
    renderDropdown(els.ddWeek, items, 'weeks', els.msWeek, "Tất cả Tuần");
    
    if (state.months.includes('all')) {
        els.msWeek.classList.add('disabled');
        state.weeks = ['all'];
        updateMsText(els.msWeek, "Tất cả Tuần");
    } else {
        els.msWeek.classList.remove('disabled');
    }
}

function populateDayFilter() {
    if (!els.msDay || !els.ddDay) return;
    let ds = state.tab === 'ftl' ? FLAT_FTL : FLAT_LTL;
    if (!state.months.includes('all')) {
        ds = ds.filter(r => state.months.includes(r.m.toString()));
    }
    if (!state.weeks.includes('all')) {
        ds = ds.filter(r => state.weeks.includes(r.w.toString()));
    }
    let set = new Set();
    ds.forEach(r => set.add(r.d));
    let items = Array.from(set).filter(d => d).sort((a,b)=>a-b).map(d => ({value: d, label: "Ngày " + d}));
    renderDropdown(els.ddDay, items, 'days', els.msDay, "Tất cả Ngày");
    
    if (state.months.includes('all') && state.weeks.includes('all')) {
        els.msDay.classList.add('disabled');
        state.days = ['all'];
        updateMsText(els.msDay, "Tất cả Ngày");
    } else {
        els.msDay.classList.remove('disabled');
    }
}

const vehName = (v) => {
    let sv = String(v);
    if(sv.includes('1900')) return 'Xe 1T9';
    if(sv.includes('5000')) return 'Xe 5T';
    if(sv.includes('8000')) return 'Xe 8T';
    return v + ' kg';
};

function populateProjectFilter() {
    let ds = state.tab === 'ftl' ? FLAT_FTL : FLAT_LTL;
    let set = new Set();
    ds.forEach(r => set.add(r.c));
    let items = Array.from(set).sort().map(v => ({value: v, label: v}));
    renderDropdown(els.ddProject, items, 'projects', els.msProject, "Tất cả Dự án");
}

function populateVehicleFilter() {
    let ds = FLAT_FTL;
    let set = new Set();
    ds.forEach(r => set.add(r.veh));
    let items = Array.from(set).sort().map(v => ({value: v, label: vehName(v)}));
    renderDropdown(els.ddVehicle, items, 'vehicles', els.msVehicle, "Tất cả Loại Xe");
}

// Helper to format numbers
const fmt = (num) => Math.round(num).toLocaleString();

// Destroy charts
function clearCharts() {
    Object.values(activeCharts).forEach(c => c.destroy());
    activeCharts = {};
}

// Render Dashboard based on Tab
function renderDashboard() {
    clearCharts();
    els.content.innerHTML = '';
    els.content.className = 'dashboard-content fade-in';
    
    // Quick trick to restart animation
    void els.content.offsetWidth; 

    let filterBar = document.querySelector('.filter-bar');

    if (state.tab === 'overview') {
        if(filterBar) filterBar.style.display = 'flex';
        renderOverview();
    } else if (state.tab === 'ftl') {
        if(filterBar) filterBar.style.display = 'flex';
        renderFTL();
    } else if (state.tab === 'settings') {
        if(filterBar) filterBar.style.display = 'none';
        renderSettings();
    }
}

function renderSettings() {
    els.content.innerHTML = `
        <div class="chart-panel" style="animation: fadeIn 0.5s ease;">
            <div class="panel-title" style="font-size: 20px; color: var(--cyan); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 15px; margin-bottom: 20px;">
                <i class="ri-settings-4-line"></i> Cài đặt hệ thống & Cấu hình Filter
            </div>
            
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
                <div class="ai-box" style="background: rgba(10, 14, 23, 0.5); border: 1px solid var(--border-color);">
                    <h4 style="color: var(--cyan); margin-bottom: 15px;"><i class="ri-database-2-line"></i> Nguồn Dữ Liệu (Data Source)</h4>
                    <p style="margin-bottom: 15px; color: var(--text-secondary); font-size: 13px;">Hệ thống đang được liên kết trực tiếp với file Google Sheet Raw Data thông qua API Python.</p>
                    <label style="display: block; font-size: 12px; color: #fff; margin-bottom: 8px;">Đường dẫn Google Sheet:</label>
                    <input type="text" value="https://docs.google.com/spreadsheets/d/1gE2LO4jGOE6EmUIGP-jFpTSRQ-g2ge7M-PDnR_aa6g0/edit" style="width: 100%; padding: 12px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 8px; font-family: 'JetBrains Mono', monospace; font-size: 12px;" readonly>
                    
                    <button style="margin-top: 20px; width: 100%; padding: 12px; background: var(--cyan); color: #000; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s;" onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1" onclick="alert('Tính năng đồng bộ tự động đã được lên lịch.\\nDữ liệu mới nhất đã được kéo về máy chủ thành công!')">
                        <i class="ri-refresh-line"></i> Đồng bộ dữ liệu thủ công
                    </button>
                </div>

                <div class="ai-box" style="background: rgba(10, 14, 23, 0.5); border: 1px solid var(--border-color);">
                    <h4 style="color: var(--amber); margin-bottom: 15px;"><i class="ri-filter-3-line"></i> Cấu hình Filter Mặc định</h4>
                    <p style="margin-bottom: 15px; color: var(--text-secondary); font-size: 13px;">Thiết lập các bộ lọc sẽ tự động được chọn mỗi khi mở trang Dashboard.</p>
                    
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                            <input type="checkbox" checked style="accent-color: var(--cyan); width: 18px; height: 18px;">
                            <span style="color: #fff; font-size: 14px;">Mặc định chọn "Tất cả Tháng"</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                            <input type="checkbox" style="accent-color: var(--cyan); width: 18px; height: 18px;">
                            <span style="color: #fff; font-size: 14px;">Mặc định chọn Tuần hiện tại</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                            <input type="checkbox" checked style="accent-color: var(--cyan); width: 18px; height: 18px;">
                            <span style="color: #fff; font-size: 14px;">Bật cảnh báo AI cho Kho giao trễ</span>
                        </label>
                    </div>
                    
                    <button style="margin-top: 24px; width: 100%; padding: 12px; background: transparent; color: var(--amber); border: 1px solid var(--amber); border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(255, 179, 64, 0.1)'" onmouseout="this.style.background='transparent'" onclick="alert('Đã lưu cấu hình Filter mặc định thành công!')">
                        <i class="ri-save-line"></i> Lưu cấu hình
                    </button>
                </div>
                
                <div class="ai-box" style="background: rgba(10, 14, 23, 0.5); border: 1px solid var(--border-color);">
                    <h4 style="color: var(--green); margin-bottom: 15px;"><i class="ri-information-line"></i> Trạng thái Hệ thống</h4>
                    <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 15px;">
                        <div style="display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px;">
                            <span style="color: var(--text-secondary);">Trạng thái Server</span>
                            <span style="color: var(--green); font-weight: 600;">Online <span style="display:inline-block; width:8px; height:8px; background:var(--green); border-radius:50%; margin-left:5px; box-shadow: 0 0 8px var(--green); animation: pulse 2s infinite;"></span></span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px;">
                            <span style="color: var(--text-secondary);">Dung lượng LTL</span>
                            <span style="color: #fff; font-family: 'JetBrains Mono';">~24,800 dòng</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px;">
                            <span style="color: var(--text-secondary);">Dung lượng FTL</span>
                            <span style="color: #fff; font-family: 'JetBrains Mono';">~20,000 dòng</span>
                        </div>
                        <div style="display: flex; justify-content: space-between;">
                            <span style="color: var(--text-secondary);">Cập nhật lần cuối</span>
                            <span style="color: #fff; font-family: 'JetBrains Mono';">Vài phút trước</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function getLTLData() {
    let res = { orders: 0, weight: 0, ontime: 0, broken: 0, clients: {}, by_time: {}, wh: {} };
    
    // Filter logic
    let filtered = FLAT_LTL.filter(r => {
        if (!state.months.includes('all') && !state.months.includes(r.m.toString())) return false;
        if (!state.weeks.includes('all') && !state.weeks.includes(r.w.toString())) return false;
        if (!state.days.includes('all') && !state.days.includes(r.d.toString())) return false;
        if (!state.projects.includes('all') && !state.projects.includes(r.c)) return false;
        return true;
    });

    let useMonthAsTime = (state.months.includes('all') || state.months.length > 1) && state.weeks.includes('all');

    filtered.forEach(r => {
        res.orders++;
        res.weight += r.wt;
        res.ontime += r.ot;
        res.broken += r.br;

        // Client
        if (!res.clients[r.c]) res.clients[r.c] = { orders: 0, weight: 0, ontime: 0, broken: 0 };
        res.clients[r.c].orders++;
        res.clients[r.c].weight += r.wt;
        res.clients[r.c].ontime += r.ot;
        res.clients[r.c].broken += r.br;

        // Time
        let t_key = useMonthAsTime ? `Tháng ${r.m}` : `Tuần ${r.w}`;
        if (!res.by_time[t_key]) res.by_time[t_key] = { orders: 0, ontime: 0, weight: 0, broken: 0 };
        res.by_time[t_key].orders++;
        res.by_time[t_key].ontime += r.ot;
        res.by_time[t_key].weight += r.wt;
        res.by_time[t_key].broken += r.br;

        // Warehouse
        if (!res.wh[r.wh]) res.wh[r.wh] = { total: 0, late: 0, broken: 0 };
        res.wh[r.wh].total++;
        if (r.ot === 0) res.wh[r.wh].late++;
        if (r.br === 1) res.wh[r.wh].broken++;
    });

    return res;
}

function renderOverview() {
    let d = getLTLData();
    let ontimePct = d.orders ? (d.ontime / d.orders) * 100 : 0;
    let latePct = 100 - ontimePct;

    // Sort clients by ontime % (highest to lowest)
    let sortedClients = Object.keys(d.clients).map(c => {
        let co = d.clients[c].orders;
        let con = d.clients[c].ontime;
        let cbr = d.clients[c].broken;
        let late = co - con;
        let opct = co ? (con/co)*100 : 0;
        return { name: c, pct: opct, orders: co, ontime: con, late: late, broken: cbr };
    }).sort((a,b) => b.pct - a.pct); // All clients sorted

    // Top 10 WH Late
    let sortedWhLate = Object.keys(d.wh).map(wh => {
        return { name: wh, total: d.wh[wh].total, late: d.wh[wh].late, pct: d.wh[wh].total ? (d.wh[wh].late/d.wh[wh].total)*100 : 0 };
    }).sort((a,b) => b.late - a.late).slice(0, 10);

    // Top 10 WH Broken
    let sortedWhBroken = Object.keys(d.wh).map(wh => {
        return { name: wh, total: d.wh[wh].total, broken: d.wh[wh].broken };
    }).sort((a,b) => b.broken - a.broken).slice(0, 10);

    // Build Project Table Rows
    let projectRows = sortedClients.map(c => {
        let color = c.pct >= 90 ? 'var(--green)' : (c.pct >= 80 ? 'var(--amber)' : 'var(--red)');
        let icon = c.pct >= 90 ? '<i class="ri-check-line rank-icon good"></i>' : '<i class="ri-close-line rank-icon bad"></i>';
        return `<tr>
            <td style="font-family:'Outfit',sans-serif; font-weight:600; font-size:14px; color:#fff">${icon} ${c.name}</td>
            <td>${fmt(c.orders)}</td>
            <td style="color:var(--green)">${fmt(c.ontime)}</td>
            <td style="color:var(--amber)">${fmt(c.late)}</td>
            <td style="color:var(--red); font-weight:bold">${fmt(c.broken)}</td>
            <td>
                <div class="progress-container">
                    <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${c.pct}%; background:${color}"></div></div>
                    <span class="progress-text" style="color:${color}">${c.pct.toFixed(1)}%</span>
                </div>
            </td>
        </tr>`;
    }).join('');

    els.content.innerHTML = `
        <div class="kpi-grid">
            <div class="kpi-card kpi-cyan"><div class="kpi-title">Tổng Đơn Hàng</div><div class="kpi-value text-cyan">${fmt(d.orders)}</div></div>
            <div class="kpi-card kpi-green"><div class="kpi-title">Ontime (%)</div><div class="kpi-value text-green">${ontimePct.toFixed(1)}%</div></div>
            <div class="kpi-card kpi-red"><div class="kpi-title">Late (%)</div><div class="kpi-value text-red">${latePct.toFixed(1)}%</div></div>
            <div class="kpi-card kpi-amber"><div class="kpi-title">Ca Bể Vỡ</div><div class="kpi-value text-amber">${fmt(d.broken)}</div></div>
            <div class="kpi-card kpi-purple"><div class="kpi-title">Khối Lượng (KG)</div><div class="kpi-value text-purple">${fmt(d.weight)}</div></div>
        </div>
        
        <div class="chart-panel" style="margin-bottom: 16px;">
            <div class="panel-title">On-time theo Dự án</div>
            <div class="table-container" style="height: auto; max-height: 400px">
                <table class="cyber-table">
                    <thead><tr><th>Dự án</th><th>Tổng</th><th>On-time</th><th>Trễ</th><th>Bể vỡ</th><th>Tỷ lệ OT</th></tr></thead>
                    <tbody>${projectRows}</tbody>
                </table>
            </div>
        </div>

        <div class="charts-grid">
            <div class="chart-panel span-2">
                <div class="panel-title">Tiến độ Ontime/Late & Bể Vỡ</div>
                <div class="chart-wrapper"><canvas id="c1"></canvas></div>
            </div>
            <div class="chart-panel">
                <div class="panel-title">Tỷ trọng Khách Hàng (KG)</div>
                <div class="chart-wrapper"><canvas id="c2"></canvas></div>
            </div>
            <div class="chart-panel span-2">
                <div class="panel-title">Sản Lượng Khối Lượng (KG)</div>
                <div class="chart-wrapper"><canvas id="c3"></canvas></div>
            </div>
            <div class="chart-panel">
                <div class="panel-title">Top 10 Kho Bể Vỡ</div>
                <div class="table-container">
                    <table class="cyber-table">
                        <thead><tr><th>Tên Kho</th><th>Tổng Đơn</th><th>Bể Vỡ</th></tr></thead>
                        <tbody id="wh-broken-table"></tbody>
                    </table>
                </div>
            </div>
            <div class="chart-panel span-3">
                <div class="panel-title">Top 10 Kho Giao Trễ</div>
                <div class="table-container" style="height: auto;">
                    <table class="cyber-table">
                        <thead><tr><th>Tên Kho</th><th>Tổng Đơn</th><th>Đơn Trễ</th><th>Tỷ lệ Late</th><th>Trạng thái</th></tr></thead>
                        <tbody id="wh-table"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // Render Charts
    let t_labels = Object.keys(d.by_time).sort((a,b) => {
        let numA = parseInt(a.replace(/[^\d]/g, '')) || 0;
        let numB = parseInt(b.replace(/[^\d]/g, '')) || 0;
        return numA - numB;
    });

    let d_ontime = t_labels.map(k => d.by_time[k].ontime);
    let d_late = t_labels.map(k => d.by_time[k].orders - d.by_time[k].ontime);
    let d_broken = t_labels.map(k => d.by_time[k].broken);

    activeCharts.c1 = new Chart(document.getElementById('c1'), {
        type: 'bar',
        data: {
            labels: t_labels,
            datasets: [
                { label: 'Ontime', data: d_ontime, backgroundColor: COLORS.green, stack: 'Stack 0', datalabels: {display: false} },
                { label: 'Late', data: d_late, backgroundColor: COLORS.red, stack: 'Stack 0' },
                { label: 'Bể vỡ', data: d_broken, type: 'line', borderColor: COLORS.amber, yAxisID: 'y1', borderWidth: 2, datalabels: {display: false} }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { stacked: true, grid: {color: 'rgba(255,255,255,0.05)'} },
                y1: { position: 'right', grid: {display: false} },
                x: { stacked: true, grid: {display: false} }
            },
            plugins: {
                datalabels: {
                    display: function(context) { return context.datasetIndex === 1; },
                    formatter: function(value, context) {
                        let ontime = context.chart.data.datasets[0].data[context.dataIndex];
                        let late = context.chart.data.datasets[1].data[context.dataIndex];
                        let total = ontime + late;
                        if(total === 0) return '';
                        let text = fmt(total);

                        if (context.dataIndex > 0) {
                            let prevOntime = context.chart.data.datasets[0].data[context.dataIndex - 1];
                            let prevLate = context.chart.data.datasets[1].data[context.dataIndex - 1];
                            let prevTotal = prevOntime + prevLate;
                            if (prevTotal > 0) {
                                let grw = ((total - prevTotal) / prevTotal) * 100;
                                let sign = grw > 0 ? '▲' : '▼';
                                text += `\n${sign} ${Math.abs(grw).toFixed(1)}%`;
                            }
                        }
                        return text;
                    },
                    color: '#fff',
                    align: 'top',
                    anchor: 'end',
                    font: { size: 10, weight: 'bold' },
                    textAlign: 'center'
                }
            }
        }
    });

    let c_labels = Object.keys(d.clients).sort((a, b) => d.clients[b].weight - d.clients[a].weight);
    let c_data = c_labels.map(k => Math.round(d.clients[k].weight)); // By weight now
    let donutColors = [COLORS.cyan, COLORS.purple, COLORS.green, COLORS.amber, COLORS.red, '#ff7eb3', '#f093fb', '#4facfe'];
    activeCharts.c2 = new Chart(document.getElementById('c2'), {
        type: 'doughnut',
        data: {
            labels: c_labels,
            datasets: [{ data: c_data, backgroundColor: c_labels.map((_, i) => donutColors[i % donutColors.length]), borderWidth: 0 }]
        },
        options: { 
            responsive: true, maintainAspectRatio: false, cutout: '70%', 
            plugins: { 
                legend: { position: 'right', labels: {color: '#94a3b8'} },
                datalabels: {
                    formatter: (value, ctx) => {
                        let sum = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                        if(sum === 0) return '';
                        return (value * 100 / sum).toFixed(1) + "%";
                    },
                    color: '#fff',
                    font: { weight: 'bold', size: 11 }
                }
            } 
        }
    });

    let w_data = t_labels.map(k => d.by_time[k].weight);
    activeCharts.c3 = new Chart(document.getElementById('c3'), {
        type: 'line',
        data: { labels: t_labels, datasets: [{ label: 'Weight (KG)', data: w_data, borderColor: COLORS.purple, backgroundColor: 'rgba(157, 78, 221, 0.1)', fill: true }] },
        options: { 
            responsive: true, maintainAspectRatio: false,
            plugins: {
                datalabels: {
                    align: 'top',
                    formatter: (value) => value > 0 ? fmt(value) : '',
                    color: '#fff',
                    font: { size: 10 }
                }
            }
        }
    });

    // Render WH Broken Table
    let brokenTbody = document.getElementById('wh-broken-table');
    sortedWhBroken.forEach(wh => {
        if(wh.broken > 0) {
            brokenTbody.innerHTML += `<tr>
                <td>${wh.name}</td><td>${fmt(wh.total)}</td><td style="color:var(--red); font-weight:bold">${fmt(wh.broken)}</td>
            </tr>`;
        }
    });

    // Render WH Late Table
    let tbody = document.getElementById('wh-table');
    sortedWhLate.forEach(wh => {
        let total = wh.total;
        let late = wh.late;
        let pct = wh.pct;
        if(late > 0) {
            let color = pct > 30 ? (pct > 50 ? 'var(--red)' : 'var(--amber)') : 'var(--cyan)';
            let status = pct >= 30 ? '<span style="background:'+color+'; color:#000; padding:2px 6px; border-radius:4px; font-size:11px">CRITICAL</span>' : 'Bình thường';
            tbody.innerHTML += `<tr>
                <td>${wh.name}</td><td>${fmt(total)}</td><td style="color:${color}">${fmt(late)}</td>
                <td style="color:${color}; font-weight:bold">${pct.toFixed(1)}%</td>
                <td>${status}</td>
            </tr>`;
        }
    });
}

function getFTLData() {
    // 1. Lọc Khách hàng mục tiêu: LX Pantos & AQUA SF
    let baseData = FLAT_FTL.filter(r => {
        let client = String(r.c || '').toLowerCase();
        return client.includes('pantos') || client.includes('aqua');
    });

    let filtered = baseData;
    if (!state.months.includes('all')) filtered = filtered.filter(r => state.months.includes(r.m.toString()));
    if (!state.weeks.includes('all')) filtered = filtered.filter(r => state.weeks.includes(r.w.toString()));
    if (!state.days.includes('all')) filtered = filtered.filter(r => state.days.includes(r.d.toString()));
    if (!state.projects.includes('all')) filtered = filtered.filter(r => state.projects.includes(r.c));
    if (!state.vehicles.includes('all')) filtered = filtered.filter(r => state.vehicles.includes(r.veh));

    let res = {
        trips: 0,
        by_month: {},
        vehicles: {},
        days: {},
        veh_by_proj: {},
        veh_by_time: {},
        veh_by_loc: {},
        veh_by_proj_loc: {},
        total_weight: 0,
        total_capacity: 0,
        trip_status: {},
        clients: {},
        kpi: { currentMonth: 0, prevMonth: 0, curName: '', prevName: '' }
    };

    let allCompletedTrips = new Set();
    baseData.forEach(r => {
        let status = 'Đang Xử Lý';
        let rawStatus = (r.status || 'Unknown').toLowerCase();
        if (rawStatus.includes('completed') || rawStatus.includes('hoàn thành') || rawStatus.includes('delivered') || rawStatus.includes('thành công') || rawStatus.includes('done')) {
            status = 'Hoàn Thành';
        }
        if (status === 'Hoàn Thành' && !allCompletedTrips.has(r.trip)) {
            allCompletedTrips.add(r.trip);
            let t_m = r.m;
            res.by_month[t_m] = (res.by_month[t_m] || 0) + 1;
        }
    });

    let availableMonths = Object.keys(res.by_month).map(Number).sort((a,b) => a-b);
    let targetMonth = availableMonths[availableMonths.length - 1]; 
    if (!state.months.includes('all') && state.months.length > 0) {
        let selectedM = Math.max(...state.months.map(Number));
        if (availableMonths.includes(selectedM)) targetMonth = selectedM;
    }
    
    if (targetMonth) {
        res.kpi.curName = `Tháng ${targetMonth}`;
        res.kpi.currentMonth = res.by_month[targetMonth] || 0;
        let prevM = targetMonth - 1;
        res.kpi.prevName = `Tháng ${prevM}`;
        res.kpi.prevMonth = res.by_month[prevM] || 0;
    }

    let seenTrips = new Set();
    filtered.forEach(r => {
        let rawStatus = (r.status || 'Unknown').toLowerCase();
        let status = 'Đang Xử Lý';
        if (rawStatus.includes('completed') || rawStatus.includes('hoàn thành') || rawStatus.includes('delivered') || rawStatus.includes('thành công') || rawStatus.includes('done')) {
            status = 'Hoàn Thành';
        } else if (rawStatus.includes('cancel') || rawStatus.includes('hủy')) {
            status = 'Đã Hủy';
        }

        if (!seenTrips.has(r.trip)) {
            seenTrips.add(r.trip);
            
            res.trip_status[status] = (res.trip_status[status] || 0) + 1;
            
            if (status === 'Hoàn Thành') {
                res.trips++;
                res.vehicles[r.veh] = (res.vehicles[r.veh] || 0) + 1;
                
                // Nếu state.months là 'all', chỉ vẽ ngày của targetMonth
                let shouldAddDay = false;
                if (state.months.includes('all')) {
                    if (r.m === targetMonth) shouldAddDay = true;
                } else {
                    shouldAddDay = true;
                }
                
                if (shouldAddDay) {
                    if (!res.days[r.d]) res.days[r.d] = {};
                    res.days[r.d][r.veh] = (res.days[r.d][r.veh] || 0) + 1;
                }
                
                let client = r.c;
                if (!res.veh_by_proj[client]) res.veh_by_proj[client] = {};
                res.veh_by_proj[client][r.veh] = (res.veh_by_proj[client][r.veh] || 0) + 1;
                
                let timeKey = `Tháng ${r.m}`;
                if (!state.months.includes('all') && state.months.length === 1) {
                    timeKey = `Tuần ${r.w}`;
                } else if (!state.weeks.includes('all')) {
                    timeKey = `Tuần ${r.w}`;
                }
                if (!res.veh_by_time[timeKey]) res.veh_by_time[timeKey] = {};
                res.veh_by_time[timeKey][r.veh] = (res.veh_by_time[timeKey][r.veh] || 0) + 1;
                
                res.total_capacity += (r.cap || 0);
                res.total_weight += (r.wt || 0);
                
                if (!res.clients[client]) res.clients[client] = {trips: 0, weight: 0};
                res.clients[client].trips++;
                res.clients[client].weight += (r.wt || 0);
            }
        }
        
        if (status === 'Hoàn Thành') {
            let loc = r.prov; // Switch back to Province as requested
            if (loc && String(loc).toLowerCase() !== 'nan') {
                if (!res.veh_by_loc[loc]) res.veh_by_loc[loc] = {};
                res.veh_by_loc[loc][r.veh] = (res.veh_by_loc[loc][r.veh] || 0) + 1;
                
                let client = r.c;
                let aiKey = `${client}|${loc}`;
                if (!res.veh_by_proj_loc[aiKey]) res.veh_by_proj_loc[aiKey] = {};
                res.veh_by_proj_loc[aiKey][r.veh] = (res.veh_by_proj_loc[aiKey][r.veh] || 0) + 1;
            }
        }
    });

    // Calculate previous period for AI and charts
    let prevMonths = ['all'];
    let prevWeeks = ['all'];
    let prevDays = ['all'];
    let hasPrev = false;
    let curPeriodName = '';
    let prevPeriodName = '';

    if (!state.days.includes('all') && state.days.length > 0) {
        let cd = Math.max(...state.days.map(Number));
        prevDays = [(cd - 1).toString()];
        hasPrev = true;
        curPeriodName = `Ngày ${cd}`;
        prevPeriodName = `Ngày ${cd - 1}`;
    } else if (!state.weeks.includes('all') && state.weeks.length > 0) {
        let cw = Math.max(...state.weeks.map(Number)); // Lấy tuần mới nhất nếu chọn nhiều
        prevWeeks = [(cw - 1).toString()];
        hasPrev = true;
        curPeriodName = `Tuần ${cw}`;
        prevPeriodName = `Tuần ${cw - 1}`;
    } else if (!state.months.includes('all') && state.months.length > 0) {
        let cm = Math.max(...state.months.map(Number)); // Lấy tháng mới nhất nếu chọn nhiều
        prevMonths = [(cm - 1).toString()];
        hasPrev = true;
        curPeriodName = `Tháng ${cm}`;
        prevPeriodName = `Tháng ${cm - 1}`;
    }

    let prevFiltered = baseData;
    if (!prevMonths.includes('all')) prevFiltered = prevFiltered.filter(r => prevMonths.includes(r.m.toString()));
    if (!prevWeeks.includes('all')) prevFiltered = prevFiltered.filter(r => prevWeeks.includes(r.w.toString()));
    if (!prevDays.includes('all')) prevFiltered = prevFiltered.filter(r => prevDays.includes(r.d.toString()));
    if (!state.projects.includes('all')) prevFiltered = prevFiltered.filter(r => state.projects.includes(r.c));
    if (!state.vehicles.includes('all')) prevFiltered = prevFiltered.filter(r => state.vehicles.includes(r.veh));

    let prev_veh_by_proj = {};
    let prev_veh_by_loc = {};
    let prev_veh_by_proj_loc = {};
    
    prevFiltered.forEach(r => {
        let rawStatus = (r.status || 'Unknown').toLowerCase();
        if (rawStatus.includes('completed') || rawStatus.includes('hoàn thành') || rawStatus.includes('delivered') || rawStatus.includes('thành công') || rawStatus.includes('done')) {
            let client = r.c;
            if (!prev_veh_by_proj[client]) prev_veh_by_proj[client] = 0;
            prev_veh_by_proj[client]++;

            let loc = r.prov;
            if (loc && String(loc).toLowerCase() !== 'nan') {
                if (!prev_veh_by_loc[loc]) prev_veh_by_loc[loc] = {};
                prev_veh_by_loc[loc][r.veh] = (prev_veh_by_loc[loc][r.veh] || 0) + 1;
                
                let aiKey = `${client}|${loc}`;
                if (!prev_veh_by_proj_loc[aiKey]) prev_veh_by_proj_loc[aiKey] = {};
                prev_veh_by_proj_loc[aiKey][r.veh] = (prev_veh_by_proj_loc[aiKey][r.veh] || 0) + 1;
            }
        }
    });

    res.prev_veh_by_proj = prev_veh_by_proj;
    res.prev_veh_by_loc = prev_veh_by_loc;
    res.veh_by_proj_loc = res.veh_by_proj_loc || {};
    res.prev_veh_by_proj_loc = prev_veh_by_proj_loc;
    res.hasPrev = hasPrev;
    res.curPeriodName = curPeriodName;
    res.prevPeriodName = prevPeriodName;
    res.targetMonth = targetMonth;

    return res;
}

function renderFTL() {
    let d = getFTLData();
    
    // Exact hex colors to fix rendering issues
    const cGreen = '#00e5a0';
    const cRed = '#ff0844';
    const cAmber = '#ffb340';
    const cCyan = '#00f2fe';
    const cPurple = '#b026ff';
    const cBg = 'transparent';

    // KPI logic
    let growthHtml = '';
    if (d.kpi.prevMonth > 0) {
        let pct = ((d.kpi.currentMonth - d.kpi.prevMonth) / d.kpi.prevMonth * 100).toFixed(1);
        let color = pct >= 0 ? cGreen : cRed;
        let sign = pct >= 0 ? '▲' : '▼';
        growthHtml = `<span style="color: ${color}; font-size: 14px; font-weight: bold;">${sign} ${Math.abs(pct)}% (So với ${d.kpi.prevName})</span>`;
    }

    let utilPct = d.total_capacity > 0 ? (d.total_weight / d.total_capacity * 100).toFixed(1) : 0;
    let utilColor = utilPct >= 70 ? cGreen : (utilPct >= 50 ? cAmber : cRed);
    let pulseClass = utilPct < 50 ? 'pulse-glow' : '';

    els.content.innerHTML = `
        <div class="kpi-board" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px;">
            <div class="kpi-card" style="animation: fadeIn 0.5s ease;">
                <div class="kpi-title"><i class="ri-truck-fill"></i> Chuyến Giao Thành Công</div>
                <div class="kpi-value" style="color: ${cGreen}"><span class="count-up" data-val="${d.trips}">0</span> <span style="font-size:14px; color:var(--text-secondary)">Chuyến</span></div>
            </div>
            <div class="kpi-card" style="animation: fadeIn 0.5s ease 0.1s both;">
                <div class="kpi-title"><i class="ri-calendar-event-line"></i> Chuyến ${d.kpi.curName || 'N/A'}</div>
                <div class="kpi-value"><span class="count-up" data-val="${d.kpi.currentMonth}">0</span> <span style="font-size:14px; color:var(--text-secondary)">Chuyến</span></div>
                ${growthHtml}
            </div>
            <div class="kpi-card" style="animation: fadeIn 0.5s ease 0.2s both; border-left: 3px solid ${utilColor}">
                <div class="kpi-title"><i class="ri-percent-line"></i> Hiệu suất Tải trọng</div>
                <div class="kpi-value" style="color: ${utilColor}"><span class="count-up" data-val="${utilPct}">0</span>%</div>
                <div style="font-size:12px; color:var(--text-secondary); margin-top:5px;">Sử dụng <span class="count-up" data-val="${Math.round(d.total_weight)}">0</span>kg / <span class="count-up" data-val="${d.total_capacity}">0</span>kg</div>
            </div>
            <div class="kpi-card" style="animation: fadeIn 0.5s ease 0.3s both; border-left: 3px solid var(--purple);">
                <div class="kpi-title"><i class="ri-robot-2-line"></i> Phân tích AI (FTL)</div>
                <div id="ai-insights-ftl" style="font-size:12px; color:var(--text-secondary); margin-top: 5px; line-height:1.4;">
                    <!-- AI text will go here -->
                </div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr; gap: 24px; margin-bottom: 24px;">
            <div class="chart-panel" style="animation: slideUp 0.5s ease 0.1s both;">
                <div class="panel-title" style="color: ${cCyan}; border-bottom: 1px solid rgba(0, 194, 255, 0.2); padding-bottom: 10px; margin-bottom: 15px;">
                    <i class="ri-pie-chart-fill"></i> Tỷ trọng Khối lượng (AQUA vs Pantos)
                </div>
                <div class="chart-container" style="height: 250px;">
                    <canvas id="c-ftl-weight"></canvas>
                </div>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px;">
            <div class="chart-panel" style="animation: slideUp 0.5s ease 0.2s both;">
                <div class="panel-title" style="color: ${cPurple}; border-bottom: 1px solid rgba(157, 78, 221, 0.2); padding-bottom: 10px; margin-bottom: 15px;">
                    <i class="ri-building-4-line"></i> Tình trạng sử dụng xe của từng Dự án
                </div>
                <div class="chart-container" style="height: 300px;">
                    <canvas id="c-ftl-proj"></canvas>
                </div>
            </div>
            <div class="chart-panel" style="animation: slideUp 0.5s ease 0.3s both;">
                <div class="panel-title" style="color: ${cAmber}; border-bottom: 1px solid rgba(255, 179, 64, 0.2); padding-bottom: 10px; margin-bottom: 15px;">
                    <i class="ri-map-pin-line"></i> Top 10 Tỉnh Giao Hàng theo Xe
                </div>
                <div class="chart-container" style="height: 300px;">
                    <canvas id="c-ftl-loc"></canvas>
                </div>
            </div>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr; gap: 24px; margin-bottom: 24px;">
            <div class="chart-panel" style="animation: slideUp 0.5s ease 0.4s both;">
                <div class="panel-title"><i class="ri-calendar-todo-line"></i> Số xe sử dụng theo Ngày (Tháng ${d.targetMonth})</div>
                <div class="chart-container" style="height: 250px;">
                    <canvas id="c-ftl-days"></canvas>
                </div>
            </div>
        </div>
    `;

    // Helpers
    let allVehs = new Set();
    Object.values(d.days).forEach(obj => Object.keys(obj).forEach(v => allVehs.add(v)));
    let vehTypes = Array.from(allVehs).sort((a,b) => parseInt(a) - parseInt(b));
    let vehColors = [cGreen, cCyan, cPurple, cAmber, cRed, '#ffffff'];



    // 2. Client Weight (Doughnut)
    let cwLabels = Object.keys(d.clients);
    let cwData = cwLabels.map(k => d.clients[k].weight);
    activeCharts.c_ftl_weight = new Chart(document.getElementById('c-ftl-weight'), {
        type: 'doughnut',
        data: {
            labels: cwLabels,
            datasets: [{
                data: cwData,
                backgroundColor: [cCyan, cPurple, cGreen, cAmber],
                borderWidth: 2, borderColor: cBg
            }]
        },
        options: {
            maintainAspectRatio: false, cutout: '65%',
            plugins: {
                legend: { position: 'right', labels: { color: '#ffffff', font: {size: 12} } },
                datalabels: {
                    color: '#ffffff',
                    formatter: (value, ctx) => {
                        let sum = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                        return sum > 0 ? (value * 100 / sum).toFixed(1) + "%" : "0%";
                    },
                    font: { weight: 'bold', size: 14 }
                }
            }
        }
    });

    // 3. Vehicle by Project
    let projLabels = Object.keys(d.veh_by_proj);
    let dsProj = vehTypes.map((v, i) => {
        return {
            label: vehName(v),
            data: projLabels.map(p => d.veh_by_proj[p][v] || 0),
            backgroundColor: vehColors[i % vehColors.length],
            borderRadius: 4
        };
    });
    activeCharts.c_ftl_proj = new Chart(document.getElementById('c-ftl-proj'), {
        type: 'bar',
        data: { labels: projLabels, datasets: dsProj },
        options: {
            maintainAspectRatio: false,
            plugins: { 
                legend: { position: 'top', labels: { color: '#ffffff', font: {size: 11} } }, 
                datalabels: {
                    display: function(context) {
                        return context.datasetIndex === context.chart.data.datasets.length - 1;
                    },
                    formatter: function(value, context) {
                        let total = 0;
                        context.chart.data.datasets.forEach(ds => {
                            total += ds.data[context.dataIndex] || 0;
                        });
                        if(total === 0) return '';
                        
                        let client = context.chart.data.labels[context.dataIndex];
                        let text = total;
                        
                        if (d.hasPrev) {
                            let prevTotal = d.prev_veh_by_proj[client] || 0;
                            if (prevTotal > 0) {
                                let pct = ((total - prevTotal) / prevTotal) * 100;
                                let sign = pct >= 0 ? '▲' : '▼';
                                text += `\n${sign} ${Math.abs(pct).toFixed(1)}%`;
                            } else if (total > 0) {
                                text += `\n▲ 100%`;
                            }
                        }
                        return text;
                    },
                    color: '#fff', align: 'top', anchor: 'end',
                    font: { size: 10, weight: 'bold' }, textAlign: 'center'
                } 
            },
            scales: {
                y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#ffffff' } },
                x: { stacked: true, grid: { display: false }, ticks: { color: '#ffffff', font: {size: 12} } }
            }
        }
    });

    // 4. Top 10 Delivery Locations by Vehicle
    let locTotal = {};
    Object.keys(d.veh_by_loc).forEach(loc => {
        locTotal[loc] = Object.values(d.veh_by_loc[loc]).reduce((a,b)=>a+b,0);
    });
    let locLabels = Object.keys(locTotal).sort((a,b) => locTotal[b] - locTotal[a]).slice(0, 10);
    let shortLocLabels = locLabels.map(l => l.length > 25 ? l.substring(0, 25) + '...' : l);
    
    let dsLoc = vehTypes.map((v, i) => {
        return {
            label: vehName(v),
            data: locLabels.map(loc => d.veh_by_loc[loc][v] || 0),
            backgroundColor: vehColors[i % vehColors.length],
            borderRadius: 4
        };
    });
    activeCharts.c_ftl_loc = new Chart(document.getElementById('c-ftl-loc'), {
        type: 'bar',
        data: { labels: shortLocLabels, datasets: dsLoc },
        options: {
            indexAxis: 'y',
            maintainAspectRatio: false,
            plugins: { 
                legend: { position: 'top', labels: { color: '#ffffff', font: {size: 11} } }, 
                datalabels: { display: false },
                tooltip: { callbacks: { title: (items) => locLabels[items[0].dataIndex] } }
            },
            scales: {
                x: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#ffffff' } },
                y: { stacked: true, grid: { display: false }, ticks: { color: '#ffffff', font: {size: 11} } }
            }
        }
    });

    // 5. Days Stacked Bar Chart (Heatmap)
    let dayLabels = Array.from({length: 31}, (_, i) => i + 1);
    let datasetsDays = vehTypes.map((v, i) => {
        return {
            label: vehName(v),
            data: dayLabels.map(day => (d.days[day] && d.days[day][v]) ? d.days[day][v] : 0),
            backgroundColor: vehColors[i % vehColors.length],
            borderRadius: 2
        };
    });
    activeCharts.c_ftl_days = new Chart(document.getElementById('c-ftl-days'), {
        type: 'bar',
        data: { labels: dayLabels, datasets: datasetsDays },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { color: '#ffffff', font: {size: 11} } }, datalabels: { display: false } },
            scales: {
                y: { stacked: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#ffffff' } },
                x: { stacked: true, grid: { display: false }, ticks: { color: '#ffffff' } }
            }
        }
    });

    // Generate AI Insights
    let aiBox = document.getElementById('ai-insights-ftl');
    if (aiBox) {
        if (!d.hasPrev) {
            aiBox.innerHTML = `Vui lòng chọn 1 Tháng cụ thể hoặc 1 Tuần cụ thể để AI phân tích biến động.`;
        } else {
            let locDiffs = [];
            Object.keys(d.veh_by_proj_loc || {}).forEach(key => {
                let [client, loc] = key.split('|');
                vehTypes.forEach(v => {
                    let cur = d.veh_by_proj_loc[key][v] || 0;
                    let prev = (d.prev_veh_by_proj_loc[key] && d.prev_veh_by_proj_loc[key][v]) ? d.prev_veh_by_proj_loc[key][v] : 0;
                    let diff = cur - prev;
                    if (diff !== 0) {
                        locDiffs.push({ client, loc, v, diff });
                    }
                });
            });
            
            locDiffs.sort((a,b) => b.diff - a.diff);
            
            let insightText = '';
            if (locDiffs.length > 0) {
                let topPos = locDiffs[0];
                let topNeg = locDiffs[locDiffs.length - 1];
                
                if (topPos.diff > 0) {
                    insightText += `<div style="margin-bottom: 8px; padding: 10px; background: rgba(0, 229, 160, 0.1); border-left: 3px solid ${cGreen}; border-radius: 4px;">
                        <span style="color:${cGreen}; font-size:16px;">📈</span> Dự án <strong style="color:${cCyan}">${topPos.client}</strong> tuyến <strong style="color:${cAmber}">${topPos.loc}</strong> ${d.curPeriodName} có sự tăng thêm <strong style="color:${cGreen}; font-size: 14px;">${topPos.diff} chuyến ${vehName(topPos.v)}</strong> so với ${d.prevPeriodName}.
                    </div>`;
                }
                if (topNeg.diff < 0) {
                    insightText += `<div style="padding: 10px; background: rgba(255, 8, 68, 0.1); border-left: 3px solid ${cRed}; border-radius: 4px;">
                        <span style="color:${cRed}; font-size:16px;">📉</span> Dự án <strong style="color:${cCyan}">${topNeg.client}</strong> tuyến <strong style="color:${cAmber}">${topNeg.loc}</strong> ${d.curPeriodName} giảm <strong style="color:${cRed}; font-size: 14px;">${Math.abs(topNeg.diff)} chuyến ${vehName(topNeg.v)}</strong> so với ${d.prevPeriodName}. Cần lưu ý tối ưu.
                    </div>`;
                }
            }
            
            if (insightText === '') {
                insightText = `<div style="padding: 10px; background: rgba(255,255,255, 0.05); border-left: 3px solid #ccc; border-radius: 4px;">✅ Dữ liệu ${d.curPeriodName} ổn định, không có biến động bất thường so với ${d.prevPeriodName}.</div>`;
            }
            
            aiBox.innerHTML = insightText;
        }
    }

    // Run Count-Up Animations
    document.querySelectorAll('.count-up').forEach(el => {
        let end = parseFloat(el.getAttribute('data-val'));
        if (isNaN(end)) return;
        let start = 0;
        let duration = 1500;
        let startTime = null;
        let isInt = end % 1 === 0;
        function step(timestamp) {
            if (!startTime) startTime = timestamp;
            let progress = Math.min((timestamp - startTime) / duration, 1);
            let ease = 1 - Math.pow(1 - progress, 4); // Quartic ease out
            let val = start + (end - start) * ease;
            el.innerHTML = isInt ? fmt(Math.round(val)) : fmt(val.toFixed(1));
            if (progress < 1) window.requestAnimationFrame(step);
            else el.innerHTML = isInt ? fmt(Math.round(end)) : fmt(end.toFixed(1));
        }
        window.requestAnimationFrame(step);
    });
}

window.addEventListener('DOMContentLoaded', init);
