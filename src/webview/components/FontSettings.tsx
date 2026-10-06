import { useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { DEFAULT_APPEARANCE, FONT_SIZE_KEYS, FONT_SIZE_OPTIONS, type AppearanceSettings } from "../../shared/appearance";
import { useActions } from "../actions";

export function FontSettings({ appearance, onClose }: { readonly appearance: AppearanceSettings; readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = useActions();
  useEffect(() => {
    const element = dialog.current!; element.showModal();
    return () => element.close();
  }, []);
  const close = () => { dialog.current?.close(); onClose(); };
  const save = async (update: Partial<AppearanceSettings>) => {
    setBusy(true); setFailed(false);
    try { setFailed(!await run("setAppearance", update)); } finally { setBusy(false); }
  };
  return <dialog ref={dialog} className="font-settings" aria-labelledby="font-settings-title" onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  }}>
    <header><h2 id="font-settings-title">Font settings</h2><button className="icon-button" aria-label="Close font settings" onClick={close}><XIcon size={16} /></button></header>
    <p className="subtle">Changes apply immediately to the sidebar and all T3 tabs.</p>
    <div className="font-setting-rows">{FONT_SIZE_KEYS.map((key) => {
      const option = FONT_SIZE_OPTIONS[key];
      return <div className="font-setting-row" key={key}>
        <label htmlFor={key}>{option.label}<span>{option.description}</span></label>
        <select id={key} value={appearance[key]} disabled={busy} onChange={(event) => { void save({ [key]: Number(event.target.value) }); }}>
          {Array.from({ length: option.max - option.min + 1 }, (_, index) => option.min + index).map((size) => <option key={size} value={size}>{size} px</option>)}
        </select>
      </div>;
    })}</div>
    {failed ? <p className="font-settings-error" role="alert">Could not save font sizes. Try again.</p> : null}
    <footer><button className="btn" disabled={busy} onClick={() => { void save(DEFAULT_APPEARANCE); }}>Reset font sizes</button><button className="btn primary" onClick={close}>Done</button></footer>
  </dialog>;
}
