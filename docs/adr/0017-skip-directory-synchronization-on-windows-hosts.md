---
number: 17
title: Skip directory synchronization on Windows hosts
status: accepted
date: 2026-11-23
links:
- target: 2
  kind: amends
---

# Skip directory synchronization on Windows hosts

## Context and Problem Statement

ADR 2 makes a write successful only after temporary-file creation, file synchronization, atomic replacement and directory synchronization, and stops the store when a commit cannot be confirmed. The canvas store, review storage, MCP registry (`mcp.json`) and timeline notification queue all synchronize the parent directory by opening it and calling `sync()` on the handle.

[Issue #6](https://github.com/supermomonga/paseo-plugin-canvas/issues/6) reports that this cannot work on Windows. Node opens a directory there, but `sync()` on the handle fails with `EPERM: operation not permitted, fsync`; file handles synchronize normally. Plugin initialization fails, and every agent creation then fails in `before agent.create`. The README already said that Windows environments without directory synchronization cannot use this storage, and Node offers it on no Windows environment, so the plugin was unusable on Windows.

## Decision Drivers

* Canvas must start and create agents on Windows hosts.
* Keep ADR 2's guarantees unchanged on macOS and Linux, including stopping the store when a directory synchronization fails.
* State any weaker Windows guarantee instead of reporting a guarantee the host cannot provide.
* Keep the npm package free of per-platform native builds (ADR 14).

## Considered Options

* Skip directory synchronization on `win32` through one shared helper.
* Ignore `EPERM` and `EISDIR` from directory synchronization on every platform.
* Keep requiring directory synchronization and leave Windows unsupported.
* Synchronize the rename with a Windows API that Node does not expose, through a native addon.

## Decision Outcome

Chosen option: "Skip directory synchronization on `win32` through one shared helper", because it is the only option that makes Windows usable while leaving macOS and Linux behavior unchanged and adding no native code.

`syncDirectory` in `server/durability.ts` returns without opening the directory when `process.platform` is `win32`; elsewhere it opens and synchronizes the directory as before, and errors still propagate. Every directory synchronization goes through this helper so the sites cannot drift apart. File synchronization before the rename is unchanged on every platform.

On Windows a write is therefore successful after the temporary file is synchronized and atomically renamed. NTFS journals the rename, so a crash leaves either the previous or the new file, and the new file's contents are already on disk. The journal entry may not be on disk yet when the rename returns.

### Consequences

* Good, because Canvas starts and agents are created on Windows.
* Good, because macOS and Linux keep ADR 2's commit contract, and a failing directory synchronization there still stops the store.
* Bad, because on Windows a power loss or OS crash shortly after a save can revert a canvas, review state, MCP registry or notification queue to its previous version even though the operation reported success. A reverted registry can restore the credential of an agent archived just before the crash.
* Bad, because the guarantee now depends on the host OS and must be documented per platform.

### Confirmation

`tests/durability.test.ts` simulates Node on Windows by making directory handles fail `sync()` with `EPERM` while file handles synchronize normally. With `process.platform` set to `win32` it runs plugin initialization, agent registration, canvas create/update/delete, a review comment and notification delivery. On the real platform the same simulation must still fail. Removing the `win32` branch reproduces the error from issue #6.

The issue reporter confirmed on Windows 11 with Paseo 0.13.2 and Node 22.23.4 that skipping the directory synchronization lets agents be created and canvases work. Crash durability on Windows has not been tested.

## Pros and Cons of the Options

### Skip directory synchronization on `win32` through one shared helper

* Good, because the platform rule is explicit and every write path uses it.
* Good, because the directory is not opened on Windows, so no error is produced and then discarded.
* Bad, because the last commit on Windows may be lost on a crash (see Consequences).

### Ignore `EPERM` and `EISDIR` from directory synchronization on every platform

* Good, because it would also cover other hosts that reject directory synchronization.
* Bad, because the same error codes would silently weaken durability on macOS and Linux, where ADR 2 treats them as an unconfirmed commit.
* Bad, because the Windows outcome depends on which error code libuv reports.

### Keep requiring directory synchronization and leave Windows unsupported

* Good, because the documented commit contract stays identical on every host.
* Bad, because Canvas cannot be used on Windows, and agent creation fails while the plugin is enabled.

### Synchronize the rename with a Windows API through a native addon

Write-through renames (`MoveFileEx` with `MOVEFILE_WRITE_THROUGH`) or flushing a directory handle opened for writing are not available through Node's `fs` API.

* Good, because it could restore a confirmed commit on Windows.
* Bad, because the npm-distributed plugin would need a per-platform native build (ADR 14).
* Bad, because its effect on NTFS durability was not verified for this decision.

## More Information

See the [shared helper](../../server/durability.ts), [canvas storage](../../server/store.ts), [review storage](../../server/reviews.ts), [MCP registry](../../server/sessions.ts) and [notification queue](../../server/activity.ts). Revisit if Node exposes directory or write-through rename synchronization on Windows, or if Windows crash testing shows lost commits that matter to users.
