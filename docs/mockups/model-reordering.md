# Model reordering — proposed layout

Status: implemented in the v0.1.16 source revision; installer pending task configuration and combined review. The HTML remains a design reference.

Open [the interactive mockup](model-reordering.html) in a browser. Model names and counts are sample data; changes stay in memory.

- In **Manage models**, replace the two arrow buttons with a six-dot grip at the left of each row. Keep favorites and visibility on the right; model names gain space.
- Drag only from the grip. Show a dimmed original row, a floating preview and a blue insertion line. Apply the order on drop, within the same provider. Escape cancels.
- Hidden and legacy models retain their grip, favorite control and visibility checkbox. Reordering does not change visibility, favorites or the selected conversation model.
- Keyboard alternative: focus the grip and use **Alt+Up/Down**. Keep focus on the moved grip and announce its new position.
- Disable reordering while search or the Favorites filter shows a partial list; explain how to return to the complete provider order. All providers still allows reordering within each group.
- **Done** returns to the normal picker with the new order. Grips and visibility controls disappear there. Keep a short note that preferences are saved in VS Code; there is no T3 Web import entry.

Implementation: persist complete provider-instance orders with stale-order validation. Preserve confirmed preferences on failed saves, synchronize views, and cancel on catalog/filter changes, Escape, pointer cancellation or closure. Pointer capture supports touch and scroll-edge movement. Deterministic persistence tests and the complete multi-view browser suite pass, including pointer/touch drag, keyboard focus, cancellation, search guards and unchanged visibility/drafts.

Validation: previewed at 448px in the inline HTML renderer; checked pointer and touch drag, Alt+arrow reordering with retained focus, Escape cancellation, provider boundaries, reset, search/Favorites guards and the normal picker in a temporary Chromium profile. Confirmed unchanged favorites, visibility and selection after reordering, a visible insertion line, and responsive 728px light/360px dark layouts together with the session mockup. No browser errors, T3 state access or provider calls.
