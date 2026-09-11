import { expect, test } from "vitest";
import { fork } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  utimes,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { dataRoot } from "../server/paths";
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
  const launch = (resume = false) =>
    fork(
      path.join(root, "tests/fixtures/bundle-runner.mjs"),
      [bundleFile, ...(resume ? ["resume"] : [])],
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
  let child = launch();
  let log = "";
  child.stdout!.on("data", (b) => {
    log += b;
  });
  child.stderr!.on("data", (b) => {
    log += b;
  });
  let client = new Client({ name: "bundle-test", version: "1" });
  try {
    const [message] = await once(child, "message");
    if (message.type === "error") throw new Error(message.message);
    expect(message, log).toMatchObject({ type: "ready" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(message.config.url), {
        requestInit: { headers: message.config.headers },
      }),
    );
    const initialWatch = once(child, "message");
    child.send({ type: "watch", cursor: null });
    const [initial] = await initialWatch;
    const changedReply = once(child, "message");
    child.send({ type: "watch", cursor: initial.cursor });
    const result = await client.callTool({
      name: "canvas.create",
      arguments: { title: "Bundle", content: "# Bundle content" },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const created = JSON.parse((result.content as { text: string }[])[0].text);
    expect(created).toMatchObject({
      saved: true,
      timeline: "queued",
      diagnostics: [],
    });
    const [changed] = await changedReply;
    expect(changed.type).toBe("changed");
    expect(changed.cursor).not.toBe(initial.cursor);
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
    const originalConfig = message.config;
    for (const crash of [false, true]) {
      await client.close();
      const stopped = once(child, "exit");
      if (crash) child.kill("SIGKILL");
      else child.send("stop");
      await stopped;
      if (crash) {
        const hostKey = createHash("sha256")
          .update(await realpath(path.join(dir, ".paseo")))
          .digest("hex");
        const saved = path.join(
          dataRoot(
            process.platform,
            {
              ...process.env,
              XDG_DATA_HOME: path.join(dir, "data"),
              LOCALAPPDATA: path.join(dir, "data"),
            },
            dir,
          ),
          "hosts",
          hostKey,
        );
        await utimes(`${saved}.lock`, new Date(0), new Date(0));
      }
      child = launch(true);
      child.stderr!.on("data", (buffer) => {
        log += buffer;
      });
      const [restarted] = await once(child, "message");
      if (restarted.type === "error") throw new Error(restarted.message);
      expect(restarted, log).toMatchObject({
        type: "ready",
        config: originalConfig,
      });
      client = new Client({ name: "restart-test", version: "1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(originalConfig.url), {
          requestInit: { headers: originalConfig.headers },
        }),
      );
      const listing = await client.callTool({
        name: "canvas.list",
        arguments: {},
      });
      expect(listing.isError).not.toBe(true);
      const items = JSON.parse(
        (listing.content as { text: string }[])[0].text,
      ).items;
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe("Bundle");
      const activityReply = once(child, "message");
      child.send("sync-activity");
      const [activity] = await activityReply;
      expect(activity.type).toBe("activity");
      // Stock 0.8.0 does not wire a durable store for appended plugin rows.
      // Pending plugin notifications survive restart; already delivered rows
      // are owned by Paseo and disappear when its in-memory timeline is lost.
      if (crash) {
        expect(activity.items).toEqual([]);
        continue;
      }
      expect(activity.items).toHaveLength(1);
      expect(activity.items[0]).toMatchObject({
        type: "plugin",
        pluginId: "paseo-canvas",
        kind: "canvas-activity",
        version: 1,
        data: {
          workspaceId: "bundle-workspace",
          canvasId: created.canvasId,
          revision: 1,
          action: "created",
        },
      });
    }
  } finally {
    await client.close();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.send("stop");
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
