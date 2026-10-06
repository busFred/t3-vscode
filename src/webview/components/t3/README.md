# Portable T3 components

These components were copied from `apps/web/src/components/` in T3 Code at
`7812230572f2d7e042d8d14ada2381fc71377560`:

- `WorkLog.tsx`: tool/work rows and their expanded details.
- `ComposerPendingApprovalPanel.tsx`: pending approval presentation.
- `TimelineSystemDivider.tsx`: system-event rows.
- `T3Wordmark.tsx`: upstream wordmark.

Portable helpers from the same revision also retain the upstream algorithms:

- `assistantTextSelection.ts` from `apps/web/src/lib/`: rendered text ranges,
  normalized positions and source matching for assistant citations.
- `selectionActions.ts` from `apps/web/src/lib/`: mouse and keyboard selection
  gestures, dismissal and toolbar positioning.
- `modelPickerSearch.ts` from `apps/web/src/components/chat/`: fuzzy model search
  by provider instance, driver and model name, with favorite ranking.

Imports use the local `cn` helper and vendored request types. The system divider
uses a native title in place of T3's tooltip dependency. Surrounding components
adapt T3's chat layout and turn-item presentation to host snapshots and VS Code
intents. Light/dark palette values in `styles/tokens.css` come from
`vendor/shared/src/themePalettes.ts`.

T3 source is MIT-licensed; retain [the notice](../../../../vendor/LICENSE.t3code)
when distributing it. The local T3 reference repository is not modified.
