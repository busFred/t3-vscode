import * as Schema from "effect/Schema";
import { AssistantCitation } from "@t3tools/contracts";
import type { ComposerContext } from "./composerContext.js";
import { isObject } from "./bridge.js";

export interface ViewDraft { readonly text: string; readonly contexts: ReadonlyArray<ComposerContext> }
export interface DraftTransfer { readonly draftKey: string; readonly draft: ViewDraft }
export function parseDraftTransfer(raw: unknown, expectedKey: string): DraftTransfer | undefined {
  if (!isObject(raw) || raw.draft === undefined) return undefined;
  if (raw.draftKey !== expectedKey) throw new Error("The conversation changed before its draft could be copied. Try opening it again.");
  if (!isObject(raw.draft) || typeof raw.draft.text !== "string" || !Array.isArray(raw.draft.contexts)) throw new Error("Invalid conversation draft.");
  const contexts = raw.draft.contexts.map((context): ComposerContext => {
    if (!isObject(context)) throw new Error("Invalid draft context.");
    if (context.type === "assistant") return { type: "assistant", citation: Schema.decodeUnknownSync(AssistantCitation)(context.citation) };
    const position = (raw: unknown) => isObject(raw) && Number.isInteger(raw.line) && Number(raw.line) > 0 && Number.isInteger(raw.column) && Number(raw.column) > 0;
    if (context.type !== "file" || ![context.uri, context.path, context.label, context.text].every((value) => typeof value === "string") || !isObject(context.range) || !position(context.range.start) || !position(context.range.end)) throw new Error("Invalid file reference in draft.");
    return context as unknown as ComposerContext;
  });
  return { draftKey: expectedKey, draft: { text: raw.draft.text, contexts } };
}
