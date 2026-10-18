/** Serialize only the selected rendered fragment; no hidden controls or unrelated message text. */
export function selectionMarkdown(range: Range, source: HTMLElement): string {
  let fragment: Node = range.cloneContents();
  let ancestor = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer as Element;
  // cloneContents omits a partially selected enclosing bold/link/code element.
  while (ancestor && ancestor !== source && source.contains(ancestor)) {
    const wrapper = ancestor.cloneNode(false); wrapper.appendChild(fragment); fragment = wrapper; ancestor = ancestor.parentElement;
  }
  const text = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      if (node.parentElement?.closest("pre,code,.katex")) return value;
      return value.replace(/[\\`*_{}\[\]<>!#|.+~=\-]/g, "\\$&");
    }
    if (!(node instanceof Element)) return [...node.childNodes].map(text).join("");
    if (node.matches('button,input,textarea,select,svg,script,style,[hidden],[aria-hidden="true"],.katex-mathml')) return "";
    const contents = () => [...node.childNodes].map(text).join("");
    if (node.matches(".katex")) return `$${node.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? node.textContent ?? ""}$`;
    const value = contents();
    switch (node.tagName.toLowerCase()) {
      case "strong": case "b": return `**${value}**`;
      case "em": case "i": return `*${value}*`;
      case "del": case "s": return `~~${value}~~`;
      case "u": return `<u>${value}</u>`;
      case "a": return node.getAttribute("href") ? `[${value}](${node.getAttribute("href")})` : value;
      case "img": return `![${node.getAttribute("alt") ?? ""}](${node.getAttribute("src") ?? ""})`;
      case "br": return "\n";
      case "code": {
        if (node.parentElement?.tagName === "PRE") return value;
        const fence = "`".repeat(Math.max(0, ...[...value.matchAll(/`+/g)].map(match => match[0].length)) + 1);
        const pad = value.startsWith("`") || value.endsWith("`") ? " " : "";
        return `${fence}${pad}${value}${pad}${fence}`;
      }
      case "pre": {
        const fence = "`".repeat(Math.max(2, ...[...value.matchAll(/`+/g)].map(match => match[0].length)) + 1);
        const language = node.querySelector("code")?.className.match(/language-([\w+-]+)/)?.[1] ?? "";
        return `\n${fence}${language}\n${value.replace(/\n$/, "")}\n${fence}\n`;
      }
      case "blockquote": return `\n${value.trim().split("\n").map(line => `> ${line}`).join("\n")}\n`;
      case "li": {
        const prefix = node.parentElement?.tagName === "OL" ? `${Number(node.parentElement.getAttribute("start") ?? 1) + [...node.parentElement.children].indexOf(node)}. ` : "- ";
        return `${prefix}${value.trim().replaceAll("\n", `\n${" ".repeat(prefix.length)}`)}\n`;
      }
      case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return `\n${"#".repeat(Number(node.tagName[1]))} ${value}\n`;
      case "ul": case "ol": return `\n${value.trimEnd()}\n`;
      case "p": case "div": return `${value}\n\n`;
      case "hr": return "\n---\n";
      case "td": case "th": return ` ${value.trim()} |`;
      case "tr": return `|${value}\n${node.querySelector("th") ? `|${[...node.children].map(() => " --- |").join("")}\n` : ""}`;
      default: return value;
    }
  };
  return text(fragment).trim();
}
