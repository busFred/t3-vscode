# Context window meter — placement options

Design mockup, not current behaviour. **Option A was chosen and implemented** (ring + percent in the composer toolbar, immediately left of "List assist"); see [Context window meter](../feature-history.md#context-window-meter) in the feature history.

Mockup: [context-meter-options.html](context-meter-options.html)

## Data availability

- The schema already exists: `OrchestrationV2ProviderTurnTokenUsage` at `vendor/contracts/src/orchestrationV2.ts:933` has `usedTokens`, `maxTokens`, `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningOutputTokens`, `updatedAt`. It's attached as `tokenUsage` on `OrchestrationV2ProviderTurn` (`vendor/contracts/src/orchestrationV2.ts:963`).
- `vendor/client-runtime` already projects it: `orchestrationV2Projection.ts:234-241` merges `event.payload.tokenUsage` onto the matching provider turn in the `providerTurns` projection on every `provider-turn.updated` event — so the client-runtime's in-memory thread state carries live usage per turn.
- **The VS Code extension does not receive or surface this field at all.** `grep` for `tokenUsage` / `usedTokens` / `contextWindow` across `src/host/*` and `src/shared/*` returns nothing. `HostStateSnapshot` (`src/shared/bridge.ts`) has no token-usage field, and `src/host/t3Client.ts` / `hostState.ts` never read `providerTurns[].tokenUsage` off the client-runtime projection they already consume.
- Reference implementation: `apps/web/src/components/chat/ContextWindowMeter.tsx` (ring + popover, used by `ChatComposer.tsx`) and its logic in `ContextWindowMeter.logic.ts` — ring turns red past 90%, uses a `ContextWindowSnapshot` (`usedTokens`, `maxTokens`, `usedPercentage`, `totalProcessedTokens`, `cost`, `compactsAutomatically`) built from `~/lib/contextWindow.ts`.
- **Conclusion: a new bridge field is required.** The extension needs to (a) read the latest `tokenUsage` off the active thread's most recent `providerTurn` in the client-runtime projection, (b) add it to `HostStateSnapshot`, and (c) send it to the webview — none of that plumbing exists today. This is shared infrastructure for every option below; it is not specific to any one placement.

## Options (HTML mockup renders each in the extension's real composer, light and dark, at 18% / 62% / 91%)

| | Placement | Best for |
|---|---|---|
| **A — Toolbar ring** | Ring + percent in the formatting toolbar, immediately left of "List assist". Closest to T3 Code's upper-right meter. | Parity with T3 Code; zero layout cost. |
| **B — Top-edge bar** | 3px bar along the composer box's top border, token label in the toolbar's right slack. | Maximum at-a-glance visibility; scales with the narrow sidebar. |
| **C — Trait chip** | Chip after the "Root" worktree trait in the controls row; click toggles percent / tokens. | Cheapest UI, but collapses into the "…" overflow on narrow sidebars. |
| **D — Send-hint meter + status bar** | Mini bar beside the "Enter to send" hint, mirrored by a VS Code status bar item next to the usage item. | Visibility when the chat pane is hidden; most moving parts. |

## Recommendation

**Option A**, with **Option B** as the fallback if usability testing shows the hidden-until-threshold ring is too easy to miss — A matches the existing T3 Code mental model for users who already use the web/desktop app, costs the least layout space, and only requires the one shared bridge-field addition that every option needs anyway, with no second host-side surface (status bar) or footer-row crowding (C, D) to maintain.
