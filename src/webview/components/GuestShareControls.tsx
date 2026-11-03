import { ChatMedia } from "./ChatMedia";
import type { ChatAsset } from "../../shared/chatVisuals";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GuestShareCreateResult } from "@t3tools/contracts";
import type { ThreadSummary } from "../../shared/bridge";
import { bridge } from "../bridge-client";
import { useActions } from "../actions";

/** The credential is returned only by create; never reconstruct a link from public share state. */
export function GuestShareDialog({ thread, onClose }: { readonly thread: ThreadSummary; readonly onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [url, setUrl] = useState<string>(), [error, setError] = useState<string>(), [copied, setCopied] = useState(false);
  const run = useActions();
  useEffect(() => { const previous = document.activeElement; dialog.current?.showModal(); return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; }, []);
  return createPortal(<dialog className="guest-share-dialog" ref={dialog} aria-labelledby="guest-share-title" onKeyDown={(event) => event.stopPropagation()} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <h3 id="guest-share-title">Share with guest</h3>
    <p>The guest sees the thread as you do, including command output and the agent&apos;s reasoning. Each message they send waits for you.</p>
    {url ? <div className="guest-link"><input readOnly aria-label="Guest link" value={url} onFocus={(event) => event.currentTarget.select()} /><button onClick={() => { void run("copyText", { text: url }).then((ok) => { if (ok) setCopied(true); }); }}>{copied ? "Copied" : "Copy"}</button></div> : <p>{thread.guestShare ? "A new link ends the current one." : "The link works once and expires in 24 hours."}</p>}
    {error || thread.guestSharingDisabledReason ? <p role="alert">{error ?? thread.guestSharingDisabledReason}</p> : null}
    <div className="guest-share-buttons">{url ? <button onClick={onClose}>Done</button> : <><button disabled={busy} onClick={onClose}>Cancel</button><button disabled={busy || !!thread.guestSharingDisabledReason} onClick={() => {
      setBusy(true); setError(undefined);
      void bridge.request<GuestShareCreateResult>("createGuestShare", { threadId: thread.id }).then((result) => setUrl(result.url), (cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not create a guest link.")).finally(() => setBusy(false));
    }}>{busy ? "Creating..." : "Create link"}</button></>}</div>
  </dialog>, document.body);
}

export function GuestShareIndicator({ thread }: { readonly thread: ThreadSummary }) {
  const run = useActions(), [busy, setBusy] = useState(false), [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick((value) => value + 1), 60_000); return () => clearInterval(timer); }, []);
  const share = thread.guestShare;
  if (!share) return null;
  const status = share.expiresAt.slice(0, 16) <= new Date().toISOString().slice(0, 16) ? "Guest link expired" : share.guestName ? `${share.guestName} is a guest` : "Guest link active";
  return <div className="guest-share-indicator"><span>{status}</span><button disabled={busy} onClick={() => { setBusy(true); void run("threadAction", { threadId: thread.id, action: "stop-sharing" }).finally(() => setBusy(false)); }}>Stop sharing</button></div>;
}

export function GuestPendingMessages({ thread }: { readonly thread: ThreadSummary }) {
  const run = useActions(), [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const pending = thread.guestShare?.messages.filter((message) => message.status === "pending") ?? [];
  if (!pending.length) return null;
  const name = thread.guestShare?.guestName ?? "Guest";
  const resolve = (id: string, action: string) => {
    setBusy((previous) => new Set(previous).add(id));
    void run("threadAction", { threadId: thread.id, action, value: id }).finally(() => setBusy((previous) => { const next = new Set(previous); next.delete(id); return next; }));
  };
  return <ol className="guest-pending-messages" aria-label={`${pending.length} guest message${pending.length === 1 ? "" : "s"} waiting`} aria-live="polite">{pending.map((message) => <li key={message.id}>
    <strong>{name}</strong><p>{message.text}</p>
    {message.attachments?.map((attachment) => attachment.mimeType.startsWith("image/") ? <ChatMedia key={attachment.id} src={attachment.name} alt={attachment.name} threadId={thread.id} source={{ sourceThreadId: thread.id, itemId: message.id }} attachmentId={attachment.id} kind="image" /> : <button key={attachment.id} onClick={() => { void bridge.request<ChatAsset>("chatAsset", { threadId: thread.id, sourceThreadId: thread.id, itemId: message.id, reference: { kind: "attachment", attachmentId: attachment.id } }).then((asset) => run("openLink", { href: asset.url, threadId: thread.id })).catch(() => undefined); }}>{attachment.name}</button>)}
    <div className="guest-share-buttons"><button disabled={busy.has(message.id)} aria-label={`Dismiss message from ${name}`} onClick={() => resolve(message.id, "dismiss-guest-message")}>Dismiss</button><button disabled={busy.has(message.id)} aria-label={`Send message from ${name}`} onClick={() => resolve(message.id, "send-guest-message")}>Send</button></div>
  </li>)}</ol>;
}
