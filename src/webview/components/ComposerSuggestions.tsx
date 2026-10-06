import { FileIcon, FolderIcon, Settings2Icon } from "lucide-react";
import type { ComposerSuggestion } from "../../shared/bridge";

export function ComposerSuggestions({ items, selected, pending, error, onSelect, onHighlight }: {
  readonly items: ReadonlyArray<ComposerSuggestion>; readonly selected: number; readonly pending: boolean;
  readonly error: string | undefined; readonly onSelect: (item: ComposerSuggestion) => void; readonly onHighlight: (index: number) => void;
}) {
  return <div className="composer-suggestions" role="listbox" aria-label="Composer suggestions" id="composer-suggestions">
    {items.map((item, index) => <button key={item.id} id={`composer-suggestion-${index}`} type="button" role="option" aria-selected={index === selected}
      className={index === selected ? "selected" : ""} onPointerDown={(event) => event.preventDefault()} onClick={() => onSelect(item)} onPointerMove={() => onHighlight(index)}>
      {item.kind === "file" ? <FileIcon size={14} /> : item.kind === "directory" ? <FolderIcon size={14} /> : item.kind === "skill" ? <Settings2Icon size={13} /> : null}
      <span className="suggestion-label">{item.label}</span><span className="suggestion-description">{item.description}</span>
    </button>)}
    {pending ? <p role="status">Searching…</p> : error ? <p role="status">{error}</p> : items.length === 0 ? <p role="status">No matches.</p> : null}
  </div>;
}
