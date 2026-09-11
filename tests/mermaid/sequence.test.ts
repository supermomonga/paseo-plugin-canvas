// Adapted from dutchakdev/paseo-plugin-mermaid, commit 8e983c8108521da23ae05070f896a0057f0982f3.
// MIT; see third-party/paseo-plugin-mermaid/LICENSE.
import { describe, expect, it } from "vitest";
import { parseSequence } from "../../shared/mermaid/sequence";

const DIAGRAM = `sequenceDiagram
    participant U as User
    actor S as Server
    U->>S: GET /health
    S-->>U: 200 OK
    Note over U,S: handshake done
    loop every minute
      U-)S: ping
    end`;

describe("parseSequence", () => {
  it("returns null when the source is a flowchart", () => {
    expect(parseSequence("flowchart TD\n A --> B")).toBeNull();
  });

  it("uses the declared label and remembers who is an actor", () => {
    const diagram = parseSequence(DIAGRAM);
    expect(diagram?.participants[0]).toMatchObject({
      id: "U",
      label: "User",
      actor: false,
    });
    expect(diagram?.participants[1]).toMatchObject({
      id: "S",
      label: "Server",
      actor: true,
    });
  });

  it("reads solid and dashed arrows apart", () => {
    const messages = parseSequence(DIAGRAM)?.events.filter(
      (event) => event.kind === "message",
    );
    expect(messages?.[0]).toMatchObject({
      from: "U",
      to: "S",
      style: "solid",
      text: "GET /health",
    });
    expect(messages?.[1]).toMatchObject({ style: "dashed", text: "200 OK" });
  });

  it("never reads -->> as --> plus a stray angle bracket", () => {
    const diagram = parseSequence("sequenceDiagram\n A-->>B: reply");
    expect(diagram?.events[0]).toMatchObject({
      style: "dashed",
      arrow: "filled",
    });
  });

  it("reads an async arrow", () => {
    const messages = parseSequence(DIAGRAM)?.events.filter(
      (event) => event.kind === "message",
    );
    expect(
      messages?.some(
        (message) => message.kind === "message" && message.arrow === "async",
      ),
    ).toBe(true);
  });

  it("keeps notes with the participants they span", () => {
    const note = parseSequence(DIAGRAM)?.events.find(
      (event) => event.kind === "note",
    );
    expect(note).toMatchObject({ over: ["U", "S"], text: "handshake done" });
  });

  it("keeps messages inside a loop and reports the framing as skipped", () => {
    const diagram = parseSequence(DIAGRAM);
    expect(
      diagram?.events.filter((event) => event.kind === "message"),
    ).toHaveLength(3);
    expect(diagram?.skipped).toContain("loop every minute");
  });

  it("registers a participant that only appears in a message", () => {
    const diagram = parseSequence("sequenceDiagram\n A->>B: hi");
    expect(diagram?.participants.map((participant) => participant.id)).toEqual([
      "A",
      "B",
    ]);
  });

  it("orders columns by first appearance", () => {
    const diagram = parseSequence("sequenceDiagram\n C->>A: x\n B->>A: y");
    expect(diagram?.participants.map((participant) => participant.id)).toEqual([
      "C",
      "A",
      "B",
    ]);
  });
});
