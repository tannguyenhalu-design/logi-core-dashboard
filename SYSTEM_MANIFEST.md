# SYSTEM MANIFEST — SD3 Dashboard Điện Máy

> **SOURCE CODE WINS** over any documentation when they conflict.
> Mark **UNKNOWN** when source code is ambiguous.
> Last verified: 15/10/2026 via full repository audit (System X-Ray).

---

## 1. System Identity

| Field | Value |
|---|---|
| System name | SD3 Dashboard Điện Máy — Control Tower |
| Version | Not semantically versioned (continuous deploy via GitLab CI) |
| Last audit date | 15/10/2026 |
| Production URL | https://logicore-app.vercel.app |
| Repository / source of truth | `gitlab.ghn.vn/sd3/control-tower` |
| GitHub mirror | Used for Vercel deploy hooks + GitHub Actions CI |
| Primary working directory | `D:\Điện Máy\nextjs-dashboard` |
| Scope | LTL only — B2B Điện Máy (FTL → booking-ftl-tool, separate system) |
| Users | 19 (3 manager + 16 sd3) |

---

## 2. Architecture

### Frontend
- **Framework:** Next.js 16.2.9, Pages Router (NOT App Router)
- **UI library:** React 19.2.4 + react-dom 19.2.4
- **Styling:** Tailwind CSS 4.3.3 + PostCSS + autoprefixer
- **Charts:** Chart.js 4.5.1 + react-chartjs-2 5.3.1 + chartjs-plugin-datalabels
- **Icons:** @remixicon/react 4.9.0
- **Pattern:** Single-page dashboard (`/dashboard`) with 15 dynamically-imported tabs (next/dynamic, ssr:false)
- **State:** React component state only — no Redux/Zustand
- **Data fetching:** Custom SWR pattern via `lib/prefetch.js` + `getStaleDash()`/`setStaleDash()`; stale-while-revalidate 5 min
- **Web Worker:** `workers/province-filter.worker.js` for CPU-intensive province filtering

### Backend
- **Runtime:** Vercel serverless functions (Next.js API routes, `pages/api/**`)
- **Region:** `sin1` (Singapore)
- **Max duration:** 60s for heavy routes (ai-chat, build-snapshot, biweekly report)
- **Auth:** iron-session 8.0.4 — cookie `logi_session`, HttpOnly, SameSite=lax, 8h TTL

### APIs
- 65+ API routes in `pages/api/`
- No centralized middleware — each route validates session and role independently
- See `docs/architecture/api-routes.md` for full inventory

### Data Layer
- **No SQL database** in active use
- Primary persistent storage: **Google Sheets** (structured data) + **Vercel Blob** (snapshots, files)
- Optional: `lib/db-adapter.js` references Supabase — **CONFIGURED but NOT VERIFIED as active**
- In-memory cache: `lib/mem-cache.js`, 5-min TTL, per-Vercel-instance (not shared across instances)

### Storage
- **Vercel Blob** (private, region sin1): snapshots, SOP KB, SOP notes, SOP images, trial images, report locks, health status, ops notes, team reports
- **Google Sheets** (googleapis v4, service account `sd3-dienmay-app@dashboard-sd3.iam.gserviceaccount.com`): all structured records (users, damage, trials, brain, audit)
- See `docs/data/blob-inventory.md` and `docs/data/sheets-schema.md`

### AI
- **Provider chain:** Groq `gpt-oss-120b` → Gemini `gemini-2.5-flash` → Groq `gpt-oss-20b` → Gemini `gemini-3.5-flash-lite`
- **Architecture:** Planner + 3 pure-code agents + LLM Aggregator
- **Memory:** AI Brain in Google Sheet `AI_Brain` tab
- See `docs/ai/ai-system.md`

### Authentication
- **GHN SSO v2 OIDC** (PKCE + JWKS ID token verification via `jose`)
- **Session:** iron-session, cookie `logi_session`, 8h TTL
- **Session re-validation:** every 5 minutes on `/dashboard` load
- **Dev bypass:** `pages/api/dev/auto-login.js` — returns 404 in production

### Scheduler
- **Vercel Cron** (defined in `vercel.json`): snapshot build + raw_ontime backup, daily 02:00 UTC
- **Railway crontab** (`cloud-scraper/crontab`): scrapers 3x/day, keep-warm every 5min
- See `docs/operations/scheduler.md`

### External Integrations
| Service | Purpose | Credentials |
|---|---|---|
| GHN SSO v2 (online-gateway.ghn.vn) | Authentication | GHN_SSO_CLIENT_ID, GHN_SSO_CLIENT_SECRET |
| Google Sheets API v4 | Primary data store | GOOGLE_SERVICE_ACCOUNT_KEY |
| Vercel Blob (private) | Object storage | BLOB_READ_WRITE_TOKEN |
| Groq Cloud API | AI primary provider | GROQ_API_KEY |
| Google Gemini API | AI fallback provider | GEMINI_API_KEY |
| GTalk OA API (mbff.ghn.vn) | SOP bot + delivery dispatch | GTALK_OA_TOKEN, GTALK_OA_ID |
| Railway | Scraper container hosting | Railway deploy key |

### Monitoring
- **System Health tab** (`/api/system-health`, manager only): scraper status, snapshot age, data quality, AI provider stats
- **Scraper heartbeat:** `cloud-scraper/report_health.py` → POST `/api/scraper-heartbeat` → Blob `health/scraper-status.json`
- **No external uptime monitoring** (UptimeRobot, Pingdom, etc.) — UNKNOWN if any exists outside this repo
- **No automated alerts** — all health indicators are view-only in UI

---

## 3. Active Components

See `docs/architecture/components.md` for full list. Key components:

| File | Purpose | Input | Output |
|---|---|---|---|
| `pages/dashboard.js` | Main single-page dashboard, 1034 lines | Session + query params | 15-tab UI |
| `lib/ltl-dashboard.js` | `computeDashboard()` — core KPI computation | raw rows + params | KPI object |
| `lib/transform-ltl.js` | Row-level LTL transforms, on-time calc | raw_ontime rows | structured KPI data |
| `lib/ltl-snapshot.js` | Build/load Vercel Blob snapshots | Google Sheets | `ltl-base.json.gz` |
| `lib/sheets.js` | Google Sheets API client + 5-min cache | Sheet IDs + range | Array of rows |
| `lib/auth.js` | iron-session config + role helpers | Cookie | Session object |
| `lib/sso.js` | GHN SSO v2 OIDC client | OIDC code | Verified user claims |
| `lib/ai-agents/index.js` | `runAgentPipeline()` orchestrator | User message + snapshot | AI reply + sources |
| `lib/ai-providers.js` | Multi-provider fallback chain | Prompt | LLM response |
| `lib/ai-brain.js` | AI Brain: save/load/approve insights | Chat exchange | Google Sheet AI_Brain |
| `lib/dm-clients.js` | Điện Máy client filter rules | Row + scope | Boolean |
| `lib/biweekly-report.js` | Biweekly report computation | Snapshot | Report JSON |
| `lib/damage-rules.js` | Damage rate + compensation rules | Damage rows | Metrics |
| `lib/solutions.js` | Sổ tay Cải tiến CRUD | Trial data | Google Sheet |
| `lib/users.js` | User CRUD + legacy tab migration | User object | Google Sheet Users |
| `components/SOPKnowledgeHub.js` | SOP handbook UI + deep link | stepFilter, clientFilter | SOP UI |
| `pages/api/data.js` | Main data API, ~20 query modes | Query params | Dashboard payload |
| `pages/api/ai-chat.js` | AI chat endpoint, 60s timeout | message + history | reply + sources |
| `cloud-scraper/sheet_scraper.py` | Syncs raw_ontime from GHN portal | Chrome CDP | Google Sheet |
| `cloud-scraper/rillnet_scraper.py` | Scrapes Rillnet damage data | Chrome CDP | POST /api/rillnet-sync |

---

## 4. Data Sources

| Dataset | Source | Writer | Reader | Refresh | Purpose |
|---|---|---|---|---|---|
| `raw_ontime` | Google Sheet (primary) | sheet_scraper.py | lib/transform-ltl.js | 3x/day | 170k+ LTL order rows |
| `mapping` | Google Sheet | Manual | lib/transform-ltl.js | Manual | client→project/PIC |
| `raw_damage_causes` | Google Sheet | rillnet_scraper.py | lib/damage-risk.js | 3x/day | Damage case causes |
| `raw_compensation_summary` | Google Sheet | rillnet_scraper.py | lib/damage-money.js | 3x/day | Compensation totals |
| `raw_damage_cs_tick` | Google Sheet | rillnet_scraper.py | lib/damage-rules.js | 3x/day | CS-confirmed damage |
| `Users` | Google Sheet | admin-users API | lib/users.js | On-demand | 19 user accounts |
| `AI_Brain` | Google Sheet (A:K) | ai-memory API | lib/ai-brain.js | After each chat | AI insights |
| `ActionSolutions` | Google Sheet | trials API | lib/solutions.js | On-demand | Sổ tay Cải tiến |
| `ActionTrials` | Google Sheet | trials API | lib/trials.js | On-demand | Trial phases |
| `AuditLog` | Google Sheet | admin-users + ai-memory | audit-log API | On-demand | Audit trail |
| `client_industry` | Google Sheet | client-industry API | lib/dm-clients.js | Manual | DM/STTP/NHC/ECOM tag |
| `KhoGiaoTongTai` | Google Sheet | Apps Script (tannt@ghn.vn) | vehicle-capacity API | Every 2h | Vehicle capacity |
| `snapshots/ltl-base.json.gz` | Vercel Blob | build-snapshot cron | lib/ltl-snapshot.js | 3x/day + daily cron | Compressed KPI base |
| `snapshots/ltl-default.json.gz` | Vercel Blob | build-snapshot cron | /api/data | Same as base | Pre-computed dashboard |
| `sops-knowledge.json` | Vercel Blob | sops-knowledge API | sop/summary, gtalk-webhook | On-demand | SOP KB entries |
| `sop-delivery-notes.json` | Vercel Blob | sop/summary POST | sop/summary GET, gtalk-webhook | On-demand | Manual SOP notes + images |
| `health/scraper-status.json` | Vercel Blob | scraper-heartbeat API | system-health API | After each scraper run | Scraper health |
| `report-locks/*.json` | Vercel Blob | report/biweekly POST | report/biweekly GET | Manual | Locked reports |

See `docs/data/sheets-schema.md` and `docs/data/blob-inventory.md` for full schemas.

---

## 5. UI Routes & Tabs

| Route | Auth | Purpose |
|---|---|---|
| `/` | SSR redirect | → /dashboard or /login |
| `/login` | None | GHN SSO login button |
| `/dashboard` | iron-session | Main dashboard — 15 tabs |

### Dashboard Tabs

| Tab ID | Label | Component | Role required |
|---|---|---|---|
| `ltl` | Tổng quan LTL | LTLDashboard | ltl tab |
| `map` | Bản đồ | VietnamMap | map tab |
| `damage` | Hư hỏng | LTLDashboard (damage view) | damage tab |
| `events` | Sự kiện | LTLDashboard (events) | events tab |
| `vehicles` | Ghép chuyến | VehicleCapacityPanel | vehicles tab |
| `pnl` | P&L | ProjectPnLPanel | pnl tab |
| `decision` | Quyết định hôm nay | TabDecision | manager or sd3 |
| `report` | Báo cáo công ty | TabCompanyReport | report tab or manager |
| `teamreport` | Báo cáo nội bộ | TabInternalReport | teamreport tab |
| `trials` | Sổ tay Cải tiến | TabTrials | trials tab |
| `sop` | Sổ tay SOP | SOPKnowledgeHub | sop tab |
| `users` | Quản lý Users | TabUsers | manager only |
| `auditlog` | Audit Log | TabAuditLog | manager only |
| `health` | Sức khỏe hệ thống | TabSystemHealth | manager only |
| `brain` | AI Brain | TabBrain | manager only |

**Deep link:** `?step=<pickup|linehaul|delivery|epod>&client=<clientId>` → auto-switch to `sop` tab, filter section, auto-open card.
**Tab link:** `?t=<tabId>` → switch to that tab.

See `docs/ui/dashboard-tabs.md` for details.

---

## 6. AI System

### Providers (`lib/ai-providers.js`)
Priority order with 20s timeout per provider:
1. Groq `gpt-oss-120b` — primary (fastest)
2. Gemini `gemini-2.5-flash` — secondary (largest context)
3. Groq `gpt-oss-20b` — tertiary
4. Gemini `gemini-3.5-flash-lite` — final fallback

### Agents (`lib/ai-agents/`)

| Agent | File | Type | Model | Input | Output |
|---|---|---|---|---|---|
| Planner | `planner.js` | LLM | Groq fast | message + history | intent, agents[], ctx |
| Agent Số liệu | `agent-numbers.js` | Pure code | None | snapshot + ctx | KPI numbers |
| Agent Hư hỏng | `agent-damage.js` | Pure code | None | snapshot + ctx | Damage metrics |
| Agent Giải pháp | `agent-solutions.js` | Pure code | None | trials data | Trial impact |
| Aggregator | `aggregator.js` | LLM | Full chain | agent outputs + brain | Vietnamese reply |

### Memory
- **AI Brain:** Google Sheet `AI_Brain` tab, columns A:K
- States: `Đề xuất` (pending) → `Đã duyệt` (approved by manager) or `Bỏ` (rejected)
- Only `Đã duyệt` entries are injected as context into Aggregator

### Anti-hallucination
- Agents số liệu + hư hỏng are pure code (no LLM involvement)
- Aggregator prompt constraint: only cite numbers returned by agents
- Manager must approve before insight is stored in Brain

### Fallback
- 4-provider chain in `lib/ai-providers.js`
- If all fail → 502 to client
- No retry at handler level; retry is per-provider (20s timeout)

See `docs/ai/ai-system.md`.

---

## 7. Scheduled Jobs

| Schedule (VN) | Job | Platform | File | Status |
|---|---|---|---|---|
| 09:00 daily | Build snapshot | Vercel Cron | `pages/api/cron/build-snapshot.js` | ACTIVE |
| 09:00 daily | Backup raw_ontime | Vercel Cron | `pages/api/cron/backup-raw-ontime.js` | ACTIVE |
| 08:50, 12:50, 17:50 | Master scraper run | Railway crontab | `cloud-scraper/run_scrapers.sh` | ACTIVE |
| Every 5 min, 07–20h | Keep-warm ping | Railway crontab | `cloud-scraper/keep_warm.sh` | ACTIVE |
| Every hour (:20) | Chrome watchdog | Railway crontab | `cloud-scraper/check_chrome.sh` | ACTIVE |
| Every 2h | KhoGiaoTongTai sync | Google Apps Script (tannt@ghn.vn) | External script | ACTIVE |
| — | KPI portal scraper | Railway | `cloud-scraper/kpi_scraper.py` | **PAUSED since 17/09/2026** |
| — | FTL scraper | Railway | `cloud-scraper/ftl_scraper.py` | **DISABLED since 27/08/2026** |

See `docs/operations/scheduler.md`.

---

## 8. Security

### Authentication
- GHN SSO v2 OIDC (PKCE). JWKS verification via `jose`. Handled in `lib/sso.js` + `pages/api/auth/sso-*.js`.
- Session: iron-session, cookie `logi_session`, HttpOnly, SameSite=lax, secure in production, 8h TTL.

### Authorization (Role Model)
| Role | Access |
|---|---|
| `manager` | All tabs, all APIs, AI execute, user management, audit log, brain, health |
| `sd3` | Per-tab permissions + full SOP tab (ngang manager in SOP) |
| `cs` | ltl/map/damage/events tabs only; no AI chat |
| `client` | Own project only; no AI chat |
| `pending` | No access |

**Note:** Authorization is checked per-route, not in centralized middleware. Each API file validates independently.

### Secrets (names only — no values)
`SESSION_SECRET`, `BLOB_READ_WRITE_TOKEN`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `GHN_SSO_CLIENT_ID`, `GHN_SSO_CLIENT_SECRET`, `SNAPSHOT_SECRET`, `RILLNET_SYNC_SECRET`, `CRON_SECRET`, `KPI_SYNC_SECRET`, `GTALK_OA_TOKEN`, `GTALK_OA_ID`, `GTALK_WEBHOOK_SECRET`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_ID_RAWONTIME_BACKUP`

### Known Gaps
- GTalk webhook HMAC (`GTALK_WEBHOOK_SECRET`) is **optional** — if not set, signature verification is skipped
- `/api/sop/image` is **public** (no auth required) — intentional proxy for private blob, but any guessable URL is accessible
- No centralized input schema validation (Zod/Joi)
- Audit log does not cover all write operations

---

## 9. Legacy Components

| Component | Status | Reason | Since |
|---|---|---|---|
| `cloud-scraper/ftl_scraper.py` | DISABLED | FTL tab removed, portal.ghn.vn scraping banned | 27/08/2026 |
| `cloud-scraper/ftl_enrich_vehicle.py` | DISABLED | Same as above | 27/08/2026 |
| `cloud-scraper/sync_ftl_to_db.js` | DEPRECATED | Replaced by Vercel Blob | — |
| `cloud-scraper/sync_to_db.js` | DEPRECATED | Replaced by Vercel Blob | — |
| `cloud-scraper/sync_ftl_order_sheet.js` | MANUAL ONLY | No automation | — |
| `cloud-scraper/kpi_scraper.py` | PAUSED | KPI portal scraping issue | 17/09/2026 |
| `pages/api/hello.js` | STUB | Returns {name:"John Doe"} — no production purpose | — |
| `pages/api/dev/auto-login.js` | DEV-ONLY | Returns 404 in production | — |
| `pages/api/cron/backup.js` | UNKNOWN | May be superseded by backup-raw-ontime.js | — |
| `lib/db-adapter.js` | CONFIGURED | Supabase adapter — not verified as active | — |
| `next-auth` (package) | REFERENCED | Installed but primary auth is iron-session | — |
| `LEGACY_TABS` in `lib/users.js` | REFERENCED | ["operations","tachtrip","ftl"] — backward compat mapping | 26/09/2026 |
| 20+ test/debug scripts at root | DEV SCRIPTS | test-*.mjs/js/py, check_*.mjs, seed-*.mjs | — |
| `scripts/dump_0.csv`, `kpi_sync_log.txt` | LOG FILES | Should not be in source tree | — |

---

## 10. Known Limitations

1. **No SQL database** — all persistent state is Google Sheets or Vercel Blob. No transactions, no indexes, no foreign key enforcement.
2. **AI chat has no streaming** — user waits 3–8s for full pipeline response.
3. **No automated alerts** — health degradation only visible if user opens Health tab.
4. **KPI revenue data is stale** — kpi_scraper.py PAUSED since 17/09/2026.
5. **Rillnet session requires manual renewal** — user must log in via noVNC when session expires.
6. **In-memory cache is per-Vercel-instance** — cold starts or new instances have no warm cache.
7. **PDF export quality depends on browser print** — `window.print()` only, no server-side rendering.
8. **raw_damage_cs_tick missing 489 historical cases** before 04/10/2026.
9. **No external uptime monitoring** — no PagerDuty/UptimeRobot integration found.
10. **GTalk MiniApp deployment status unknown** — `gtalk-miniapp.json` exists but production deploy not verified.
11. **P&L Panel is a stub** — `pages/api/project-pnl.js` returns only `{canView: bool}`, no actual P&L data.
12. **LG SOP URL is broken** — needs new URL from PIC.

---

## 11. Known Missing Capabilities

1. Push alerts when KPI drops below threshold
2. Automated anomaly detection → trial creation pipeline (code partially exists in `lib/anomaly-detector.js` but trigger is UNKNOWN)
3. Streaming AI responses
4. Centralized input validation schema
5. External uptime monitoring
6. P&L data (actual revenue per project, not just canView flag)
7. Notification when AI Brain has new `Đề xuất` entries
8. Samsung SDS SOP, Nguyễn Kim SOP (need SOP content from user)
9. KPI portal revenue sync resumption

---

## 12. System Invariants

These behaviors MUST NOT be broken during future development:

1. **SSO is the only login path in production** — `auto-login` must remain 404 in production.
2. **Snapshot is the data source for AI agents** — agents must never call external APIs or Sheets directly during chat pipeline; only use pre-computed snapshot.
3. **AI Brain entries require manager approval before injection** — `Đề xuất` entries must never be sent to Aggregator; only `Đã duyệt`.
4. **role='client' can only see their own project data** — enforced in `/api/data` and must remain so.
5. **role='cs' cannot access AI chat** — enforced in `/api/ai-chat` and must remain so.
6. **BLOB_READ_WRITE_TOKEN must remain server-side only** — never expose to client.
7. **Cron/scraper APIs require CRON_SECRET or SNAPSHOT_SECRET** — must not be callable without auth.
8. **SOP image proxy (/api/sop/image) uses server-side blob token** — client never receives raw Blob credentials.
9. **GTalk webhook must not loop** — self-message filter (`senderId === GTALK_OA_ID`) must remain.
10. **LTL scope = isLTLRow + isDMRow + isFromJuly2026** — changing these filters changes which orders appear in all KPIs.
11. **No portal.ghn.vn browsing/CDP** — banned after incident 27/08/2026; cloud-scraper must not access this domain.
12. **Session cookie `logi_session` must remain HttpOnly + SameSite=lax** — changing these breaks security posture.

---

*Generated from System X-Ray audit of `D:\Điện Máy\nextjs-dashboard` on 15/10/2026.*
*See `/docs/` for detailed sub-documents.*
