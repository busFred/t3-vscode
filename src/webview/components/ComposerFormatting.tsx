import { BoldIcon, ItalicIcon, UnderlineIcon, StrikethroughIcon, CodeIcon, SquareCodeIcon, LinkIcon, PaperclipIcon, ListIcon, ListOrderedIcon, ListTodoIcon, QuoteIcon, IndentDecreaseIcon, IndentIncreaseIcon } from "lucide-react";
import type { MarkdownFormat } from "../../shared/composerEditing";
import { ContextMeter } from "./ContextMeter";
import type { ContextUsageSnapshot } from "../../shared/contextUsage";

export function ComposerFormatting({ disabled, listAssist, contextUsage, onListAssist, onAttach, onFormat, onIndent }: {
  readonly disabled: boolean; readonly listAssist: boolean;
  readonly contextUsage?: ContextUsageSnapshot | null | undefined;
  readonly onListAssist: () => void; readonly onAttach: () => void;
  readonly onFormat: (format: MarkdownFormat) => void;
  readonly onIndent: (outdent: boolean) => void;
}) {
  const groups = [
    [["bold", "Bold", BoldIcon], ["italic", "Italic", ItalicIcon], ["underline", "Underline", UnderlineIcon], ["strike", "Strikethrough", StrikethroughIcon]],
    [["code", "Inline code", CodeIcon], ["fence", "Code block", SquareCodeIcon], ["quote", "Block quote", QuoteIcon]],
    [["link", "Insert Markdown link", LinkIcon], ["attach", "Attach files", PaperclipIcon]],
    [["bullet", "Bulleted list", ListIcon], ["number", "Numbered list", ListOrderedIcon], ["task", "Task list", ListTodoIcon]],
    [["outdent", "Outdent (Shift+Tab)", IndentDecreaseIcon], ["indent", "Indent (Tab)", IndentIncreaseIcon]],
  ] as const;
  return <div id="composer-formatting" className="composer-formatting" role="toolbar" aria-label="Markdown formatting" onMouseDown={(event) => event.preventDefault()}>
    {groups.map((group, index) => <div className="formatting-group" key={index}>{group.map(([format, label, Icon]) => <button key={format} className="icon-button" aria-label={label} title={label} disabled={disabled} onClick={() => {
      if (format === "attach") onAttach(); else if (format === "indent" || format === "outdent") onIndent(format === "outdent"); else onFormat(format);
    }}><Icon size={14} /></button>)}</div>)}
    <div className="formatting-right">
      <ContextMeter usage={contextUsage} />
      <button className="list-assist-toggle" aria-label="List assist" aria-pressed={listAssist} title={`Automatic list continuation and numbering ${listAssist ? "enabled" : "disabled"}`} onClick={onListAssist}>List assist</button>
    </div>
  </div>;
}
