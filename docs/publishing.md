# Local VSIX packaging and publication history

Current owner policy: build local installers after implementation and review. Publish only the exact version and channel the owner explicitly authorizes; packaging does not grant that authority. Keep the version unchanged unless the owner explicitly requests a bump. The owner authorized the stable release upload of **0.1.16** on October 8, 2026, explicitly authorized prerelease **0.1.17** on October 9, 2026, explicitly authorized stable release-channel publication of **0.1.18** on October 10, 2026, and explicitly authorized prerelease-channel publication of **0.1.19** on October 10, 2026 (“bump version to 0.1.19 and publish to pre-release”). That authorization covers 0.1.19 on the prerelease channel only. The owner explicitly authorized prerelease-channel publication of **0.1.21** on October 12, 2026 (“publish this new version to pre-release channel”); that authorization covers 0.1.21 on the prerelease channel only and does not extend to the stable release channel. The owner explicitly authorized prerelease-channel publication of **0.1.20** on October 11, 2026 (“publish it to pre-release”); that authorization covers 0.1.20 on the prerelease channel only and does not extend to the stable release channel.

Current release checkpoint: v0.1.21 is authorized for the prerelease channel and built from `8c5f37c`. v0.1.20 was packaged from `8d3f714`, authorized for the prerelease channel and published, although its upload appeared to fail at the time; at the owner's instruction the work also moved to v0.1.21. v0.1.19 remains the newest published version. v0.1.19 was published to the Marketplace prerelease channel from `8bb923f` on October 11, 2026 (03:19 UTC); `vsce` reported success, and the public listing had not yet picked it up at the post-publish read. v0.1.18 remains on the stable release channel from `251cfec`, and prerelease 0.1.17 preceded 0.1.19 on the prerelease channel.

## Version policy

Read the version directly from `package.json`; use the same value in release notes and installer filenames. Local revisions may rebuild the same unpublished candidate version. Keep the three-number version and channel metadata unchanged unless the owner requests a change. Historical versions remain in the feature history.

## Build and review

1. Complete the requested implementation and update the changelog and linked feature history without changing the manifest version.
2. Run relevant unit, type, browser and isolated native checks; use GPT-6 Luna with low effort only when a live provider check is needed.
3. Start a regression reviewer with fresh context, resolve blockers, obtain final signoff and record the outcome in the feature history.
4. Run `pnpm package` and verify the VSIX version, publisher, channel metadata and bundled assets. Store the installer and checksum under `target-installer/`.

The packaging script reads the existing manifest and derives the prerelease flag from `preview: true`. Keep packaging separate from publication, do not bump or tag without the owner's specific request, and publish only the specifically authorized version/channel. Packaging does not authorize installation into the normal VS Code profile. T3 Code and providers remain separately installed applications.

## First public release

- Published `hungtienhuang.t3-vscode` version **0.1.12** to the prerelease channel on **October 7, 2026**, from source commit `3e9d971`.
- Made `busFred/t3-vscode` public with the owner's explicit permission and verified anonymous access to all README screenshots and development documentation.
- Passed 121 unit tests, browser checks, isolated native editor-reference checks and a fresh-context regression review before packaging.
- Installed the reviewed local VSIX successfully into disposable VS Code storage without changing the normal profile.
- VSIX SHA-256: `82c59225f4f27f29ed561c4e39e441df76f6177b00ca74c60b41637b2be495ff`.

At 04:22 UTC on October 7, the Marketplace reported version 0.1.12 with the prerelease property but had not marked it validated, and an isolated Marketplace installation still reported the extension unavailable. The local VSIX installation passed; Marketplace installation remains pending its validation and discovery update.

## 0.1.13 release-channel publication

- Published `hungtienhuang.t3-vscode` **0.1.13** to the release channel on **October 8, 2026 at 02:52 UTC**, from source commit `eaed9fe`, following the owner's release-only instruction.
- Created separate feature commits for search (`6a8bf16`), new chats (`ce2ebd5`), History (`f710323`), Markdown tools (`3dfa071`), draft recovery (`b39b925`), response display/status (`ae88a2b`), usage labeling (`3775dc0`) and onboarding (`eb9c297`).
- Passed 163 deterministic tests, per-commit TypeScript checks, both browser suites, the full build and fresh-context regression review; verified the exact package assets and installation in disposable VS Code/T3 storage.
- Confirmed the authenticated Marketplace record has no prerelease property and matches the reviewed VSIX SHA-256: `1145eecba0f40d00debc42023867e41584d81ea8dbc899dafa58dbd6f7007b35`.
- Confirmed prerelease 0.1.12 retains its version, properties, update time and package checksum; no prerelease was uploaded.
- Marketplace accepted the upload; its validation flag is still pending and the public listing has not refreshed yet, so Marketplace installation is not claimed verified.

## 0.1.14 preview-channel publication

- Published `hungtienhuang.t3-vscode` **0.1.14** to the prerelease channel on **October 8, 2026**, after the owner explicitly authorized the version increase for the Windows pairing fix.
- Reviewed the complete working changes against stable source revision `74aed3f`; the fresh-context reviewer approved the final candidate with no blocking or actionable findings before packaging.
- Passed 171 tests, TypeScript checking and the full build; the reviewer independently passed 28 focused tests and checked all 48 feature requirements.
- Confirmed the host, webview and Mermaid bundles match the earlier tested Windows revision byte for byte, preserving its two complete browser suites and real isolated Linux pairing evidence; native Windows execution remains unverified.
- Verified the 41-file universal VSIX has `preview: true`, the Marketplace prerelease property, the exact reviewed runtime/assets, 20 math fonts and three screenshots; installed it successfully into disposable user, extension, shared and T3 storage.
- Downloaded the uploaded package and confirmed SHA-256 `6bb5df730f752f82619a9ad13d1fae63753f56584618d23c6bc46914b4628b04` matches `target-installer/t3-vscode-0.1.14.vsix` exactly.
- Confirmed stable 0.1.13 retains its channel, properties, update time and package SHA-256 `1145eecba0f40d00debc42023867e41584d81ea8dbc899dafa58dbd6f7007b35`.
- At 04:17 UTC, the authenticated record lists 0.1.14 as prerelease with validation pending; the public validated catalog still lists release 0.1.13 and prerelease 0.1.12, so installation of 0.1.14 from Marketplace is not yet claimed verified.

## 0.1.15 release-channel publication

- Published `hungtienhuang.t3-vscode` **0.1.15** to the release channel on **October 8, 2026**, after the owner confirmed that 0.1.14 preview works and explicitly requested release-channel availability.
- Changed only version/channel metadata and release documentation relative to the published preview; the host, webview and Mermaid bundles are byte-identical to 0.1.14.
- Passed all 171 tests, TypeScript checking and the full build; a fresh-context reviewer independently passed 56 focused tests, inspected all 48 feature requirements and approved the final 547-file candidate with no blocking or actionable findings before packaging.
- Verified the 41-file universal VSIX uses `preview: false`, omits the prerelease property and contains the exact reviewed assets, including 20 math fonts and three screenshots; installation passed in disposable user, extension, shared and T3 storage.
- Downloaded the published release and confirmed SHA-256 `b2a4f9ef7b0058161f91b29ed8e5ccb288a2cc08fa7af3fec45caacc58b0ed72` matches `target-installer/t3-vscode-0.1.15.vsix` exactly.
- Confirmed existing 0.1.14 preview and 0.1.13 release packages retain their channels, properties, update times and exact checksums.
- At 08:34 UTC, Marketplace has accepted 0.1.15 as a normal release but validation is pending; the public validated catalog still lists 0.1.14 preview and 0.1.13 release, so Marketplace installation of 0.1.15 is not yet claimed verified.

## 0.1.16 release-channel publication

- Published the reviewed 0.1.16 VSIX to the stable release channel on October 8, 2026, following the owner's explicit request; left the version unchanged and omitted the prerelease flag.
- Confirmed the local package has `preview: false` and SHA-256 `b5951a6737e5b7da80f6db3d068d00eb73641cd987a7014a2e784b5ec856e672`; `vsce` reported successful publication.
- The metadata read at 22:55 UTC still showed stable 0.1.15 and prerelease 0.1.14; a 23:02 UTC read lists stable 0.1.16 with the exact uploaded SHA-256, followed by stable 0.1.15 and prerelease 0.1.14. Marketplace installation was not tested.
- The uploaded VSIX retains its pre-publication changelog wording (“unpublished”); the repository changelog is corrected after upload, but the uploaded version cannot be replaced without a new version.
- Scope this authorization to this exact 0.1.16 stable release; future publication still requires the owner's explicit version/channel request.

## 0.1.17 prerelease-channel publication

- Published `hungtienhuang.t3-vscode` v0.1.17 to the Marketplace prerelease channel on October 9, 2026, from clean source commit `1666397`, compared with published stable baseline `b71e129`.
- The fresh-context regression reviewer approved the final candidate with no blocking findings. The candidate contains the reviewed response-diff feature, prerelease metadata and release documentation only; later resize changes were excluded.
- Passed 200 deterministic tests, TypeScript checking, full builds and browser regression suite. Verified a 41-file VSIX with version 0.1.17, publisher `hungtienhuang`, `preview: true` and `Microsoft.VisualStudio.Code.PreRelease=true`.
- VSIX: `target-installer/t3-vscode-0.1.17-prerelease.vsix`; SHA-256: `4bcca3233309c4e6d395e044f61270c49fde2ef8a1f0fa0739fc2d3b83fef06f`. `vsce` reported successful publication.
- At 01:13 UTC on October 10, Marketplace metadata still listed stable 0.1.16 and prerelease 0.1.14; public listing propagation and validation remain pending. No Marketplace installation was attempted.

## 0.1.18 release-channel publication

- Published `hungtienhuang.t3-vscode` **0.1.18** to the stable release channel on **October 10, 2026**, from source commit `251cfec`, after the owner explicitly authorized that exact version and channel.
- Set `preview: false` (no `--pre-release`) and kept the manifest version at 0.1.18; updated the changelog and README wording so the release no longer says "unpublished".
- Passed TypeScript checking and all 204 deterministic tests; `pnpm package` produced the 41-file VSIX at `target-installer/t3-vscode-0.1.18.vsix` with version 0.1.18, publisher `hungtienhuang`, `preview: false`, no `Microsoft.VisualStudio.Code.PreRelease` property and `t3-vscode.usage.refreshIntervalSeconds` in `extension/package.json`.
- Published with `vsce publish --packagePath target-installer/t3-vscode-0.1.18.vsix`; vsce reported success.
- VSIX SHA-256: `6745637546405b2f84330a080df0428ae907529c4d311c8252cc551938078de5`, recorded in `target-installer/t3-vscode-0.1.18.vsix.sha256`.
- Post-publish Marketplace readback (`vsce show --json`) still listed prerelease 0.1.17 as the latest entry, with 0.1.16 and 0.1.15 stable; the 0.1.18 listing is not yet visible, so its listed checksum, channel and validation are not yet confirmed. Marketplace installation was not tested.

## 0.1.19 prerelease-channel publication

- The owner explicitly authorized publication of **0.1.19** to the Marketplace prerelease channel on **October 10, 2026**; the authorization does not extend to the stable release channel or to any other version.
- A third round of fresh-context regression review compared the final usage-refresh change set with published baseline `7e19b2d` and returned no blocking findings, so the candidate was cleared for packaging. The first round's two behaviour findings were fixed and confirmed by the second round; the third round covered the later reconnect and reappearing-meter handling, which the second round had not seen.
- Bumped the manifest to 0.1.19 and set `preview: true`, which is what makes `scripts/package-vsix.mjs` pass `--pre-release`.
- Corrected the `t3-vscode.usage.refreshIntervalSeconds` description before packaging, because the uploaded VSIX keeps whatever text it was built with: it now states that jitter makes the default 300 to 360 seconds, and that automatic refreshes pause while no meter is displayed. The README was rewritten separately for this release.
- The packaging script passes `--out target-installer`, so vsce names the file `t3-vscode-0.1.19.vsix` with no channel suffix, matching 0.1.18. The `-prerelease` suffix on `t3-vscode-0.1.17-prerelease.vsix` was a one-off manual copy and is not the convention.

- Published `hungtienhuang.t3-vscode` **0.1.19** to the Marketplace **prerelease** channel on **October 11, 2026** at 03:19 UTC, from clean source commit `8bb923f`, compared with published stable baseline `7e19b2d`. Published with `npx vsce publish --packagePath target-installer/t3-vscode-0.1.19.vsix`; vsce reported `DONE  Published hungtienhuang.t3-vscode v0.1.19.`
- Re-verified on the landed tree immediately before packaging: `pnpm run typecheck` clean, `pnpm test` 222/222, `pnpm run build` successful.
- Verified the packaged `extension/package.json` carries version 0.1.19, publisher `hungtienhuang` and `preview: true`, that `extension.vsixmanifest` carries `Microsoft.VisualStudio.Code.PreRelease` with value `true`, that `t3-vscode.usage.refreshIntervalSeconds` keeps default `300` with the corrected jitter and display-pause description, and that the packaged readme is the new 76-line landing page.
- VSIX: `target-installer/t3-vscode-0.1.19.vsix` (3.08 MB); SHA-256 `f7b03c21adb43d2fab3eb7c91159ef051a329b96ac547ed934f6b7297ef74765`, recorded in `target-installer/t3-vscode-0.1.19.vsix.sha256`. The 0.1.18 installer and its checksum were left untouched.
- The package holds **45 files**, not the 41 of 0.1.17 and 0.1.18. The increase is the README gallery growing from three screenshots to seven; `docs/screenshots/*.png` is in the `.vscodeignore` allowlist, so each image ships. All seven were confirmed present in the package. A count of 45 is correct for this release, not a packaging fault.
- Screenshot privacy: the owner's hostname `hungtien-p1g6l` is visible twice in `docs/screenshots/scheduled-tasks.png` — in the task editor header and in the `Time on hungtien-p1g6l` label. The owner was shown this and decided to **ship it as-is**. The image must not be recaptured, retouched or substituted on that account. No email address, token or path outside `/tmp` appears in any of the seven images, and Account & Usage is collapsed wherever the sidebar is visible.
- Post-publish Marketplace readback (`npx vsce show hungtienhuang.t3-vscode --json`) at 03:20 UTC listed versions 0.1.18, 0.1.17, 0.1.16, 0.1.15, 0.1.14, 0.1.13 and 0.1.12, with extension `lastUpdated` still `2026-10-10T18:09:33.910Z` — the 0.1.18 upload. **0.1.19 was absent from the listing**, so its listed channel, checksum and Marketplace validation are not confirmed by this read; only the publish call's success is. This matches 0.1.16, 0.1.17 and 0.1.18, whose listings all lagged their uploads. Marketplace installation was not tested.
- Listing-link caveat: `docs/user-guide.md` is not bundled in the VSIX, and vsce rewrote the readme's relative links to `https://github.com/busFred/t3-vscode/{raw,blob}/HEAD/...`. At publication `origin/main` was at `70041b1`, which predates the user guide and the four new screenshots, so until the owner pushes `4d470c2` and `8bb923f` the listing's **User guide** link resolves to a missing file, four of the seven gallery images do not load and the other three show their pre-0.1.19 captures. Publishing does not authorize a push; the owner decides.

### Known findings deliberately deferred past 0.1.19

The owner reviewed these and chose to ship as they are. None is a regression against 0.1.18: each degrades to 0.1.18's untargeted sweep or to a meter advancing no later than it used to, never to new behaviour. Changing reviewed implementation code on the eve of the prerelease would also invalidate the sign-off and require a further review round. All four are candidates for 0.1.20.

- `src/shared/usage.ts` returns `undefined` both for "no instance to target" and for "sweep every instance", so a single displayed meter whose account carries an empty `instanceIds` list makes each tick perform the untargeted sweep the fix exists to avoid. The mitigation silently does not apply in that configuration. Deferred because the result matches 0.1.18 exactly and a fix needs a distinct sentinel plus a caller change.
- `usageRefreshTarget` prefers the active conversation's own instance before the installed-and-enabled filter, so a thread bound to an uninstalled or disabled instance keeps that account's meter pinned to its last value while a live sibling exists. The second review round considered and accepted this, judging that such a thread cannot be used anyway; the third round agreed on the facts and differed only on severity. Deferred as a judgement call rather than a defect.
- `overdue()` treats a disabled periodic refresh (`intervalMs === null`, i.e. the setting at `0`) as permanently overdue, so in that configuration the busy gate does not defer the single connect refresh. Bounded to one refresh per connect, since no ticks exist when periodic refresh is off.
- Switching the single displayed meter to a different account changes the refresh target without requesting a refresh, because `setDisplayed` sees no false-to-true transition. The new account's figures then advance at the next tick instead of immediately. This is the intended cost of targeting plus the 300-second default.

## 0.1.20 prerelease-channel publication

- The owner explicitly authorized publication of **0.1.20** to the Marketplace prerelease channel on **October 11, 2026**; the authorization does not extend to the stable release channel or to any other version.
- `preview: true` carried over unchanged from 0.1.19, which is what makes `scripts/package-vsix.mjs` pass `--pre-release`; the manifest version was bumped to 0.1.20 at the owner's request and nothing else in the channel metadata changed.
- Five rounds of fresh-context regression review covered the release. They found four blocking defects, every one introduced by this change set, each fixed with a test confirmed to fail against the pre-fix code: a whole-file `@` token claiming a longer path that extended it at a `.` boundary; the quote-stripping pattern exceeding the regular-expression size limit; its line-based replacement failing to hide the readable block when a comment contained a newline; and a quote-capture change that stopped 17 of 37 real message shapes resolving a whole-message quote, which was withdrawn rather than patched because that file is a pinned port of T3 Code's reader and the divergence would have been permanent. The final round cleared the candidate with nothing blocking.
- Changelog and feature-history wording was corrected to "Alpha prerelease" **before** packaging, because the uploaded VSIX keeps whatever text it was built with and cannot be replaced without a new version.
- Known limitations shipped deliberately and recorded in the changelog: the quote chip marks an attached comment only in its tooltip; the message navigation rail still previews raw message text where search and Copy show the rendered form; search still indexes Markdown source; and two pre-existing timing flakes in `scripts/verify-response-layout.ts` and the queued-message reorder check fail roughly one run in five, at this version and at 0.1.19 alike, in code this release does not touch.

### 0.1.20 publication appeared to fail, but landed

- Attempt 1 (October 11, 2026, 23:24 UTC) reached the Marketplace and was refused by an Azure DevOps outage: `Azure DevOps Services Unavailable`, Ref A `E57DC4E4AF9D40FDB561615501583CA9`, Ref B `ATL331000106033`. `vsce` exited 1.
- A read-only `vsce show` immediately afterwards reported `lastUpdated` still at the 0.1.19 upload and no 0.1.20 entry, confirming no version number was consumed.
- Attempt 2 was blocked locally by the permission classifier before any request was sent.
- The owner then directed that subsequent work carry version 0.1.21, so 0.1.20 was treated as unpublished and its changes also ship in 0.1.21. `target-installer/t3-vscode-0.1.20.vsix` and its checksum are left in place.
- **Correction, October 13, 2026.** 0.1.20 *was* published. A readback during the 0.1.21 work lists it as prerelease with `lastUpdated` `2026-10-11T23:52:34.670Z` — 28 minutes after the upload that returned the outage page. The Marketplace had ingested the request despite the error response, and the immediate readback that showed no 0.1.20 was simply taken before the listing caught up. The lesson for this repo: an outage response is not evidence that an upload was rejected, and a readback minutes later is not evidence either, because this extension's listing has lagged every release. Only a later readback settles it. The version number was consumed; nothing was lost, because the work shipped again in 0.1.21.

## 0.1.21 prerelease-channel publication

- The owner explicitly authorized publication of **0.1.21** to the Marketplace prerelease channel on **October 12, 2026**; the authorization does not extend to the stable release channel or to any other version.
- `preview: true` carried over unchanged, which is what makes `scripts/package-vsix.mjs` pass `--pre-release`. 0.1.20 was packaged but never published — its upload hit an Azure DevOps outage and consumed no version number — so 0.1.21 carries its changes too.
- Five rounds of fresh-context regression review. They found four blocking code defects, all fixed with covering tests: a collapsed reference row's Open button was keyboard-inoperable because the row's own key handler cancelled the nested button's default action; a long reference path could not shrink, pushing that button and the chevron outside the clipped card at sidebar widths; `scripts/verify-editor-chat.mjs` queried a class the release deleted; and the sidebar and subagent card still disagreed on two run statuses, which was the defect the release set out to close. The review also corrected two documentation claims that were false as written. The final round cleared the candidate with nothing blocking.
- Changelog and feature-history wording was corrected to "Alpha prerelease" **before** packaging, because the uploaded VSIX keeps whatever text it was built with and cannot be replaced without a new version.
- Not run here, and checked by inspection only because they need a real VS Code launch: `verify-editor-chat.mjs`, `verify-rich-chat.mjs` and `capture-readme.mjs`. All three had selectors updated this release, and one of them held a blocking defect that only inspection caught.
- Known limitations shipped deliberately and recorded in the changelog: undoing a pasted reference leaves its attachment in the draft; removing a chip clears undo history; and `scripts/verify-response-layout.ts` fails roughly four runs in fifteen on a pre-existing transcript-scroll race, measured identically on an unmodified build.

- Published `hungtienhuang.t3-vscode` **0.1.21** to the Marketplace **prerelease** channel on **October 13, 2026** from clean source commit `ecafc91`, with `npx vsce publish --packagePath target-installer/t3-vscode-0.1.21.vsix`; `vsce` reported `DONE  Published hungtienhuang.t3-vscode v0.1.21.`
- VSIX: `target-installer/t3-vscode-0.1.21.vsix` (3.09 MB, 45 files); SHA-256 `ac5d1f364ffa1fad0cfb257a75d90b12dc58faa68e4a9dc7b00cd354d5394507`, recorded in `target-installer/t3-vscode-0.1.21.vsix.sha256`. Verified before upload: version 0.1.21, publisher `hungtienhuang`, `preview: true`, the `Microsoft.VisualStudio.Code.PreRelease` property, `t3-vscode.usage.refreshIntervalSeconds` default 600, the `t3-vscode.refreshUsage` command, and a bundled changelog reading "Alpha prerelease".
- Post-publish readback at 02:50 UTC listed 0.1.20 and older with extension `lastUpdated` `2026-10-11T23:52:34.673Z`; **0.1.21 was absent**, so its listed channel, checksum and validation are not confirmed by that read — only the publish call's success is. Given the 0.1.20 correction above, absence from an early readback means nothing either way for this extension. Marketplace installation was not tested.


## 0.2.0 prerelease-channel publication

- The owner explicitly authorized publication of **0.2.0** to the Marketplace prerelease channel; the authorization does not extend to stable publication or another version. Keep the manifest version unchanged.
- The existing `target-installer/t3-vscode-0.2.0.vsix` is the reviewed stable-metadata artifact and remains unchanged. Prepare a separate prerelease VSIX with `preview: true` and `vsce --pre-release`; verify its runtime files match the reviewed artifact before upload.
- Prior final approval and verification covered the implementation: 377 deterministic tests, TypeScript, full build, three browser suites and isolated Linux VS Code checks. A fresh-context reviewer checks the channel-only metadata/documentation delta before packaging.
- Fresh-context review approved the metadata/documentation delta with no blockers: all 590 snapshotted source files were unchanged, the version remained 0.2.0, and all 25 distribution files matched the preserved stable artifact. Prior implementation verification remains 377 deterministic tests, TypeScript, full build, three browser suites and isolated Linux VS Code checks.
- Packaged `target-installer/t3-vscode-0.2.0-prerelease.vsix` with `preview: true` and the `Microsoft.VisualStudio.Code.PreRelease` property; ZIP integrity passed and all 31 bundled distribution/resource/vendor assets matched the stable VSIX byte-for-byte. SHA-256: `107e71aba85f7b10e4ca890af30a3f026d08bae92413bd8f5d3480d569bb865b`, recorded in the adjacent `.sha256` file. The original stable artifact remains unchanged at SHA-256 `b4df021acc38e20ec6ac5b0778a27babb0d462765f23f1373cae38bc01f78110`.
- `vsce publish --packagePath target-installer/t3-vscode-0.2.0-prerelease.vsix --pre-release` reported `DONE Published hungtienhuang.t3-vscode v0.2.0.` The one public Marketplace listing readback on October 18, 2026 still showed stable 0.1.23 and prerelease 0.1.21; 0.2.0 was absent, so upload acceptance is confirmed but public indexing/propagation is pending. Marketplace installation was not tested.

## 0.2.1 prerelease-channel publication

- The owner explicitly authorized publishing **0.2.1** to the Marketplace prerelease channel. A fresh-context regression review approved the version-only candidate against `cfb695d` with no findings; the reviewer confirmed runtime identity, and the review approval is recorded in the feature history. The version and release notes were committed as `029b82c`.
- `pnpm package` completed and created `target-installer/t3-vscode-0.2.1.vsix`. Its dependency preflight reported that the pnpm store lock was read-only, then continued without the lock; the build and packaging script completed successfully.
- ZIP integrity passed. Verified version `0.2.1`, publisher `hungtienhuang`, `preview: true`, and `Microsoft.VisualStudio.Code.PreRelease=true`. All 31 bundled `dist/`, `resources/` and `vendor/` assets match `target-installer/t3-vscode-0.2.0-worktree-fixes.vsix` byte-for-byte. SHA-256: `dc28bf7be0d81e052d59c62577492c978a49710bca0843dce785e6eacc733672`, recorded in the adjacent `.sha256` file.
- `vsce publish --packagePath target-installer/t3-vscode-0.2.1.vsix --pre-release` reported `DONE Published hungtienhuang.t3-vscode v0.2.1.` The one public listing readback on October 18, 2026, at approximately 23:18 UTC still listed 0.2.0 as its newest version, with the SHA-256 of the 0.2.0 prerelease package; 0.2.1 was absent. Upload acceptance is confirmed, while public indexing and availability remain pending. Marketplace installation was not tested.
