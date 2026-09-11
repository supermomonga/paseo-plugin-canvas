---
number: 7
title: Refresh canvases through workspace-scoped long polling
status: accepted
date: 2026-09-11
links:
- target: 2
  kind: relatesto
---

# Refresh canvases through workspace-scoped long polling

## Context and Problem Statement

Canvas changes are primarily produced by MCP calls from other sessions. Manual refresh buttons make shared plans and lock state stale unless the reader notices and reloads. The user requested automatic, event-driven updates. The targeted public plugin SDK has ordinary RPC but no plugin-specific push-event API; the client must also work through the existing Paseo connection on mobile.

## Decision Drivers

* Reflect committed content and lock changes automatically.
* Avoid fetching unchanged documents repeatedly.
* Use the existing authenticated Paseo RPC route across desktop and mobile.
* Recover from disconnects, missed waits and plugin restarts without displaying permanently stale data.

## Considered Options

* Keep manual reload buttons.
* Periodically refetch complete list/detail data.
* Wait for workspace changes through existing plugin RPC.
* Add a plugin-specific push API to Paseo.

## Decision Outcome

Chosen option: "Wait for workspace changes through existing plugin RPC", because it delivers event-driven invalidation without a new host API or client HTTP endpoint.

Remove reload buttons from both list and detail views. Use `canvas.wait_for_change` with an opaque, workspace-scoped cursor. When the cursor matches, hold the response until a committed mutation or lock change occurs. Finish idle waits after 20 seconds, before the targeted host's 30-second RPC timeout, and start another wait. An unchanged cursor does not trigger list/detail refetching.

Publish after successful create/update/delete, lock acquisition/renewal/release, and expiry. Use a separate change counter because document revision does not change for lock-only operations. Include a per-process epoch in the cursor so restart cannot appear identical to a previous state. An older cursor gets an immediate response, covering changes between successive waits. Notifications contain neither document bodies nor lock secrets.

On a changed cursor, invalidate workspace query data, refresh the list and then the selected surviving detail; also invalidate hidden detail caches. Retain clear loading/error/deleted states. Retry connection failures with bounded backoff, pause new waits while the app is backgrounded, and refresh on return. The public RPC has no cancellation operation: allow an outstanding wait to expire and ignore late responses after the view leaves.

### Consequences

* Good, because readers see other agents' committed work and lock changes without manual refresh.
* Good, because idle workspaces do not repeatedly transfer full documents.
* Good, because remote/mobile clients reuse Paseo routing and authentication.
* Bad, because an active watcher keeps an RPC outstanding and renews it on timeout even without changes.
* Bad, because unmounted views can leave a bounded in-flight wait until timeout.
* Bad, because this is invalidation and refetching, not delivery of a durable event log or every intermediate state.

### Confirmation

`tests/changes.test.ts` covers cursor changes, workspace separation, idle waits and shutdown. `tests/updates.test.tsx` covers invalidation, reconnection/background behavior and late responses. The compiled bundle integration test verifies a real MCP write wakes the waiting RPC and makes the updated data readable.

## Pros and Cons of the Options

### Existing-RPC long polling

* Good, because server-side events drive responses within a supported cross-platform transport.
* Bad, because it retains timeout and outstanding-request overhead.

### Manual reload

* Good, because it requires no notification path.
* Bad, because readers must notice remote changes themselves and it fails the requested UX.

### Periodic full refetch

* Good, because it can recover state without a server-side wait mechanism.
* Bad, because it fetches unchanged content and responsiveness depends on a fixed interval.

### New Paseo push API

* Good, because it could provide a dedicated event subscription path.
* Bad, because it is not part of the targeted public SDK and would add a host-change prerequisite.

## More Information

See [change coordinator](../../server/changes.ts), [store notifications](../../server/store.ts), [RPC contracts](../../shared/contracts.ts) and [UI update behavior](../ui.md#canvasの自動更新). Revisit the transport if a released plugin subscription API provides equivalent workspace scoping and restart/reconnect guarantees; preserve those guarantees regardless of transport.
