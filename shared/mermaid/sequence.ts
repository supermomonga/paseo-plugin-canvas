// Adapted from dutchakdev/paseo-plugin-mermaid, commit 8e983c8108521da23ae05070f896a0057f0982f3.
// MIT; see third-party/paseo-plugin-mermaid/LICENSE.
/**
 * Mermaid `sequenceDiagram` subset. Same rules as the flowchart parser: pure,
 * synchronous, and honest about the lines it does not interpret.
 */

export type MessageStyle = "solid" | "dashed";
export type ArrowHead = "none" | "open" | "filled" | "async";

export interface SeqParticipant {
  id: string;
  label: string;
  actor: boolean;
}

export type SeqEvent =
  | {
      kind: "message";
      from: string;
      to: string;
      text: string;
      style: MessageStyle;
      arrow: ArrowHead;
    }
  | {
      kind: "note";
      over: string[];
      placement: "over" | "left" | "right";
      text: string;
    };

export interface SequenceDiagram {
  participants: SeqParticipant[];
  events: SeqEvent[];
  skipped: string[];
}

const HEADER = /^\s*sequenceDiagram\s*$/i;
const PARTICIPANT = /^(participant|actor)\s+([\w.-]+)(?:\s+as\s+(.+))?$/i;
const NOTE =
  /^note\s+(?:(over)\s+([\w.,\s-]+)|(?:left|right)\s+of\s+([\w.-]+))\s*:\s*(.*)$/i;

/** Longest first so `-->>` is never read as `-->`. */
const ARROWS: { token: string; style: MessageStyle; arrow: ArrowHead }[] = [
  { token: "--)", style: "dashed", arrow: "async" },
  { token: "-->>", style: "dashed", arrow: "filled" },
  { token: "--x", style: "dashed", arrow: "open" },
  { token: "-->", style: "dashed", arrow: "none" },
  { token: "->>", style: "solid", arrow: "filled" },
  { token: "-)", style: "solid", arrow: "async" },
  { token: "-x", style: "solid", arrow: "open" },
  { token: "->", style: "solid", arrow: "none" },
];

/** Blocks whose contents still render; only the framing is dropped for now. */
const BLOCK =
  /^(loop|alt|else|opt|par|and|critical|rect|break|end|activate|deactivate|autonumber)\b/i;

export function parseSequence(source: string): SequenceDiagram | null {
  const lines = source.split("\n");
  if (!lines.some((line) => HEADER.test(line))) return null;

  const participants = new Map<string, SeqParticipant>();
  const events: SeqEvent[] = [];
  const skipped: string[] = [];
  let started = false;

  const mention = (id: string) => {
    if (!participants.has(id))
      participants.set(id, { id, label: id, actor: false });
  };

  for (const original of lines) {
    if (/^\s*%%/.test(original)) continue;
    const line = original.trim();
    if (line.length === 0) continue;
    if (HEADER.test(line)) {
      started = true;
      continue;
    }
    if (!started) continue;

    const declared = PARTICIPANT.exec(line);
    if (declared) {
      participants.set(declared[2], {
        id: declared[2],
        label: (declared[3] ?? declared[2]).trim(),
        actor: declared[1].toLowerCase() === "actor",
      });
      continue;
    }

    const note = NOTE.exec(line);
    if (note) {
      const over = (note[2] ?? note[3] ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      for (const name of over) mention(name);
      events.push({
        kind: "note",
        over,
        placement: /^note\s+left/i.test(line)
          ? "left"
          : /^note\s+right/i.test(line)
            ? "right"
            : "over",
        text: note[4].trim(),
      });
      continue;
    }

    if (BLOCK.test(line)) {
      skipped.push(original.trim());
      continue;
    }

    const colon = line.indexOf(":");
    const head = colon >= 0 ? line.slice(0, colon) : line;
    const arrow = ARROWS.find((candidate) => head.includes(candidate.token));
    if (!arrow || colon < 0) {
      skipped.push(original.trim());
      continue;
    }

    const at = head.indexOf(arrow.token);
    const from = head.slice(0, at).trim();
    const to = head.slice(at + arrow.token.length).trim();
    if (!/^[\w.-]+$/.test(from) || !/^[\w.-]+$/.test(to)) {
      skipped.push(original.trim());
      continue;
    }

    // Order of first appearance is the column order Mermaid uses.
    mention(from);
    mention(to);
    events.push({
      kind: "message",
      from,
      to,
      text: line.slice(colon + 1).trim(),
      style: arrow.style,
      arrow: arrow.arrow,
    });
  }

  return { participants: [...participants.values()], events, skipped };
}
