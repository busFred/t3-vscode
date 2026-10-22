import { collapseBlankLines, escapeMarkdownText } from "../shared/selectionMarkdown.js";

/** Serialize only the selected rendered fragment; no hidden controls or unrelated message text. */
export function selectionMarkdown(range: Range, source: HTMLElement): string {
  let fragment: Node = range.cloneContents();
  let ancestor = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer as Element;
  // cloneContents omits a partially selected enclosing bold/link/code element.
  while (ancestor && ancestor !== source && source.contains(ancestor)) {
    const wrapper = ancestor.cloneNode(false); wrapper.appendChild(fragment); fragment = wrapper; ancestor = ancestor.parentElement;
  }
  // Tracks whether the next emitted character sits at the start of a markdown line, so `#`/`-`/`+`/`N.`
  // are only escaped where they would otherwise read as a block marker. Mutated in document order as
  // the traversal below walks depth-first, matching how the returned strings are concatenated.
  let lineStart = true;
  const emit = (value: string): string => {
    if (value !== "") lineStart = /\n$/.test(value) || (lineStart && /^[ \t]*$/.test(value));
    return value;
  };
  const text = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      if (node.parentElement?.closest("pre,code,.katex")) return emit(value);
      // A cell is never at column 0 (a `|` precedes it), so line-start markers need no escape there.
      const cell = !!node.parentElement?.closest("td,th");
      return emit(escapeMarkdownText(value, lineStart && !cell, cell));
    }
    if (!(node instanceof Element)) return [...node.childNodes].map(text).join("");
    if (node.matches('button,input,textarea,select,svg,script,style,[hidden],[aria-hidden="true"],.katex-mathml')) return "";
    const contents = () => [...node.childNodes].map(text).join("");
    if (node.matches(".katex")) return emit(`$${node.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? node.textContent ?? ""}$`);
    const value = contents();
    switch (node.tagName.toLowerCase()) {
      case "strong": case "b": return emit(`**${value}**`);
      case "em": case "i": return emit(`*${value}*`);
      case "del": case "s": return emit(`~~${value}~~`);
      case "u": return emit(`<u>${value}</u>`);
      case "a": return emit(node.getAttribute("href") ? `[${value}](${node.getAttribute("href")})` : value);
      case "img": return emit(`![${node.getAttribute("alt") ?? ""}](${node.getAttribute("src") ?? ""})`);
      case "br": return emit("\n");
      case "code": {
        if (node.parentElement?.tagName === "PRE") return value;
        const fence = "`".repeat(Math.max(0, ...[...value.matchAll(/`+/g)].map(match => match[0].length)) + 1);
        const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
        return emit(`${fence}${pad}${value}${pad}${fence}`);
      }
      case "pre": {
        const fence = "`".repeat(Math.max(2, ...[...value.matchAll(/`+/g)].map(match => match[0].length)) + 1);
        const language = node.querySelector("code")?.className.match(/language-([\w+-]+)/)?.[1] ?? "";
        return emit(`\n${fence}${language}\n${value.replace(/\n$/, "")}\n${fence}\n`);
      }
      case "blockquote": return emit(`\n${value.trim().split("\n").map(line => `> ${line}`).join("\n")}\n`);
      case "li": {
        const prefix = node.parentElement?.tagName === "OL" ? `${Number(node.parentElement.getAttribute("start") ?? 1) + [...node.parentElement.children].indexOf(node)}. ` : "- ";
        return emit(`${prefix}${value.trim().replaceAll("\n", `\n${" ".repeat(prefix.length)}`)}\n`);
      }
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return emit(`\n${"#".repeat(Number(node.tagName[1]))} ${value}\n`);
      case "ul": case "ol": return emit(`\n${value.trimEnd()}\n`);
      // A paragraph inside a list item is already separated by the item's own line; a trailing blank there
      // would just inflate the list. Elsewhere it marks the end of a markdown block.
      case "p": return emit(node.parentElement?.tagName === "LI" ? `${value}\n` : `${value}\n\n`);
      // Sibling wrappers (file references, attachment names) must not run together; collapseBlankLines removes any excess.
      case "div": return emit(`${value}\n\n`);
      case "hr": return emit("\n---\n");
      case "td": case "th": return ` ${value.trim()} |`;
      case "tr": return emit(`|${value}\n${node.querySelector("th") ? `|${[...node.children].map(() => " --- |").join("")}\n` : ""}`);
      default: return value;
    }
  };
  return collapseBlankLines(text(fragment)).trim();
}
