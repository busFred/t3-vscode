/** Validate only appearance edits; the bridge cannot update arbitrary VS Code settings. */
import { InterfaceFontSize, PromptFontSize, CodeFontSize } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { FONT_SIZE_KEYS, type AppearanceSettings } from "../shared/appearance.js";
import { isObject } from "../shared/bridge.js";

const FontSizeUpdate = Schema.Struct({
  fontSizeInterface: Schema.optionalKey(InterfaceFontSize),
  fontSizePrompt: Schema.optionalKey(PromptFontSize),
  fontSizeCode: Schema.optionalKey(CodeFontSize),
});
export function parseAppearanceUpdate(input: unknown): Partial<AppearanceSettings> {
  if (!isObject(input) || !Object.keys(input).length || Object.keys(input).some((key) => !FONT_SIZE_KEYS.includes(key as keyof AppearanceSettings))) {
    throw new Error("Choose a valid font-size setting.");
  }
  return Schema.decodeUnknownSync(FontSizeUpdate)(input);
}
