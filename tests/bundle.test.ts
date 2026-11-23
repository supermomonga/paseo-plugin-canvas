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
test("Paseo compiler bundles both entries; every agent opening gets a launch-only Canvas MCP that shares data with panel RPC", async () => {
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
  const request = async (message: string) => {
    const reply = once(child, "message");
    child.send(message);
    return (await reply)[0];
  };
  let client = new Client({ name: "bundle-test", version: "1" });
  try {
    const [message] = await once(child, "message");
    if (message.type === "error") throw new Error(message.message);
    expect(message, log).toMatchObject({
      type: "ready",
      // The descriptor reaches the provider, but never the saved configuration.
      savedServers: ["existing"],
      historyServers: [],
      detachedServers: [],
    });
    expect(message.config).toMatchObject({ type: "http" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(message.config.url), {
        requestInit: { headers: message.config.headers },
      }),
    );
    const watching = await request("watch");
    expect(watching.events).toHaveLength(1);
    const result = await client.callTool({
      name: "canvas.create",
      arguments: { title: "Bundle", content: "# Bundle content" },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const created = JSON.parse((result.content as { text: string }[])[0].text);
    expect(created).toMatchObject({
      saved: true,
      timeline: "queued",
      warnings: [],
    });
    // The plugin kept the daemon session from the agent's opening hook, so
    // the timeline row appears while the agent is still working.
    const delivered = await request("activity");
    expect(delivered.items).toHaveLength(1);
    expect(delivered.items[0]).toMatchObject({
      type: "plugin",
      pluginId: "paseo-canvas",
      id: `canvas-${created.canvasId}-1`,
      kind: "canvas-activity",
      version: 1,
      data: {
        workspaceId: "bundle-workspace",
        canvasId: created.canvasId,
        revision: 1,
        action: "created",
      },
    });
    const watched = await request("watched");
    expect(watched.events.length).toBeGreaterThan(1);
    expect(watched.events.at(-1).cursor).not.toBe(watching.events[0].cursor);
    const list = await request("list");
    expect(list.result.items).toHaveLength(1);
    expect(list.result.items[0].title).toBe("Bundle");
    const document = await request("get");
    expect(document.document.children[0]).toMatchObject({
      type: "element",
      tagName: "h1",
    });
    const graphic = await request("graphic");
    expect(graphic, JSON.stringify(graphic)).toMatchObject({
      type: "graphic",
      png: true,
    });
    expect(graphic.width).toBeGreaterThan(20);
    // resvg runs on a worker evaluated from inside the bundle.
    expect(await request("svg")).toEqual({
      type: "svg",
      width: 120,
      height: 40,
      png: true,
    });
    let config = message.config;
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
      // The resumed opening gets a new credential at the same address; the
      // previous opening's credential no longer works.
      expect(restarted, log).toMatchObject({
        type: "ready",
        savedServers: ["existing"],
      });
      expect(restarted.config.url).toBe(config.url);
      expect(restarted.config.headers).not.toEqual(config.headers);
      expect(
        (
          await fetch(config.url, {
            method: "POST",
            headers: config.headers,
          })
        ).status,
      ).toBe(401);
      config = restarted.config;
      client = new Client({ name: "restart-test", version: "1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers },
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
      // Paseo keeps appended plugin rows in memory only: the delivered row is
      // gone after a restart, and nothing is left to deliver again.
      const activity = await request("activity");
      expect(activity.items).toEqual([]);
    }
    const locked = await client.callTool({
      name: "lock.acquire",
      arguments: { canvasId: created.canvasId },
    });
    expect(locked.isError, JSON.stringify(locked)).not.toBe(true);
    const editState = async () =>
      (await request("list")).result.items[0].editState.status;
    expect(await editState()).toBe("locked");
    expect(await request("close-agent")).toMatchObject({ type: "closed" });
    // Lifecycle events are delivered asynchronously after the runtime closes.
    await expect.poll(editState, { timeout: 5_000 }).toBe("unlocked");
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
