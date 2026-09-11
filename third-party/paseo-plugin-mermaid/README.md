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
