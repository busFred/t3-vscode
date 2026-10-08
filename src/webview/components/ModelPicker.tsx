import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { GripVerticalIcon, CheckIcon, StarIcon } from "lucide-react";
import type { HostStateSnapshot, ModelSelection } from "../../shared/bridge";
import { selectionForModel } from "../../shared/modelOptions";
import { useModelDrag } from "../useModelDrag";
import { useActions } from "../actions";
import { scoreModelPickerSearch } from "./t3/modelPickerSearch";
import { getProviderModelPreference, orderedProviderModels, visibleProviderModels } from "../../shared/modelPreferences";

export function ModelPicker({ state, selection, anchor, onClose, onSelect }: {
  readonly state: HostStateSnapshot;
  readonly selection: ModelSelection | null | undefined;
  readonly anchor: HTMLButtonElement;
  readonly onClose: () => void;
  readonly onSelect?: (selection: ModelSelection) => void;
}) {
  const run = useActions();
  const favorites = state.favoriteModels ?? [];
  const [providerId, setProviderId] = useState(favorites.length ? "favorites" : selection?.instanceId ?? "all");
  const [search, setSearch] = useState("");
  const [showLegacy, setShowLegacy] = useState(false);
  const [managing, setManaging] = useState(false);
  const [pendingVisibility, setPendingVisibility] = useState<{ instanceId: string; model: string; visible: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ left: 8, bottom: 8, width: 480, maxHeight: 400 });
  const popup = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const providers = state.providers.filter((provider) => provider.enabled);
  const preferences = state.providerModelPreferences;
  const [announcement, setAnnouncement] = useState("");
  const reorderAllowed = managing && !search.trim() && providerId !== "favorites" && !busy;
  const reorder = (instanceId: string, model: string, before: string | null, order: string[]) => {
    setBusy(true);
    const next = order.filter((slug) => slug !== model); next.splice(before === null ? next.length : next.indexOf(before), 0, model);
    void run("reorderModel", { instanceId, model, before, order }).then((ok) => {
      const label = providers.find((provider) => provider.instanceId === instanceId)?.models.find((entry) => entry.slug === model)?.name ?? model;
      setAnnouncement(ok ? `${label}, position ${next.indexOf(model) + 1} of ${order.length}.` : "Order could not be saved.");
    }).finally(() => {
      setBusy(false);
      requestAnimationFrame(() => [...(popup.current?.querySelectorAll<HTMLButtonElement>(".model-grip") ?? [])]
        .find((node) => node.dataset.instanceId === instanceId && node.dataset.slug === model)?.focus());
    });
  };
  const dragSignature = JSON.stringify([managing, search, providerId, state.providers.map((provider) => [provider.instanceId, provider.models.map((model) => model.slug)]), preferences]);
  const { drag, start } = useModelDrag(popup, dragSignature, reorder);
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
      const above = bounds.top - 14, below = window.innerHeight - bounds.bottom - 14;
      const placement = above >= below ? { bottom: Math.max(8, window.innerHeight - bounds.top + 6) } : { top: Math.max(8, bounds.bottom + 6) };
      setPosition({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)), ...placement, width, maxHeight: Math.max(120, Math.max(above, below)) });
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
      return <section key={provider.instanceId} data-model-provider={provider.instanceId}><header>{provider.displayName ?? provider.instanceId}{!provider.installed ? " · Not installed" : provider.availability === "unavailable" ? " · Unavailable" : ""}</header>
        {models.map(({ model, favorite }) => {
          const visible = pendingVisibility?.instanceId === provider.instanceId && pendingVisibility.model === model.slug
            ? pendingVisibility.visible : visibleSlugs.has(model.slug);
          const index = ordered.findIndex((entry) => entry.slug === model.slug);
          return <div className={`model-row${managing && !visible ? " model-hidden" : ""}${drag?.active && drag.instanceId === provider.instanceId && drag.model === model.slug ? " model-drag-source" : ""}`} key={model.slug} data-model-slug={model.slug}>
          {managing ? <button className="model-grip icon-button" data-instance-id={provider.instanceId} data-slug={model.slug} aria-label={`Reorder ${model.name}`} title="Drag to reorder · Alt+Up/Down" aria-describedby="model-reorder-help" disabled={!reorderAllowed}
            onPointerDown={(event) => start(event, provider.instanceId, model.slug, model.name, ordered.map((entry) => entry.slug))}
            onKeyDown={(event) => {
              if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
              event.preventDefault(); event.stopPropagation();
              const to = index + (event.key === "ArrowUp" ? -1 : 1);
              if (to < 0 || to >= ordered.length) return;
              reorder(provider.instanceId, model.slug, event.key === "ArrowUp" ? ordered[to]!.slug : ordered[to + 1]?.slug ?? null, ordered.map((entry) => entry.slug));
            }}><GripVerticalIcon size={14} /></button> : null}
          {managing ? <span className="model-manage-name" title={model.slug}>{model.name}{model.isLegacy ? <small>Legacy</small> : null}</span>
            : <button className="model-choice" disabled={busy || unavailable} title={model.slug} aria-pressed={selection?.instanceId === provider.instanceId && selection.model === model.slug} onClick={() => {
            if (onSelect) {
              onSelect(selection?.instanceId === provider.instanceId && selection.model === model.slug ? selection : selectionForModel(provider.instanceId, model, selection)); close(); return;
            }
            setBusy(true); void run("setModel", { ...(state.activeThreadId ? { threadId: state.activeThreadId } : {}), modelSelection: selectionForModel(provider.instanceId, model, selection) })
              .then((ok) => { if (ok) close(); }).finally(() => setBusy(false));
          }}><span>{model.name}{model.subProvider ? <small>{model.subProvider}</small> : null}</span>{model.badge === "new" ? <small>New</small> : model.isCustom ? <small>Custom</small> : null}
            {selection?.instanceId === provider.instanceId && selection.model === model.slug ? <CheckIcon size={13} /> : null}</button>}
          <button className="model-favorite icon-button" aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${model.name}`} aria-pressed={favorite} disabled={busy} onClick={() => {
            setBusy(true); void run("toggleFavoriteModel", { instanceId: provider.instanceId, model: model.slug }).finally(() => setBusy(false));
          }}><StarIcon size={13} fill={favorite ? "currentColor" : "none"} /></button>
          {managing ? <div className="model-manage-controls">
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
    </div>
    {drag?.active ? <><div className="model-drag-ghost" style={{ left: Math.min(drag.x + 12, window.innerWidth - 180), top: drag.y + 12 }}>{drag.label}</div>{drag.valid ? <div className="model-drop-line" style={{ left: drag.left, top: drag.line, width: drag.width }} /> : null}</> : null}
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    {managing ? <p id="model-reorder-help" className="model-preferences-note">{search.trim() || providerId === "favorites" ? "Clear search and choose a provider or All providers to reorder." : "Drag a grip or use Alt+Up/Down to reorder."}</p> : null}
    {managing ? <p className="model-preferences-note">Favorites, visibility and ordering are saved in VS Code.</p> : null}
  </div>, document.body);
}
