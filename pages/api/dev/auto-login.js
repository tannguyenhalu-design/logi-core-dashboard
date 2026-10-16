/**
 * GET /api/dev/auto-login
 * Dev-only: tạo manager session ngay, không cần GHN SSO.
 * CHỈ HOẠT ĐỘNG khi NODE_ENV !== "production".
 */
import { getSession } from "../../../lib/auth";

export default async function handler(req, res) {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).end();
  }
  const session = await getSession(req, res);
  session.user = {
    employeeId: "dev-manager",
    username: "Dev Manager",
    email: "dev@localhost",
    name: "Dev Manager",
    role: "manager",
    pic: null,
    project: null,
    tabs: ["ltl", "map", "damage", "events", "report", "trials", "sop"],
    lastChecked: Date.now(),
  };
  await session.save();
  return res.redirect(302, "/dashboard");
}
