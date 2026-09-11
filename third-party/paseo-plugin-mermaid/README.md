# paseo-plugin-mermaid

Source: https://github.com/dutchakdev/paseo-plugin-mermaid
Commit: `8e983c8108521da23ae05070f896a0057f0982f3`
License: MIT (see LICENSE).

Vendored portions: shared/{flowchart,sequence,layout}.ts, drawing functions from
client/diagram.tsx, and the three corresponding parser/layout tests.
The upstream entry point, timeline integration and Markdown renderer are not included.

Canvas adaptations: import paths, exported drawing functions, CJK label sizing,
line/arrow rendering, complete label bounds, cycle/self-edge routing, comment
preservation, unsupported shape detection and sequence note/self-message layout.
Unused upstream fit helpers were removed. Canvas owns its
input validation, unsupported-syntax reporting and pan/zoom UI.

## File attribution

Each adapted source and test file includes the original `Copyright (c) 2026 dutchakdev`
notice, the full MIT license text, an `SPDX-License-Identifier: MIT` identifier,
and a link to its upstream source at the pinned commit above.

| Local file | Upstream file |
| --- | --- |
| [`shared/mermaid/flowchart.ts`](../../shared/mermaid/flowchart.ts) | [`shared/flowchart.ts`](https://github.com/dutchakdev/paseo-plugin-mermaid/blob/8e983c8108521da23ae05070f896a0057f0982f3/shared/flowchart.ts) |
| [`shared/mermaid/sequence.ts`](../../shared/mermaid/sequence.ts) | [`shared/sequence.ts`](https://github.com/dutchakdev/paseo-plugin-mermaid/blob/8e983c8108521da23ae05070f896a0057f0982f3/shared/sequence.ts) |
| [`shared/mermaid/layout.ts`](../../shared/mermaid/layout.ts) | [`shared/layout.ts`](https://github.com/dutchakdev/paseo-plugin-mermaid/blob/8e983c8108521da23ae05070f896a0057f0982f3/shared/layout.ts) |
| [`client/mermaid/drawing.tsx`](../../client/mermaid/drawing.tsx) | [`client/diagram.tsx`](https://github.com/dutchakdev/paseo-plugin-mermaid/blob/8e983c8108521da23ae05070f896a0057f0982f3/client/diagram.tsx) |
| [`tests/mermaid/flowchart.test.ts`](../../tests/mermaid/flowchart.test.ts) | [`tests/flowchart.test.ts`](https://github.com/dutchakdev/paseo-plugin-mermaid/blob/8e983c8108521da23ae05070f896a0057f0982f3/tests/flowchart.test.ts) |
| [`tests/mermaid/sequence.test.ts`](../../tests/mermaid/sequence.test.ts) | [`tests/sequence.test.ts`](https://github.com/dutchakdev/paseo-plugin-mermaid/blob/8e983c8108521da23ae05070f896a0057f0982f3/tests/sequence.test.ts) |
| [`tests/mermaid/layout.test.ts`](../../tests/mermaid/layout.test.ts) | [`tests/layout.test.ts`](https://github.com/dutchakdev/paseo-plugin-mermaid/blob/8e983c8108521da23ae05070f896a0057f0982f3/tests/layout.test.ts) |
