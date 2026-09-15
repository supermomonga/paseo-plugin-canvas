---
number: 13
title: Allow user canvas editing with shared leases and explicit save completion
status: accepted
date: 2026-09-15
links:
- target: 2
  kind: amends
---

# Allow user canvas editing with shared leases and explicit save completion

## Context and Problem Statement

Canvas content was writable only through agent MCP tools. Users need to create, edit and delete Markdown themselves without racing agents or other clients. Existing metadata assumes every author and lock owner is an agent, while MCP updates retain a lease until explicitly released.

## Decision Drivers

* Use the same exclusion and revision checks for users and agents.
* Save new documents only when both title and content are submitted.
* Keep unsaved text through responsive layout changes and recoverable errors.
* Avoid production migration logic and synthetic agent identities.

## Considered Options

* Typed user RPCs over the existing serialized store and renewable leases.
* A separate user storage/locking path.
* User editing through a synthetic MCP agent.

## Decision Outcome

Choose typed user RPCs over the existing store. Public metadata schemaVersion 2 records `updatedBy` as either `{ role: "user" }` or `{ role: "agent", agentId }`. Public locks similarly expose `owner` and optional `ownerTitle`. Individual human accounts are not inferred: the trusted plugin RPC context exposes no end-user identity. Each user edit receives its own server-issued session and secret lock token; tokens never appear in list/get responses. User endpoints cannot use an agent's lease token.

The same per-document queue serializes MCP and UI operations. Beginning a user edit returns a snapshot obtained while acquiring its five-minute lease. Active editors renew every minute. Saving validates the current lease and expected revision, persists exactly one new revision, then releases the lease inside that same queue. MCP retains its explicit release operation. User deletion checks for an unlocked document and the expected revision while reserving the queue through deletion of the document and reviews.

New user documents require a title and nonblank body and are persisted as revision 1 only on Save. No-op edits cannot be saved from the UI. Cancelling or navigating away confirms dirty drafts and releases the lease without saving. Layout and preview changes keep the draft. Lease loss pauses saving; explicit reacquisition preserves text only when the stored revision still matches. A changed revision requires reviewing the latest document, without automatic merging or overwriting. Uncertain save responses retain text and disable resubmission; reads may refresh but mutations are not automatically retried.

Clients render one React Native editor with the host's public components. Unmount attempts to release the lease; disconnects and crashes rely on the existing expiry. Drafts are memory-only. User saves do not append a notification to an unrelated agent timeline. Existing review source tracking remains authoritative; no full revision history or restore UI is introduced.

Existing schemaVersion 1 documents are converted once as an operator task with the plugin stopped and storage backed up. Only the document metadata changes; bodies, IDs, timestamps, revisions and review artifacts remain intact. Production code accepts only version 2, and includes neither migration code nor old-format compatibility branches.

### Consequences

* Good, because every writer shares one conflict and durability contract.
* Good, because user ownership is explicit without pretending to identify individual humans.
* Good, because a successful UI save cannot leave its lease held by a later failed release request.
* Bad, because disconnected edits can hold a lease until expiry and local drafts do not survive app termination.
* Bad, because upgrades from the old schema require a deliberate operator conversion before the new plugin reads existing data.

### Confirmation

Store/controller and registered-RPC tests cover exclusion, identity separation, fresh snapshots, revision checks, lease renewal/expiry, ambiguous save results, delayed acquisition cleanup, deletion and review tracking. Component tests cover the shared editor on web/iOS/Android configurations and draft retention across preview and layout changes. Browser fixture checks establish rendered desktop/compact behavior; mocked native tests do not establish physical-device keyboard behavior.

## Pros and Cons of the Options

### Typed RPCs over the existing store

* Good, because durability and locking have one implementation.
* Bad, because UI lifecycle and uncertain network results require explicit handling.

### Separate user storage and locks

* Bad, because users and agents could both acquire apparently exclusive access.

### Synthetic MCP agent

* Bad, because it misattributes human changes and couples document editing to agent sessions.

## More Information

This amends the agent-only UI and attribution portions of ADR 2. Revisit if Paseo provides authenticated human identities, durable drafts or a panel-close veto API, or if full revision history becomes a requirement.
