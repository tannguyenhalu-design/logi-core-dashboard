import { getSession } from "../../lib/auth";

export default async function handler(req, res) {
  const session = await getSession(req, res);
  const role = req.query.role || "sd3";
  const pic = req.query.pic || "Duy Tú";
  const email = req.query.email || "tutd@giaohangnhanh.vn";
  session.user = {
    email,
    name: pic,
    role,
    pic,
    project: null,
    tabs: ["operations", "users", "ai-insights", "ltl"],
  };
  await session.save();
  res.status(200).json({ ok: true, user: session.user });
}
