import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, StarIcon } from "lucide-react";
import type { HostStateSnapshot, ModelSelection } from "../../shared/bridge";
import { selectionForModel } from "../../shared/modelOptions";
import { useActions } from "../actions";
import { scoreModelPickerSearch } from "./t3/modelPickerSearch";

export function ModelPicker({ state, selection, anchor, onClose }: {
  readonly state: HostStateSnapshot;
  readonly selection: ModelSelection | null | undefined;
  readonly anchor: HTMLButtonElement;
  readonly onClose: () => void;
}) {
  const run = useActions();
  const favorites = state.favoriteModels ?? [];
  const [providerId, setProviderId] = useState(favorites.length ? "favorites" : selection?.instanceId ?? "all");
  const [search, setSearch] = useState("");
  const [showLegacy, setShowLegacy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ left: 8, bottom: 8, width: 480, maxHeight: 400 });
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const providers = state.providers.filter((provider) => provider.enabled);
  const entries = useMemo(() => providers.flatMap((provider) => provider.models.map((model) => {
    const favorite = favorites.some((item) => item.instanceId === provider.instanceId && item.model === model.slug);
    const score = scoreModelPickerSearch({ driverKind: provider.driver, providerDisplayName: provider.displayName ?? provider.instanceId,
      name: `${model.name} ${model.slug} ${(model.aliases ?? []).join(" ")}`, ...(model.shortName ? { shortName: model.shortName } : {}), ...(model.subProvider ? { subProvider: model.subProvider } : {}), isFavorite: favorite }, search);
    return { provider, model, favorite, score };
  })).filter((entry) => (showLegacy || !entry.model.isLegacy) && (search.trim() ? entry.score !== null
    : providerId === "all" || (providerId === "favorites" ? entry.favorite : entry.provider.instanceId === providerId)))
    .sort((left, right) => (left.score ?? 0) - (right.score ?? 0)), [state.providers, favorites, search, providerId, showLegacy]);
  useLayoutEffect(() => {
    const place = () => {
      const bounds = anchor.getBoundingClientRect(); const width = Math.min(480, window.innerWidth - 16);
      const bottom = Math.max(8, window.innerHeight - bounds.top + 6);
      setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)), bottom, width, maxHeight: Math.max(160, window.innerHeight - bottom - 8) });
    };
    place(); window.addEventListener("resize", place); return () => window.removeEventListener("resize", place);
  }, [anchor]);
  useEffect(() => {
    input.current?.focus();
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(); };
    window.addEventListener("pointerdown", outside); return () => window.removeEventListener("pointerdown", outside);
  }, [anchor, onClose]);
  const close = () => { onClose(); anchor.focus(); };
  const rowKey = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if ((event.key === "Home" || event.key === "End") && event.target === input.current) return;
    const buttons = [...(popup.current?.querySelectorAll<HTMLButtonElement>(".model-choice:not(:disabled)") ?? [])];
    if (!buttons.length) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : event.key === "ArrowDown" ? Math.min(index + 1, buttons.length - 1) : index <= 0 ? -1 : index - 1;
    event.preventDefault(); if (next < 0) input.current?.focus(); else buttons[next]?.focus();
  };
  return createPortal(<div ref={popup} className="model-picker" role="dialog" aria-label="Choose model" style={position} onKeyDown={rowKey}>
    <input ref={input} aria-label="Search models" placeholder="Search all models…" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="model-picker-body"><nav className="model-providers" aria-label="Model providers" onKeyDown={(event) => {
      if (event.key === "ArrowRight") { event.preventDefault(); input.current?.focus(); }
    }}>
      <button aria-pressed={!search.trim() && providerId === "favorites"} onClick={() => { setSearch(""); setProviderId("favorites"); }}><StarIcon size={13} /><span>Favorites</span></button>
      <button aria-pressed={!search.trim() && providerId === "all"} onClick={() => { setSearch(""); setProviderId("all"); }}>All providers</button>
      {providers.map((provider) => <button key={provider.instanceId} aria-pressed={!search.trim() && providerId === provider.instanceId} title={provider.displayName ?? provider.instanceId} onClick={() => { setSearch(""); setProviderId(provider.instanceId); }}>
        <span>{provider.displayName ?? provider.instanceId}</span><small>{provider.models.length}</small>
      </button>)}
    </nav><div className="model-options">{providers.map((provider) => {
      const models = entries.filter((entry) => entry.provider.instanceId === provider.instanceId);
      if (!models.length) return null;
      const unavailable = !provider.installed || provider.availability === "unavailable";
      return <section key={provider.instanceId}><header>{provider.displayName ?? provider.instanceId}{!provider.installed ? " · Not installed" : provider.availability === "unavailable" ? " · Unavailable" : ""}</header>
        {models.map(({ model, favorite }) => <div className="model-row" key={model.slug}>
          <button className="model-choice" disabled={busy || unavailable} title={model.slug} aria-pressed={selection?.instanceId === provider.instanceId && selection.model === model.slug} onClick={() => {
            setBusy(true); void run("setModel", { ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}), modelSelection: selectionForModel(provider.instanceId, model, selection) })
              .then((ok) => { if (ok) close(); }).finally(() => setBusy(false));
          }}><span>{model.name}{model.subProvider ? <small>{model.subProvider}</small> : null}</span>{model.badge === "new" ? <small>New</small> : model.isCustom ? <small>Custom</small> : null}
            {selection?.instanceId === provider.instanceId && selection.model === model.slug ? <CheckIcon size={13} /> : null}</button>
          <button className="model-favorite icon-button" aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${model.name}`} aria-pressed={favorite} disabled={busy} onClick={() => {
            setBusy(true); void run("toggleFavoriteModel", { instanceId: provider.instanceId, model: model.slug }).finally(() => setBusy(false));
          }}><StarIcon size={13} fill={favorite ? "currentColor" : "none"} /></button>
        </div>)}
      </section>;
    })}{!entries.length ? <div className="model-empty">{search.trim() ? "No matching models." : providerId === "favorites" ? "Star a model to add it to Favorites." : "No models available. Configure a provider in T3 Code."}</div> : null}</div></div>
    {providers.some((provider) => provider.models.some((model) => model.isLegacy)) ? <label className="model-legacy"><input type="checkbox" checked={showLegacy} onChange={(event) => setShowLegacy(event.target.checked)} />Show legacy models</label> : null}
  </div>, document.body);
}
