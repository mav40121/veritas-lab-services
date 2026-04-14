import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve static assets with proper MIME types and long cache
  app.use("/assets", express.static(path.join(distPath, "assets"), {
    maxAge: "1y",
    immutable: true,
    fallthrough: false,
  }));

  app.use(express.static(distPath));

  // SPA catch-all: only for routes that are NOT static asset requests
  app.use("/{*path}", (req, res, next) => {
    // If the request looks like a file (has an extension), return 404 instead of index.html
    if (req.path.match(/\.[a-zA-Z0-9]+$/)) {
      return next();
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
