Canvas keeps shared Markdown documents in a Paseo workspace. You and the workspace's agents can create, read and edit the same canvases, comment on parts of a document, and send those comments to an agent for another pass.

## How it works

Canvas gives every agent session that opens in a workspace a set of Canvas tools through MCP, including agents created before the plugin was installed. Agents read and write canvases with these tools; only one user or agent edits a canvas at a time, under a five-minute lock that renews while editing.

In Paseo, open Canvas from a workspace's new-tab menu, from the Command Center with **Open Canvas**, or by typing `/canvas` or `/canvas <title>` in the composer. The sidebar's **Canvas** item lists recently updated canvases across the host's workspaces and opens one as a full page. Changes from other sessions appear automatically.

## Setup

Requires Paseo 0.17.1 or later on both the daemon host and the app. Agents need a provider that accepts MCP servers; all built-in Paseo providers do. A Git installation also needs Node.js 22.22 or later and npm 11 on the host to build the rendering assets.

## What you can do

- Write and preview GitHub-flavored Markdown with tables, task lists, alerts, footnotes, images, SVG, TeX formulas and Mermaid diagrams. Paseo's own Mermaid renderer draws every diagram, with zoom and a full-screen view.
- Select paragraphs, tables, diagrams or several blocks, leave comments, and send selected comments to any agent session in the workspace. Agents can reply in the discussion; you resolve it.
- Attach a canvas to a prompt from the composer's attachment menu. The prompt carries a snapshot of the canvas text at that moment.
- Get a timeline row with an **Open canvas** button when an agent creates or updates a canvas.
- Use the interface in English or Japanese, following the app's language.

## Settings

- **Canvas notifications** (host): adds the timeline row on agent saves. On by default.
- **Open web links in** (each device): opens document links in the desktop app's workspace browser, or in the system browser.

## Data and limits

Canvases and comments are stored on the daemon host outside your projects, separated by Paseo home and workspace, and survive restarts. Canvas content reaches an agent's provider when the agent reads a canvas, when you send comments, or when you attach a canvas to a prompt. Workspace images are read from the workspace directory; external images load from their original hosts on the viewing device. Timeline rows are kept by Paseo in memory and disappear after the daemon restarts; the canvases remain. Agents created by Canvas 0.3 or earlier keep their saved Canvas connection.
