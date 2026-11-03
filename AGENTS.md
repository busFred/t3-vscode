# T3 VSCode development

- Keep [docs/feature-history.md](docs/feature-history.md) current whenever a feature is introduced, changed or removed. Maintain its linked overview table and add concise versioned entries under the affected feature; verify historical release versions from Git rather than guessing.
- **Protected behavior: native undo in the composer.** Ctrl+Z/Ctrl+Y after typing, pasting an image (real OS clipboard), quoting a conversation (first and repeated) and adding an editor reference must each undo/redo exactly one step, in a new chat tab and in a session tab opened from Sessions. It has regressed repeatedly (v0.1.21, v0.2.4, and again until v0.3.10) because browser harnesses cannot reproduce VS Code's `execCommand('paste')` and key routing. Rules:
  - `pnpm package` refuses to build unless `node scripts/verify-edh.mjs --base-dir <isolated-home> --undo-only` passed in real VS Code on the exact current source (`scripts/nativeUndoGate.mjs`). Never bypass it; only the owner may waive it (`T3_VSCODE_NATIVE_UNDO_WAIVER="<reason>"`), and a waiver goes in the release notes.
  - Any change to composer text, insertion, paste, drop, clipboard, quotes, references, draft sync, key handling or the webview bridge must keep `scripts/verify-native-undo.mjs`, `scripts/verify-composer-undo.ts` and the paste-undo check in `scripts/verify-ui.mjs` passing. Never weaken or delete those checks; extend them when a new insertion path is added.
  - Every regression review must explicitly check native undo for the changed code.
- Before creating any VSIX, launch a separate regression-review agent with fresh context (`fork_turns: "none"`). Give it the repository, comparison revision, scope and existing feature requirements; ask it to check for accidental regressions independently.
- Resolve blocking review findings, run relevant verification, and obtain the agent's review of the final changes before packaging. Record the review and validation outcome in the release notes or feature history.
- Build installers under `target-installer/`; packaging does not authorize installation into the user's normal VS Code profile.
- Build VSIX installers for completed implementation work. Publish only when the owner explicitly authorizes the specific version and channel; packaging is not authorization. Keep the manifest version unchanged until the owner explicitly requests a version change.
- For every published version, create an annotated Git tag `vX.Y.Z` on the exact source commit and a GitHub release (prerelease for the prerelease channel) with the VSIX and its checksum attached; see [docs/publishing.md](docs/publishing.md).
- Keep implementation changes in this extension repository; do not modify the T3 Code application.
- All native VS Code tests must isolate user data, extensions and shared data. All T3 verification must use an explicitly isolated home; never mutate the user's normal T3 state or VS Code extension catalogs.
- Use an inexpensive advertised model for live provider tests, currently GPT-6 Luna with low effort. Test scripts accept `T3_VSCODE_TEST_MODEL` for an explicit alternative and must fail rather than silently falling back to a premium model; deterministic fixtures do not call a model.

## Response style

Follow the below guidelines when responding in chat:
* Be direct and concise.
* Prefer bullets over paragraphs.
* Use tables when they improve clarity or comparison.
* Keep unavoidable paragraphs brief.
* Do not restate the request or add unnecessary background.
* Include only information needed to act or decide.
* Optimize for low cognitive load and minimal context-window usage.
