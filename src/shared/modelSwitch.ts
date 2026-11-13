import { REASONING_EFFORT_OPTION_IDS } from "@t3tools/client-runtime/state/thread-execution";

/**
 * A model or effort change recorded on the user message that followed it (T3 0.1.7).
 *
 * The selections on a turn item carry the wire's permissive shape: `model` is unknown, the provider
 * may appear as the legacy `provider` key, and options may be an array or a legacy object. Everything
 * here normalizes defensively so a stored message from an older server renders rather than throws.
 */
export interface ModelSwitchSelection {
  readonly model?: unknown;
  readonly instanceId?: unknown;
  readonly provider?: unknown;
  readonly options?: unknown;
}

export interface ModelSwitchSummary {
  readonly from: string;
  readonly to: string;
  /** What actually differs, so a caller can phrase the row. */
  readonly changed: "model" | "effort" | "both";
}

/**
 * Option ids that name the reasoning/effort dial. Taken from T3's own list rather than a local copy:
 * a partial list silently dropped the whole row for a provider whose dial is `reasoning`, `variant`
 * or `reasoning_effort`, because an effort-only change then looked like no change at all.
 */
const EFFORT_OPTION_IDS = REASONING_EFFORT_OPTION_IDS;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

function effortOf(selection: ModelSwitchSelection): string | undefined {
  const options = selection.options;
  if (Array.isArray(options)) {
    for (const id of EFFORT_OPTION_IDS) {
      const hit = options.find((option) => option && typeof option === "object" && (option as { id?: unknown }).id === id);
      if (hit) {
        const value = (hit as { value?: unknown }).value;
        if (value !== undefined && value !== null) return String(value);
      }
    }
    return undefined;
  }
  // Legacy object form: { reasoningEffort: "low" }.
  if (options && typeof options === "object") {
    const record = options as Record<string, unknown>;
    for (const id of EFFORT_OPTION_IDS) {
      const value = record[id];
      if (value !== undefined && value !== null) return String(value);
    }
  }
  return undefined;
}

const instanceOf = (selection: ModelSwitchSelection): string | undefined =>
  text(selection.instanceId) ?? text(selection.provider);

function label(selection: ModelSwitchSelection, name: (slug: string) => string | undefined, effort: string | undefined): string {
  const slug = text(selection.model);
  const base = (slug ? name(slug) : undefined) ?? slug ?? "Unknown model";
  return effort ? `${base} (${effort})` : base;
}

/**
 * Describe a recorded `modelSwitch`. Returns null when the two selections are equivalent, so an
 * unchanged re-send does not draw a row.
 *
 * `name` resolves a model slug to its catalog display name and may return undefined for a model the
 * server no longer advertises, in which case the slug is shown rather than the change being hidden.
 */
export function describeModelSwitch(
  from: ModelSwitchSelection | null | undefined,
  to: ModelSwitchSelection | null | undefined,
  name: (slug: string) => string | undefined = () => undefined,
): ModelSwitchSummary | null {
  if (!from || !to) return null;
  const fromEffort = effortOf(from);
  const toEffort = effortOf(to);
  // An instance change with the same slug is still a different model to the reader.
  const modelChanged = text(from.model) !== text(to.model) || instanceOf(from) !== instanceOf(to);
  const effortChanged = fromEffort !== toEffort;
  if (!modelChanged && !effortChanged) return null;
  // Only name the dial when it moved; otherwise the model names carry the row.
  return {
    from: label(from, name, effortChanged ? fromEffort ?? "default" : undefined),
    to: label(to, name, effortChanged ? toEffort ?? "default" : undefined),
    changed: modelChanged && effortChanged ? "both" : modelChanged ? "model" : "effort",
  };
}
