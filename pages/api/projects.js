import fs from "fs";
import path from "path";
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth-options";

export default async function handler(req, res) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: "Unauthorized" });

  const storePath = path.join(process.cwd(), "lib", "projects-store.json");

  // Read current project database
  let store = { projects: [] };
  try {
    if (fs.existsSync(storePath)) {
      const content = fs.readFileSync(storePath, "utf8");
      if (content.trim()) {
        store = JSON.parse(content);
      }
    }
  } catch (err) {
    console.error("Failed to read projects-store.json", err);
  }

  // Handle GET request
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, projects: store.projects || [] });
  }

  // Handle POST request (create or update project)
  if (req.method === "POST") {
    try {
      const { action, id, name, pic, bdLink, onsiteLink, sopLink, stage, notes } = req.body;
      const userName = session.user.name || session.user.email;

      if (action === "create") {
        if (!name) return res.status(400).json({ error: "Missing project name" });
        const newProject = {
          id: `proj-${Date.now()}`,
          name,
          pic: pic || null,
          bdLink: bdLink || "",
          onsiteLink: onsiteLink || "",
          sopLink: sopLink || "",
          stage: stage || 1, // 1: BD Handover, 2: Onsite, 3: SOP, 4: Go-Live
          notes: notes || "",
          createdAt: new Date().toISOString(),
          createdBy: userName,
          updatedAt: new Date().toISOString(),
          updatedBy: userName,
        };
        store.projects = [newProject, ...(store.projects || [])];
      } else if (action === "update") {
        if (!id) return res.status(400).json({ error: "Missing project id" });
        const projIdx = store.projects.findIndex(p => p.id === id);
        if (projIdx === -1) return res.status(404).json({ error: "Project not found" });

        const currentProj = store.projects[projIdx];

        // Merge updates
        store.projects[projIdx] = {
          ...currentProj,
          name: name !== undefined ? name : currentProj.name,
          pic: pic !== undefined ? pic : currentProj.pic,
          bdLink: bdLink !== undefined ? bdLink : currentProj.bdLink,
          onsiteLink: onsiteLink !== undefined ? onsiteLink : currentProj.onsiteLink,
          sopLink: sopLink !== undefined ? sopLink : currentProj.sopLink,
          stage: stage !== undefined ? stage : currentProj.stage,
          notes: notes !== undefined ? notes : currentProj.notes,
          updatedAt: new Date().toISOString(),
          updatedBy: userName,
        };
      } else if (action === "delete") {
        if (!id) return res.status(400).json({ error: "Missing project id" });
        store.projects = (store.projects || []).filter(p => p.id !== id);
      } else {
        return res.status(400).json({ error: "Invalid action" });
      }

      // Write updated database back to JSON file
      fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
      return res.status(200).json({ ok: true, projects: store.projects });
    } catch (err) {
      console.error("Failed to write projects-store.json", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
