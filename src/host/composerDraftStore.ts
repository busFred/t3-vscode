/** Per-tab recovery records. Files belong to the extension's storage, not the T3 web UI. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ViewDraft } from "../shared/viewDraft.js";
import { parseDraftTransfer } from "../shared/viewDraft.js";
import type { TextSelection } from "../shared/composerAttachments.js";

export interface StoredComposerDraft { readonly id: string; readonly scope: string; readonly threadId: string; draft: ViewDraft; selection?: TextSelection | undefined; updatedAt: number }
export class ComposerDraftStore {
  private readonly records = new Map<string, StoredComposerDraft>();
  private readonly claims = new Map<string, string>();
  private readonly dirty = new Set<string>();
  private readonly retained = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly instance = randomUUID();
  private lastUpdate = 0;
  private failure: Error | undefined;
  private readonly directory: string | undefined;
  constructor(directory?: string) { this.directory = directory; if (directory) mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  private path(id: string, suffix = ".json"): string { return join(this.directory!, id + suffix); }
  private load(): void {
    if (!this.directory) return;
    for (const name of readdirSync(this.directory)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name) || this.dirty.has(name.slice(0, -5)) || this.retained.has(name.slice(0, -5)) || [...this.claims.values()].includes(name.slice(0, -5))) continue;
      try {
        const raw = JSON.parse(readFileSync(join(this.directory, name), "utf8"));
        if (raw.id + ".json" !== name || typeof raw.scope !== "string" || typeof raw.threadId !== "string" || !Number.isFinite(raw.updatedAt)) continue;
        const parsed = parseDraftTransfer({ draftKey: raw.threadId, draft: raw.draft }, raw.threadId, true);
        if (parsed) {
          const start = raw.selection?.start, end = raw.selection?.end;
          const selection = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start
            ? { start: Math.min(start, parsed.draft.text.length), end: Math.min(end, parsed.draft.text.length) } : undefined;
          this.lastUpdate = Math.max(this.lastUpdate, raw.updatedAt);
          this.records.set(raw.id, { id: raw.id, scope: raw.scope, threadId: raw.threadId, updatedAt: raw.updatedAt, draft: parsed.draft, selection });
        }
      } catch { /* A damaged record is left intact; it must not prevent other drafts from opening. */ }
    }
  }
  private lease(id: string): boolean {
    if (!this.directory) return true;
    const path = this.path(id, ".lease");
    try { writeFileSync(path, JSON.stringify({ pid: process.pid, instance: this.instance }), { flag: "wx", mode: 0o600 }); return true; }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
      try {
        const prior = JSON.parse(readFileSync(path, "utf8"));
        if (prior.instance === this.instance) return true;
        try { process.kill(prior.pid, 0); return false; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }
        unlinkSync(path);
        writeFileSync(path, JSON.stringify({ pid: process.pid, instance: this.instance }), { flag: "wx", mode: 0o600 }); return true;
      } catch { return false; }
    }
  }
  owned(scope: string, threadId: string, owner: string): StoredComposerDraft | undefined { const id = this.claims.get(JSON.stringify([owner, scope, threadId])); return id ? this.records.get(id) : undefined; }
  private readonly memoryFiles = new Map<string, Uint8Array>();
  private fileKey(record: StoredComposerDraft, key: string): string { return `${record.id}-${createHash("sha256").update(key).digest("hex")}.bin`; }
  keepFile(record: StoredComposerDraft, key: string, bytes: Uint8Array): void {
    const file = this.fileKey(record, key);
    if (this.directory) writeFileSync(join(this.directory, file), bytes, { mode: 0o600 }); else this.memoryFiles.set(file, bytes);
  }
  file(record: StoredComposerDraft, key: string): Uint8Array | undefined {
    const file = this.fileKey(record, key);
    if (!this.directory) return this.memoryFiles.get(file);
    try { return readFileSync(join(this.directory, file)); } catch { return undefined; }
  }
  copyAttachmentFile(target: StoredComposerDraft, key: string, attachmentId: string): void {
    if (this.directory ? existsSync(join(this.directory, this.fileKey(target, key))) : this.memoryFiles.has(this.fileKey(target, key))) return;
    for (const record of this.records.values()) {
      const file = record.draft.attachments?.find(file => file.attachment?.id === attachmentId);
      const bytes = file ? this.file(record, file.key) : undefined;
      if (bytes) { this.keepFile(target, key, bytes); return; }
    }
  }
  claim(scope: string, threadId: string, owner: string): StoredComposerDraft {
    const key = JSON.stringify([owner, scope, threadId]), current = this.claims.get(key);
    if (current) return this.records.get(current)!;
    this.load();
    const claimed = new Set(this.claims.values());
    const recovered = [...this.records.values()].filter(record => record.scope === scope && record.threadId === threadId && !claimed.has(record.id) && (record.draft.text || record.draft.contexts.length || record.draft.attachments?.length)).sort((a, b) => b.updatedAt - a.updatedAt).find(record => this.lease(record.id));
    const record = recovered ?? { id: randomUUID(), scope, threadId, draft: { text: "", contexts: [] }, updatedAt: Date.now() };
    if (!recovered) this.lease(record.id);
    this.records.set(record.id, record); this.claims.set(key, record.id);
    this.save(record, record.draft, record.selection);
    return record;
  }
  save(record: StoredComposerDraft, draft: ViewDraft, selection?: TextSelection): void {
    for (const file of record.draft.attachments ?? []) if (!(draft.attachments ?? []).some(next => next.key === file.key)) {
      const name = this.fileKey(record, file.key); this.memoryFiles.delete(name);
      if (this.directory) { try { unlinkSync(join(this.directory, name)); } catch { /* No local copy. */ } }
    }
    record.draft = draft; record.selection = selection; record.updatedAt = this.lastUpdate = Math.max(Date.now(), this.lastUpdate + 1); this.dirty.add(record.id);
    clearTimeout(this.timer); this.timer = setTimeout(() => { try { this.flush(); } catch (cause) { this.failure = cause as Error; } }, 60);
    if (this.failure) { const failure = this.failure; this.failure = undefined; throw failure; }
  }
  flush(): void {
    clearTimeout(this.timer); this.timer = undefined;
    if (!this.directory) { this.dirty.clear(); return; }
    for (const id of this.dirty) {
      const record = this.records.get(id)!;
      const temporary = this.path(id, `.${this.instance}.tmp`);
      writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 });
      renameSync(temporary, this.path(id)); this.dirty.delete(id);
    }
    this.failure = undefined;
  }
  /** Keep the file lease until an in-flight upload has saved its result, even if the tab closes. */
  retain(record: StoredComposerDraft): () => void {
    this.retained.set(record.id, (this.retained.get(record.id) ?? 0) + 1);
    return () => {
      const count = (this.retained.get(record.id) ?? 1) - 1;
      if (count) this.retained.set(record.id, count); else { this.retained.delete(record.id); this.releaseLease(record.id); }
    };
  }
  private releaseLease(id: string): void {
    if (this.directory && !this.retained.has(id) && ![...this.claims.values()].includes(id)) {
      try { unlinkSync(this.path(id, ".lease")); } catch { /* Already released. */ }
    }
  }
  release(owner: string): void {
    this.flush();
    for (const [key, id] of this.claims) if (JSON.parse(key)[0] === owner) {
      this.claims.delete(key);
      this.releaseLease(id);
    }
  }
  dispose(): void { for (const key of [...this.claims.keys()]) this.release(JSON.parse(key)[0]); this.flush(); }
}
