/**
 * lib/db-adapter.js — Database Provider Adapter (DAO Pattern)
 *
 * Cung cấp giao diện Data Access Object trừu tượng, hỗ trợ chuyển đổi linh hoạt
 * giữa Google Sheets (hiện tại) và PostgreSQL/Supabase (tương lai).
 *
 * QUAN TRỌNG: các API routes (pages/api/*) KHÔNG cần sửa đổi.
 * Adapter này là migration path cho các bảng write-heavy:
 *   - Users / Sessions (auth)
 *   - AuditLog (lịch sử hành động)
 *   - ActionTrials (thử nghiệm A/B)
 *   - AI_Brain (knowledge graph)
 *
 * Để bật PostgreSQL: thêm DB_ADAPTER_TYPE=postgres vào Vercel env vars
 *   + cấu hình SUPABASE_URL và SUPABASE_ANON_KEY.
 */

// ─── Collections catalog ──────────────────────────────────────────────────────
export const COLLECTIONS = {
  USERS:         "users",
  AUDIT_LOG:     "audit_log",
  ACTION_TRIALS: "action_trials",
  AI_BRAIN:      "ai_brain",
  SOLUTIONS:     "solutions",
};

// ─── Abstract base ────────────────────────────────────────────────────────────
class BaseAdapter {
  get name() { return "base"; }

  /** Lấy 1 document theo id. @returns {Promise<object|null>} */
  async get(collection, id) {
    throw new Error(`${this.constructor.name}.get() not implemented`);
  }

  /** Liệt kê documents với optional filters. @returns {Promise<object[]>} */
  async list(collection, filters = {}) {
    throw new Error(`${this.constructor.name}.list() not implemented`);
  }

  /** Tạo document mới. @returns {Promise<object>} document vừa tạo với id */
  async create(collection, data) {
    throw new Error(`${this.constructor.name}.create() not implemented`);
  }

  /** Cập nhật document. @returns {Promise<boolean>} */
  async update(collection, id, data) {
    throw new Error(`${this.constructor.name}.update() not implemented`);
  }

  /** Xóa document. @returns {Promise<boolean>} */
  async delete(collection, id) {
    throw new Error(`${this.constructor.name}.delete() not implemented`);
  }

  /** Health check. @returns {Promise<{ok:boolean, provider:string, error?:string}>} */
  async healthCheck() {
    return { ok: true, provider: this.name };
  }
}

// ─── Google Sheets Adapter (hiện tại) ────────────────────────────────────────
class SheetsAdapter extends BaseAdapter {
  get name() { return "google-sheets"; }

  async healthCheck() {
    try {
      const { getAuth } = await import("./sheets");
      const auth = getAuth();
      await auth.getClient();
      return { ok: true, provider: this.name };
    } catch (e) {
      return { ok: false, provider: this.name, error: e.message };
    }
  }

  // NOTE: Các phương thức CRUD bên dưới là stubs tài liệu hoá interface.
  // Logic thực tế delegate tới các module chuyên biệt:
  //   AI_Brain    → lib/ai-brain.js (readBrainEntries, saveBrainInsights, ...)
  //   AuditLog    → lib/audit-log.js
  //   ActionTrials→ pages/api/trials.js + lib/solutions.js
  //   Users       → lib/auth.js
  //
  // Khi migrate sang PostgreSQL: thay thế từng module một, không cần sửa routes.

  async get(collection, id) {
    console.warn(`[db-adapter:sheets] get(${collection}, ${id}) → use collection-specific module`);
    return null;
  }

  async list(collection, filters = {}) {
    console.warn(`[db-adapter:sheets] list(${collection}) → use collection-specific module`);
    return [];
  }

  async create(collection, data) {
    console.warn(`[db-adapter:sheets] create(${collection}) → use collection-specific module`);
    return { ...data, _id: `${collection}-${Date.now()}` };
  }

  async update(collection, id, data) {
    console.warn(`[db-adapter:sheets] update(${collection}, ${id}) → use collection-specific module`);
    return false;
  }

  async delete(collection, id) {
    console.warn(`[db-adapter:sheets] delete(${collection}, ${id}) → use collection-specific module`);
    return false;
  }
}

// ─── PostgreSQL / Supabase Adapter (tương lai) ───────────────────────────────
class PostgresAdapter extends BaseAdapter {
  get name() { return "postgres"; }

  constructor() {
    super();
    // TODO: khởi tạo Supabase client khi SUPABASE_URL + SUPABASE_ANON_KEY có sẵn:
    // import { createClient } from "@supabase/supabase-js";
    // this._client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    this._client = null;
  }

  async healthCheck() {
    if (!process.env.SUPABASE_URL) {
      return { ok: false, provider: this.name, error: "SUPABASE_URL chưa cấu hình" };
    }
    // TODO: ping Supabase via this._client.from("_health").select("1")
    return { ok: false, provider: this.name, error: "PostgresAdapter chưa implement — cần cài @supabase/supabase-js" };
  }

  // TODO: implement get/list/create/update/delete sử dụng Supabase client
  // Tham khảo schema migration plan ở REFACTORING_PHASE4_FINAL.md
}

// ─── Factory ──────────────────────────────────────────────────────────────────
let _defaultInstance = null;

/** Tạo adapter mới theo type. */
export function createAdapter(type = "sheets") {
  if (type === "postgres") return new PostgresAdapter();
  return new SheetsAdapter();
}

/**
 * Singleton mặc định — dùng trong future code muốn dùng adapter thay vì module trực tiếp.
 * Type lấy từ DB_ADAPTER_TYPE env var (mặc định: "sheets").
 */
export function getDefaultAdapter() {
  if (!_defaultInstance) {
    const type = (process.env.DB_ADAPTER_TYPE || "sheets").toLowerCase();
    _defaultInstance = createAdapter(type);
  }
  return _defaultInstance;
}

/** Reset singleton (dùng trong tests). */
export function resetAdapter() {
  _defaultInstance = null;
}
