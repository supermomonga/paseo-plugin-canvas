import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkEmoji from "remark-emoji";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import GithubSlugger from "github-slugger";
import { visit, SKIP } from "unist-util-visit";
import type { VFile } from "vfile";
import type {
  Root as MdRoot,
  Blockquote,
  Paragraph,
  Text as MdText,
} from "mdast";
import type { Root, Element, RootContent } from "hast";

import { textContent } from "../shared/document";
function extensions() {
  return (tree: MdRoot, file: VFile) => {
    // GitHub alerts are top-level blockquotes, not nested alerts or list children.
    for (const node of tree.children) {
      if (node.type !== "blockquote") continue;
      const quote = node as Blockquote;
      const paragraph = quote.children[0] as Paragraph | undefined;
      const first =
        paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
      if (first?.type !== "text") continue;
      const offset = first.position?.start.offset;
      if (
        offset === undefined ||
        !String(file.value).slice(offset).startsWith("[!")
      )
        continue;
      const match =
        /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|$)/.exec(
          first.value,
        );
      if (!match) continue;
      first.value = first.value.slice(match[0].length);
      if (!first.value) paragraph!.children.shift();
      if (!paragraph!.children.length) quote.children.shift();
      quote.data = { hName: "aside", hProperties: { dataAlert: match[1] } };
    }
    visit(tree, "inlineMath", (node) => {
      if (node.value.startsWith("`") && node.value.endsWith("`"))
        node.value = node.value.slice(1, -1);
    });
    visit(tree, "html", (node, index, parent) => {
      if (!parent || index === undefined) return;
      if (/^\s*<!--/.test(node.value)) return; // rehype removes comments.
      // Only this explicit HTML subset participates in document structure.
      if (
        !/^\s*<\/?(?:details|summary|br|sub|sup)(?:\s|\/?>)/i.test(node.value)
      ) {
        parent.children[index] = { type: "text", value: node.value } as MdText;
      }
    });
  };
}
function restrictRawHtml() {
  return (tree: Root, file: VFile) => {
    const source = String(file.value);
    visit(tree, "element", (node, index, parent) => {
      const start = node.position?.start.offset,
        end = node.position?.end.offset;
      if (
        parent &&
        index !== undefined &&
        start !== undefined &&
        end !== undefined &&
        source[start] === "<" &&
        !["details", "summary", "br", "sub", "sup"].includes(node.tagName)
      ) {
        parent.children[index] = {
          type: "text",
          value: source.slice(start, end),
        };
        return SKIP;
      }
    });
  };
}
export const markdownParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath);
const processor = markdownParser()
  .use(remarkEmoji, { emoticon: false })
  .use(extensions)
  .use(remarkRehype, {
    allowDangerousHtml: true,
    footnoteLabel: "Footnotes",
    footnoteBackLabel: "Back to content",
  })
  .use(rehypeRaw)
  .use(restrictRawHtml)
  .use(rehypeSanitize, {
    ...defaultSchema,
    clobberPrefix: "",
    tagNames: [...defaultSchema.tagNames!, "aside"],
    attributes: {
      ...defaultSchema.attributes,
      aside: ["dataAlert"],
      code: [["className", /^language-/, "math-inline", "math-display"]],
      details: ["open"],
    },
  });
export function parseDocument(content: string): Root {
  const tree = processor.runSync(processor.parse(content), {
    value: content,
  }) as Root;
  const slugger = new GithubSlugger();
  visit(tree, "element", (node) => {
    if (typeof node.properties.id === "string")
      slugger.slug(node.properties.id);
  });
  visit(tree, "element", (node: Element) => {
    if (/^h[1-6]$/.test(node.tagName) && !node.properties.id) {
      node.properties.id = slugger.slug(textContent(node));
    }
  });
  function clean(node: RootContent): RootContent[] {
    if (node.type === "text") return [{ type: "text", value: node.value }];
    if (node.type !== "element") return [];
    return [
      {
        type: "element",
        tagName: node.tagName,
        properties: node.properties,
        children: node.children.flatMap(clean) as Element["children"],
      },
    ];
  }
  return { type: "root", children: tree.children.flatMap(clean) };
}
