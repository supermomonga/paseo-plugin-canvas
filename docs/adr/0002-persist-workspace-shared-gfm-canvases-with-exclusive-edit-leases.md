---
number: 2
title: Persist workspace-shared GFM canvases with exclusive edit leases
status: accepted
date: 2026-09-11
links:
- target: 3
  kind: relatesto
- target: 4
  kind: relatesto
- target: 7
  kind: relatesto
---

# Persist workspace-shared GFM canvases with exclusive edit leases

## Context and Problem Statement

Agents in different Paseo sessions need to share plans and notes within a workspace. A canvas is a separate working document, not a project artifact to commit. The user clarified that avoiding filesystem writes means avoiding files inside the project; content must survive Paseo and OS restarts. More than one canvas must exist per workspace, and concurrent agents must not overwrite each other's edits.

## Decision Drivers

* Share documents by Paseo workspace identity rather than by agent session or working-directory text.
* Preserve content across restarts without changing the project tree.
* Make editing ownership visible and reject conflicting writes.
* Keep the first version focused on GFM and agent-driven editing.

## Considered Options

* Markdown and standalone HTML canvases, as initially requested.
* GFM-only canvases persisted outside the project.
* Memory-only content, based on a literal reading of the initial no-filesystem requirement.
* Project-local document files.

## Decision Outcome

Chosen option: "GFM-only canvases persisted outside the project", because it satisfies the clarified durability and project-isolation requirements with one document format.

Store multiple UTF-8 Markdown documents per workspace with YAML frontmatter for identity, revision, timestamps and attribution. API responses and code views expose the original document body without the management frontmatter. Partition the plugin's platform-specific data directory by the hash of the canonical `PASEO_HOME`, then by workspace ID and canvas ID. The user-facing panel is read-only; agents create, edit and delete through MCP.

Use an exclusive, renewable five-minute edit lease and a secret lock token, together with `expectedRevision` on update and delete. The authenticated actor determines ownership; tool arguments cannot impersonate another editor. Reads remain available during editing. Do not merge automatically or overwrite on a revision mismatch. Lock metadata is visible, while the secret token is not returned by list/get operations. Document revisions track content changes rather than lock changes.

Serialize document mutations and use a `proper-lockfile` lease to give one plugin process ownership of the storage area. A successful write requires temporary-file creation, file synchronization, atomic replacement and directory synchronization. Reject corrupt documents and stop serving an uncertain storage state after loss of ownership or an unconfirmed durable commit. Content survives restarts and workspace archival; edit leases remain in memory and expire on restart.

### Consequences

* Good, because agents share durable documents without polluting the project or its Git history.
* Good, because lease ownership and revision checks expose conflicts instead of losing changes silently.
* Bad, because authors must acquire and renew leases, and a disconnected editor can block writes until expiry.
* Bad, because external editors, network filesystems and simultaneous independent writers are outside the storage contract.
* Bad, because moving `PASEO_HOME` requires explicit data migration; the host key is path-derived.

### Confirmation

`tests/store.test.ts`, `tests/recovery.test.ts` and `tests/mcp.test.ts` exercise revisions, exclusive ownership, expiry, workspace separation and crash recovery. Storage behavior has been checked on macOS. Linux/Windows durability, especially support for directory synchronization, must be validated before claiming those hosts are supported. An OS restart is a design requirement, not evidence that every platform has been tested.

## Pros and Cons of the Options

### GFM-only canvases persisted outside the project

* Good, because readable documents and metadata survive application restarts.
* Bad, because the plugin owns durable-write and concurrency semantics; helper storage utilities alone do not establish them.

### Markdown and standalone HTML canvases

* Good, because HTML allows richer presentation.
* Bad, because it adds a second document/rendering contract that the user explicitly removed from scope.

### Memory-only content

* Good, because no durable storage format is needed.
* Bad, because plans disappear on restart and fail the clarified requirement.

### Project-local document files

* Good, because ordinary project tooling can read them directly.
* Bad, because they violate the explicit requirement to keep canvas files outside the project.

## More Information

See [storage implementation](../../server/store.ts), [storage paths](../../server/paths.ts), [document format](../../server/format.ts) and [operational details](../../README.md#保存). Revisit this decision if collaborative user editing, external-editor synchronization or a distributed storage backend becomes a requirement.
