import type { DocNode, DocNodeAttrs, DocNodeType } from "./types.js";

export interface TextSegment {
  text: string;
  nodeType: DocNodeType;
  attrs: DocNodeAttrs;
  /** Ancestor heading texts at the time this segment was emitted. */
  breadcrumb: string[];
}

/**
 * Depth-first walk of a DocNode tree collecting leaf text segments.
 * Maintains a breadcrumb stack updated on entry/exit of heading nodes.
 */
export function walkDocNode(root: DocNode): TextSegment[] {
  const segments: TextSegment[] = [];
  const breadcrumb: string[] = [];

  function visit(node: DocNode): void {
    if (node.type === "heading" && node.text) {
      const level = (node.attrs.headingLevel ?? 1) - 1;
      // Truncate breadcrumb at this heading level and push the new heading.
      breadcrumb.splice(level, breadcrumb.length - level, node.text);
    }

    // Emit leaf text (non-structural nodes that carry text content).
    const isLeafText =
      node.text != null &&
      node.type !== "heading" &&
      node.type !== "image" &&
      node.type !== "link";

    if (isLeafText && node.text) {
      segments.push({
        text: node.text,
        nodeType: node.type,
        attrs: node.attrs,
        breadcrumb: [...breadcrumb],
      });
    }

    for (const child of node.children ?? []) {
      visit(child);
    }
  }

  visit(root);
  return segments;
}
