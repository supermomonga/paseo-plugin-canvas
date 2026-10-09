import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compilePlugin } from "../node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js";

// Installs the packed plugin the way Paseo acquires npm sources, compiles it
// with Paseo's compiler and renders a formula with the server bundle (ADR 14).
// Dependencies come from the npm registry, so this needs network access.
const root = resolve(import.meta.dirname, "..");
const work = await mkdtemp(join(tmpdir(), "canvas-package-"));
try {
  const [packed] = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", work], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  const installation = join(work, "installation");
  await mkdir(installation);
  await writeFile(
    join(installation, "package.json"),
    JSON.stringify({
      name: "paseo-plugin-installation",
      version: "1.0.0",
      private: true,
      dependencies: { [packed.name]: `file:${join(work, packed.filename)}` },
    }),
  );
  // The options of Paseo's npm acquisition (server/plugins/managed-source/npm.ts).
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      "--package-lock=true",
      "--lockfile-version=3",
      "--include=prod",
      "--omit=dev",
      "--global=false",
      "--workspaces=false",
    ],
    { cwd: installation, stdio: ["ignore", "inherit", "inherit"] },
  );
  const plugin = join(installation, "node_modules", packed.name);
  const manifest = JSON.parse(
    await readFile(join(plugin, "paseo-plugin.json"), "utf8"),
  );
  assert.equal(
    manifest.build,
    undefined,
    "The published manifest must not prepare a Git checkout",
  );
  assert.ok(
    !existsSync(join(installation, "node_modules/vitest")),
    "Paseo installs production dependencies only",
  );

  // Dependencies are hoisted outside the plugin directory, unlike a Git checkout.
  const { serverBundle, clientBundle } = await compilePlugin({
    server: join(plugin, "index.server.ts"),
    client: join(plugin, "index.client.tsx"),
  });
  assert.ok(clientBundle?.includes("Canvas"), "The client entry must compile");

  const data = join(work, "data");
  await mkdir(join(data, ".paseo"), { recursive: true });
  const bundle = join(data, "server.js");
  await writeFile(bundle, serverBundle);
  const child = fork(join(root, "tests/fixtures/bundle-runner.mjs"), [bundle], {
    execArgv: [],
    env: {
      ...process.env,
      HOME: data,
      USERPROFILE: data,
      XDG_DATA_HOME: join(data, "share"),
      LOCALAPPDATA: join(data, "share"),
      PASEO_HOME: join(data, ".paseo"),
    },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  try {
    const [ready] = await once(child, "message");
    assert.equal(ready.type, "ready", ready.message);
    child.send("graphic");
    const [graphic] = await once(child, "message");
    assert.equal(graphic.type, "graphic", graphic.message);
    assert.ok(graphic.png && graphic.width > 20, "Math must render to PNG");
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.send("stop");
      await exited;
    }
  }
  console.log(
    `${packed.filename}: ${packed.entryCount} files, ${packed.size} bytes; npm installation compiles and renders math`,
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
