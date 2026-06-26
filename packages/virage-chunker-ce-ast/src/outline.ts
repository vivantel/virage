import type { DocNode } from "./types.js";

/** Extract the top-level section titles from a DocNode tree (document outline). */
export function extractOutline(root: DocNode): string[] {
  const titles: string[] = [];
  for (const child of root.children ?? []) {
    if (child.type === "heading" && child.attrs.headingLevel === 1 && child.text) {
      titles.push(child.text);
    } else if (child.type === "section") {
      const h = (child.children ?? []).find(
        (n) => n.type === "heading" && n.text,
      );
      if (h?.text) titles.push(h.text);
    }
  }
  return titles;
}
