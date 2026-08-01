import fs from "fs";
import path from "path";
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth-options";

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  const storePath = path.join(process.cwd(), "lib", "operations-store.json");

  // Read existing store
  let store = { order_updates: {} };
  try {
    if (fs.existsSync(storePath)) {
      const content = fs.readFileSync(storePath, "utf8");
      if (content.trim()) {
        store = JSON.parse(content);
      }
    }
  } catch (err) {
    console.error("Failed to read operations-store.json", err);
  }

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, store });
  }

  if (req.method === "POST") {
    try {
      const { order_code, status, pic, note } = req.body;
      if (!order_code) {
        return res.status(400).json({ error: "Missing order_code" });
      }

      if (!store.order_updates) {
        store.order_updates = {};
      }

      // Merge update
      store.order_updates[order_code] = {
        status: status || "Chưa xử lý",
        pic: pic || null,
        note: note || "",
        updatedAt: new Date().toISOString(),
        updatedBy: session.user.name || session.user.email,
      };

      // Save store
      fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
      return res.status(200).json({ ok: true, store });
    } catch (err) {
      console.error("Failed to write operations-store.json", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
