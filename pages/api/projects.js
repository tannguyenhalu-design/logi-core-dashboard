import { fetchSheet } from "../../lib/sheets";
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth-options";

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  try {
    const ltlProjectsId = "161bW-xyPTEBXOLjC0eLjpf0FIBm1QB8YFWXwgo4nWVQ";
    
    // fetchSheet parses headers and maps them to row objects dynamically
    const projects = await fetchSheet("Data dự án ", ltlProjectsId);

    return res.status(200).json({ ok: true, projects });
  } catch (err) {
    console.error("[/api/projects] error:", err);
    return res.status(500).json({ error: err.message });
  }
}
