---
number: 3
title: Register Canvas MCP through released Paseo creation hooks
status: accepted
date: 2026-09-11
links:
- target: 2
  kind: relatesto
---

# Register Canvas MCP through released Paseo creation hooks

## Context and Problem Statement

Canvas needs agent-accessible tools scoped to the actual Paseo agent and workspace. Tools should be registered when Paseo creates an agent, without changing the agent product's global or project MCP configuration. Custom providers must receive the same configuration. The first implementation incorrectly depended on an unreleased `agent.session_open.mcpServers` extension and failed on released Paseo.

Investigation and executable probes established that released Paseo 0.8.0 already permits `agent.create` to modify `config.mcpServers`. That hook lacks the final agent/workspace identity, while `agent.session_open` exposes identity and a mutable launch environment. The user accepted limiting registration to agents created after plugin installation and their subsequent resumes; pre-existing agents and direct imports need no retrofit.

## Decision Drivers

* Work on released, unmodified Paseo rather than require users to patch the host.
* Derive tool authorization and edit ownership from host-provided identity.
* Keep persisted Paseo agent configurations usable after plugin/daemon restart.
* Preserve existing MCP entries and make custom-provider responsibilities explicit.

## Considered Options

* Extend Paseo core with mutable MCP configuration in `agent.session_open`.
* Register through public `agent.create`, then bind identity in public `agent.session_open`.
* Register Canvas in global or project-level agent MCP settings.

## Decision Outcome

Chosen option: "Register through public agent.create, then bind identity in public agent.session_open", because the released API supports the accepted new-agent scope without a core patch.

In `agent.create`, preserve existing MCP entries and add `paseo-canvas` with a loopback HTTP URL and a per-agent bearer token. Reject collisions with the reserved MCP/environment names. Pass a temporary registration token through the creation environment; bind it to the authoritative agent/workspace in the first interactive `agent.session_open`, then remove that environment entry before launching the provider. An unbound token cannot access Canvas. Reopening a registered interactive agent activates its binding and assigns a new edit-session ID. An unregistered existing agent receives no retrofit. Reject attempts to rebind a credential to another agent or workspace.

Persist the first allocated loopback port and credential hashes/bindings in `mcp.json` under the exclusively owned plugin data directory. The raw bearer token is persisted in Paseo's per-agent MCP configuration; the plugin registry stores its SHA-256 hash. Synchronize registry writes before success and refuse operations if authorization persistence fails. Reuse the saved port on restart; a port conflict is an initialization error, not a reason to silently choose a different URL.

Archive events disable the binding durably. Plugin reload preserves active bindings for already-running agents. History-only openings do not issue or reactivate credentials, although the saved MCP descriptor may still reach the provider's history session. Reject unauthorized and browser-Origin requests. Do not promise isolation from arbitrary code running as the same OS user, which can copy the persisted credentials.

Custom providers receive the descriptor through `session.open.config.mcpServers`; consuming and forwarding its URL and headers is the provider's responsibility. Remove the core patch and its installation dependency.

### Consequences

* Good, because newly created agents use Canvas on unmodified Paseo 0.8.0 and retain their connection configuration across restarts.
* Good, because normal external agent launches receive no global/project MCP registration.
* Bad, because pre-existing agents and direct imports require a new Paseo agent to use Canvas.
* Bad, because a saved-port collision requires resolving the conflict; changing ports would strand persisted descriptors.
* Bad, because disabling/removing the plugin leaves descriptors in existing Paseo agent records. They are unavailable until the plugin returns, or the user creates an agent without the plugin enabled.
* Bad, because secrets are present in Paseo's agent storage and a custom provider can ignore the descriptor.

### Confirmation

Use the unmodified release's compiler, hook schemas, `AgentManager` and provider adapter in integration tests. Never synthesize a nonexistent hook field and treat that fixture as proof of host compatibility. `tests/bundle.test.ts` and its runner cover registration, stored-agent resume and normal/forced process restart through a custom provider fixture that actually connects to MCP. `tests/sessions.test.ts` covers persistent bindings, revocation, rebinding rejection, port conflicts and persistence failures.

The implementation session also exercised the production bundle through unmodified Paseo 0.8.0 and real Codex 0.154.0: both agents discovered eight tools; HTTP operations demonstrated sharing and lock conflicts; plugin restart preserved access; a separate Codex launch using the same isolated home had no Canvas MCP registration. No LLM prompt was submitted. This does not prove Claude/OpenCode runtime behavior, external native resume of the same conversation, or installation in the user's running Paseo app; those remain unverified.

## Pros and Cons of the Options

### Public creation registration and launch-time identity binding

* Good, because it uses a released contract and the user-approved scope.
* Bad, because connection/authentication information must remain stable outside the plugin process lifetime.

### Core session-open MCP extension

* Good, because a host change could supply mutable MCP settings and final identity together, including more lifecycle paths.
* Bad, because that extension was not released or present in main; it cannot be a prerequisite for this plugin. The removed patch is not an adopted architecture.

### Global or project MCP registration

* Good, because agent products can discover it independently of Paseo hooks.
* Bad, because discovery outside Paseo contradicts the user's isolation requirement.

## More Information

See [entry hooks](../../index.server.ts), [credential registry](../../server/sessions.ts), [HTTP MCP](../../server/mcp.ts), [release example](https://github.com/getpaseo/paseo/blob/v0.8.0/plugin-examples/agent-configuration/index.server.ts) and [operational limits](../../README.md#mcp-connection-and-access). Revisit if a released public API adds runtime-only MCP injection or supported configuration updates for existing agents; do not restore a private patch dependency.
