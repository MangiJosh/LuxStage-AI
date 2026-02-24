import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import crypto from "crypto";

const db = new Database("luxstage.db");

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT,
    room_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS project_images (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    image_data TEXT,
    order_index INTEGER DEFAULT 0,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS variations (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    project_image_id TEXT,
    group_id TEXT,
    image_data TEXT,
    parent_variation_id TEXT,
    is_subversion INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id),
    FOREIGN KEY(project_image_id) REFERENCES project_images(id)
  );
`);

// Migration for existing databases
try {
  db.exec("ALTER TABLE project_images ADD COLUMN order_index INTEGER DEFAULT 0");
} catch (e) {
  // Column already exists
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.post("/api/projects", (req, res) => {
    const { id, name, roomType, images } = req.body;
    db.transaction(() => {
      db.prepare("INSERT INTO projects (id, name, room_type) VALUES (?, ?, ?)").run(id, name, roomType);
      const stmt = db.prepare("INSERT INTO project_images (id, project_id, image_data, order_index) VALUES (?, ?, ?, ?)");
      images.forEach((img: string, index: number) => {
        stmt.run(crypto.randomUUID(), id, img, index);
      });
    })();
    res.json({ success: true });
  });

  app.post("/api/projects/images", (req, res) => {
    const { projectId, imageData } = req.body;
    const id = crypto.randomUUID();
    const stmt = db.prepare("INSERT INTO project_images (id, project_id, image_data, order_index) VALUES (?, ?, ?, ?)");
    
    // Get current max order_index
    const maxOrder = db.prepare("SELECT MAX(order_index) as max_order FROM project_images WHERE project_id = ?").get(projectId);
    const nextOrder = (maxOrder?.max_order || 0) + 1;
    
    stmt.run(id, projectId, imageData, nextOrder);
    res.json({ success: true, id });
  });

  app.get("/api/projects", (req, res) => {
    const projects = db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
    const result = projects.map(p => {
      const images = db.prepare("SELECT image_data FROM project_images WHERE project_id = ? ORDER BY order_index ASC").all(p.id);
      return { ...p, original_image: images[0]?.image_data, images: images.map(i => i.image_data) };
    });
    res.json(result);
  });

  app.get("/api/projects/:id", (req, res) => {
    const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
    const images = db.prepare("SELECT * FROM project_images WHERE project_id = ? ORDER BY order_index ASC").all(req.params.id);
    const variations = db.prepare("SELECT * FROM variations WHERE project_id = ? ORDER BY created_at ASC").all(req.params.id);
    res.json({ ...project, images, variations, original_image: images[0]?.image_data });
  });

  app.post("/api/variations", (req, res) => {
    const { id, projectId, projectImageId, groupId, imageData, parentVariationId, isSubversion } = req.body;
    const stmt = db.prepare("INSERT INTO variations (id, project_id, project_image_id, group_id, image_data, parent_variation_id, is_subversion) VALUES (?, ?, ?, ?, ?, ?, ?)");
    stmt.run(id, projectId, projectImageId, groupId, imageData, parentVariationId, isSubversion ? 1 : 0);
    res.json({ success: true });
  });

  app.delete("/api/projects/:id", (req, res) => {
    const { id } = req.params;
    db.transaction(() => {
      db.prepare("DELETE FROM variations WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM project_images WHERE project_id = ?").run(id);
      db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    })();
    res.json({ success: true });
  });

  app.delete("/api/variations/:id", (req, res) => {
    const { id } = req.params;
    db.prepare("DELETE FROM variations WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve("dist/index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
