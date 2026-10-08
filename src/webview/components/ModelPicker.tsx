import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, StarIcon } from "lucide-react";
import type { HostStateSnapshot, ModelSelection } from "../../shared/bridge";
import { selectionForModel } from "../../shared/modelOptions";
import { useActions } from "../actions";
import { scoreModelPickerSearch } from "./t3/modelPickerSearch";
import { getProviderModelPreference, orderedProviderModels, visibleProviderModels } from "../../shared/modelPreferences";

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
  const [managing, setManaging] = useState(false);
  const [pendingVisibility, setPendingVisibility] = useState<{ instanceId: string; model: string; visible: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ left: 8, bottom: 8, width: 480, maxHeight: 400 });
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const providers = state.providers.filter((provider) => provider.enabled);
  const preferences = state.providerModelPreferences;
  const entries = useMemo(() => providers.flatMap((provider) => (managing ? orderedProviderModels(provider, getProviderModelPreference(preferences, provider.instanceId))
    : visibleProviderModels(provider, getProviderModelPreference(preferences, provider.instanceId), showLegacy)).map((model) => {
    const favorite = favorites.some((item) => item.instanceId === provider.instanceId && item.model === model.slug);
    const score = scoreModelPickerSearch({ driverKind: provider.driver, providerDisplayName: provider.displayName ?? provider.instanceId,
      name: `${model.name} ${model.slug} ${(model.aliases ?? []).join(" ")}`, ...(model.shortName ? { shortName: model.shortName } : {}), ...(model.subProvider ? { subProvider: model.subProvider } : {}), isFavorite: favorite }, search);
    return { provider, model, favorite, score };
  })).filter((entry) => (search.trim() ? entry.score !== null
    : providerId === "all" || (providerId === "favorites" ? entry.favorite : entry.provider.instanceId === providerId)))
    .sort((left, right) => (left.score ?? 0) - (right.score ?? 0)), [state.providers, favorites, preferences, search, providerId, showLegacy, managing]);
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
        <span>{provider.displayName ?? provider.instanceId}</span><small>{visibleProviderModels(provider, getProviderModelPreference(preferences, provider.instanceId), !managing && showLegacy).length}</small>
      </button>)}
    </nav><div className="model-options">{providers.map((provider) => {
      const models = entries.filter((entry) => entry.provider.instanceId === provider.instanceId);
      if (!models.length) return null;
      const unavailable = !provider.installed || provider.availability === "unavailable";
      const ordered = orderedProviderModels(provider, getProviderModelPreference(preferences, provider.instanceId));
      const visibleSlugs = new Set(visibleProviderModels(provider, getProviderModelPreference(preferences, provider.instanceId), !managing && showLegacy).map((model) => model.slug));
      return <section key={provider.instanceId}><header>{provider.displayName ?? provider.instanceId}{!provider.installed ? " · Not installed" : provider.availability === "unavailable" ? " · Unavailable" : ""}</header>
        {models.map(({ model, favorite }) => {
          const visible = pendingVisibility?.instanceId === provider.instanceId && pendingVisibility.model === model.slug
            ? pendingVisibility.visible : visibleSlugs.has(model.slug);
          const index = ordered.findIndex((entry) => entry.slug === model.slug);
          return <div className={`model-row${managing && !visible ? " model-hidden" : ""}`} key={model.slug}>
          {managing ? <span className="model-manage-name" title={model.slug}>{model.name}{model.isLegacy ? <small>Legacy</small> : null}</span>
            : <button className="model-choice" disabled={busy || unavailable} title={model.slug} aria-pressed={selection?.instanceId === provider.instanceId && selection.model === model.slug} onClick={() => {
            setBusy(true); void run("setModel", { ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}), modelSelection: selectionForModel(provider.instanceId, model, selection) })
              .then((ok) => { if (ok) close(); }).finally(() => setBusy(false));
          }}><span>{model.name}{model.subProvider ? <small>{model.subProvider}</small> : null}</span>{model.badge === "new" ? <small>New</small> : model.isCustom ? <small>Custom</small> : null}
            {selection?.instanceId === provider.instanceId && selection.model === model.slug ? <CheckIcon size={13} /> : null}</button>}
          <button className="model-favorite icon-button" aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${model.name}`} aria-pressed={favorite} disabled={busy} onClick={() => {
            setBusy(true); void run("toggleFavoriteModel", { instanceId: provider.instanceId, model: model.slug }).finally(() => setBusy(false));
          }}><StarIcon size={13} fill={favorite ? "currentColor" : "none"} /></button>
          {managing ? <div className="model-manage-controls">
            <button className="icon-button" aria-label={`Move ${model.name} up`} disabled={busy || index === 0} onClick={() => {
              setBusy(true); void run("moveModel", { instanceId: provider.instanceId, model: model.slug, direction: "up" }).finally(() => setBusy(false));
            }}><ArrowUpIcon size={13} /></button>
            <button className="icon-button" aria-label={`Move ${model.name} down`} disabled={busy || index === ordered.length - 1} onClick={() => {
              setBusy(true); void run("moveModel", { instanceId: provider.instanceId, model: model.slug, direction: "down" }).finally(() => setBusy(false));
            }}><ArrowDownIcon size={13} /></button>
            <input type="checkbox" aria-label={`Show ${model.name}`} checked={visible} disabled={busy} onChange={(event) => {
              const next = { instanceId: provider.instanceId, model: model.slug, visible: event.target.checked };
              setPendingVisibility(next); setBusy(true);
              void run("setModelVisibility", next).finally(() => { setPendingVisibility(null); setBusy(false); });
            }} />
          </div> : null}
        </div>; })}
      </section>;
    })}{!entries.length ? <div className="model-empty">{search.trim() ? "No matching models." : providerId === "favorites" ? "Star a visible model to add it to Favorites." : providers.some((provider) => provider.models.length) ? "No visible models. Use Manage models to show them." : "No models available. Configure a provider in T3 Code."}</div> : null}</div></div>
    <div className="model-picker-footer">
      {!managing && providers.some((provider) => !getProviderModelPreference(preferences, provider.instanceId) && provider.models.some((model) => model.isLegacy)) ? <label className="model-legacy"><input type="checkbox" checked={showLegacy} onChange={(event) => setShowLegacy(event.target.checked)} />Show legacy models</label> : null}
      <button className="text-button" aria-pressed={managing} onClick={() => {
        if (!managing) { setSearch(""); if (providerId === "favorites") setProviderId(selection?.instanceId ?? "all"); }
        setManaging(!managing);
      }}>{managing ? "Done" : "Manage models"}</button>
      {managing ? <button className="text-button" disabled={busy} onClick={() => {
        setBusy(true); void run("importModelPreferences").finally(() => setBusy(false));
      }}>Import from T3 Web</button> : null}
    </div>
    {managing ? <p className="model-preferences-note">Saved in VS Code. Import to copy T3 Web’s device preferences.</p> : null}
  </div>, document.body);
}
