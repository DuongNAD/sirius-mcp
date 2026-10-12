#!/usr/bin/env node
/**
 * Build Sirius MCP.
 *
 * node_modules never lives in the project folder: the toolchain is resolved from
 * SIRIUS_TOOLCHAIN, falling back to ORION_TOOLCHAIN, VEGA_TOOLCHAIN, POLARIS_TOOLCHAIN,
 * or %LOCALAPPDATA%/aurora-slides/toolchain.
 *
 *   node scripts/build.mjs             bundle dist/sirius.mjs
 *   node scripts/build.mjs --check     type-check with tsc beside toolchain + bundle
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base =
  process.platform === "win32"
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "aurora-slides")
    : join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "aurora-slides");

const TOOL = resolve(
  process.env.SIRIUS_TOOLCHAIN ??
    process.env.ORION_TOOLCHAIN ??
    process.env.VEGA_TOOLCHAIN ??
    process.env.POLARIS_TOOLCHAIN ??
    join(base, "toolchain"),
);
const NM = join(TOOL, "node_modules");
const args = new Set(process.argv.slice(2));
const t0 = Date.now();
const log = (m) => console.log(`[build] ${m}`);

if (!existsSync(join(NM, "esbuild"))) {
  log(`Toolchain not found at ${TOOL}`);
  log(`Please set SIRIUS_TOOLCHAIN to the toolchain directory.`);
  process.exit(1);
}

const req = createRequire(join(TOOL, "package.json"));
const esbuild = req("esbuild");
const DIST = join(ROOT, "dist");
mkdirSync(DIST, { recursive: true });

/* ───────── Type-check (optional) ───────── */
if (args.has("--check")) {
  const work = join(TOOL, "check_sirius");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  cpSync(join(ROOT, "src"), join(work, "src"), { recursive: true });
  writeFileSync(
    join(work, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2023"],
          strict: true,
          noUncheckedIndexedAccess: true,
          noEmit: true,
          skipLibCheck: true,
          types: ["node"],
          esModuleInterop: true,
          resolveJsonModule: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(work, "package.json"), JSON.stringify({ type: "module", private: true }));
  log("type-checking…");
  try {
    execFileSync(process.execPath, [join(NM, "typescript", "bin", "tsc"), "-p", work], {
      cwd: work,
      stdio: "pipe",
    });
    log("types OK");
  } catch (e) {
    const out = String(e.stdout ?? "") + String(e.stderr ?? "");
    console.log(out.split(work).join(ROOT).trim());
    if (!args.has("--force")) process.exit(1);
  }
}

/* ───────── Bundle ───────── */
const outFile = join(DIST, "sirius.mjs");
await esbuild.build({
  entryPoints: [join(ROOT, "src", "index.ts")],
  outfile: outFile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  nodePaths: [NM],
  minifySyntax: true,
  minifyWhitespace: true,
  legalComments: "none",
  logLevel: "warning",
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __siriusCR } from 'node:module';\nconst require = __siriusCR(import.meta.url);",
  },
  metafile: true,
});

const outSize = statSync(outFile).size;
log(`dist/sirius.mjs: ${(outSize / 1024).toFixed(1)} KB`);
log(`done in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
