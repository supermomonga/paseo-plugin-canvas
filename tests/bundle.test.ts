import { expect, test } from "vitest";
import { fork } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { compilePlugin } from "../node_modules/@getpaseo/server/dist/server/server/plugins/compiler.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
test("Paseo compiler bundles both entries; server bundle starts, injects MCP and shares data with panel RPC", async () => {
  const root = process.cwd();
  const bundles = await compilePlugin({
    client: path.join(root, "index.client.tsx"),
    server: path.join(root, "index.server.ts"),
  });
  expect(bundles.clientBundle).toContain("Canvas");
  for (const name of [
    "puppeteer",
    "react-native-webview",
    "react-native-svg",
    "@mathjax",
    "@resvg",
  ]) {
    expect(bundles.clientBundle).not.toContain(name);
  }
  expect(bundles.serverBundle).not.toContain("puppeteer");
  const dir = await mkdtemp(path.join(tmpdir(), "canvas-bundle-"));
  await mkdir(path.join(dir, ".paseo"));
  const bundleFile = path.join(dir, "server.js");
  await writeFile(bundleFile, bundles.serverBundle!);
  const child = fork(
    path.join(root, "tests/fixtures/bundle-runner.mjs"),
    [bundleFile],
    {
      execArgv: [],
      env: {
        ...process.env,
        HOME: dir,
        USERPROFILE: dir,
        XDG_DATA_HOME: path.join(dir, "data"),
        LOCALAPPDATA: path.join(dir, "data"),
        PASEO_HOME: path.join(dir, ".paseo"),
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let log = "";
  child.stdout!.on("data", (b) => {
    log += b;
  });
  child.stderr!.on("data", (b) => {
    log += b;
  });
  const client = new Client({ name: "bundle-test", version: "1" });
  try {
    const [message] = await once(child, "message");
    expect(message, log).toMatchObject({ type: "ready" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(message.config.url), {
        requestInit: { headers: message.config.headers },
      }),
    );
    const result = await client.callTool({
      name: "canvas.create",
      arguments: { title: "Bundle", content: "# Bundle content" },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const reply = once(child, "message");
    child.send("list");
    const [list] = await reply;
    expect(list.result.items).toHaveLength(1);
    expect(list.result.items[0].title).toBe("Bundle");
    const documentReply = once(child, "message");
    child.send("get");
    const [document] = await documentReply;
    expect(document.document.children[0]).toMatchObject({
      type: "element",
      tagName: "h1",
    });
    const graphicReply = once(child, "message");
    child.send("graphic");
    const [graphic] = await graphicReply;
    expect(graphic, JSON.stringify(graphic)).toMatchObject({
      type: "graphic",
      png: true,
    });
    expect(graphic.width).toBeGreaterThan(20);
  } finally {
    await client.close();
    const exited = once(child, "exit");
    child.send("stop");
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
