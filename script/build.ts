import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, cp, mkdir } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("running dual-criterion audit...");
  await import("./auditDualCriterion.js").catch(async () => {
    // tsx import fallback - run via require if needed
    await import("./auditDualCriterion");
  });

  console.log("running canonical TEa render audit...");
  await import("./teaCanonicalRenderAudit.js").catch(async () => {
    await import("./teaCanonicalRenderAudit");
  });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll()
  .then(async () => {
    // Copy static data files into dist/ so they are adjacent to index.cjs
    try {
      await mkdir("dist/data", { recursive: true });
      await cp("server/data", "dist/data", { recursive: true });
      console.log("Copied server/data -> dist/data");
    } catch (e) {
      console.warn("Could not copy server/data:", e);
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
