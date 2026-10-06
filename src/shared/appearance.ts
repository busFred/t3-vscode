/** T3's font-size preferences and bounds, shared by the host and renderer. */
import {
  DEFAULT_INTERFACE_FONT_SIZE, MIN_INTERFACE_FONT_SIZE, MAX_INTERFACE_FONT_SIZE,
  DEFAULT_PROMPT_FONT_SIZE, MIN_PROMPT_FONT_SIZE, MAX_PROMPT_FONT_SIZE,
  DEFAULT_CODE_FONT_SIZE, MIN_CODE_FONT_SIZE, MAX_CODE_FONT_SIZE,
} from "@t3tools/contracts";

export interface AppearanceSettings {
  readonly fontSizeInterface: number;
  readonly fontSizePrompt: number;
  readonly fontSizeCode: number;
}
export const FONT_SIZE_OPTIONS = {
  fontSizeInterface: { label: "Interface font size", description: "Chat text, navigation and labels.", min: MIN_INTERFACE_FONT_SIZE, max: MAX_INTERFACE_FONT_SIZE, default: DEFAULT_INTERFACE_FONT_SIZE },
  fontSizePrompt: { label: "Prompt font size", description: "Only the message box you type in.", min: MIN_PROMPT_FONT_SIZE, max: MAX_PROMPT_FONT_SIZE, default: DEFAULT_PROMPT_FONT_SIZE },
  fontSizeCode: { label: "Code font size", description: "Code blocks, diffs and tool output.", min: MIN_CODE_FONT_SIZE, max: MAX_CODE_FONT_SIZE, default: DEFAULT_CODE_FONT_SIZE },
} as const;
export const FONT_SIZE_KEYS = Object.keys(FONT_SIZE_OPTIONS) as Array<keyof AppearanceSettings>;
export const DEFAULT_APPEARANCE: AppearanceSettings = Object.freeze({
  fontSizeInterface: DEFAULT_INTERFACE_FONT_SIZE, fontSizePrompt: DEFAULT_PROMPT_FONT_SIZE, fontSizeCode: DEFAULT_CODE_FONT_SIZE,
});

/** Match T3's rounding/clamping for settings edited outside the in-app controls. */
export function resolveAppearance(input: Partial<Record<keyof AppearanceSettings, unknown>>): AppearanceSettings {
  const size = (key: keyof AppearanceSettings) => {
    const value = input[key]; const options = FONT_SIZE_OPTIONS[key];
    return typeof value === "number" && Number.isFinite(value)
      ? Math.min(options.max, Math.max(options.min, Math.round(value))) : options.default;
  };
  return { fontSizeInterface: size("fontSizeInterface"), fontSizePrompt: size("fontSizePrompt"), fontSizeCode: size("fontSizeCode") };
}
