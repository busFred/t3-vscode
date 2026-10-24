# Local VSIX packaging and publication history

Current owner policy: build local installers after implementation and review. Publish only the exact version and channel the owner explicitly authorizes; packaging does not grant that authority. Keep the version unchanged unless the owner explicitly requests a bump. The owner authorized the stable release upload of **0.1.16** on October 8, 2026, explicitly authorized prerelease **0.1.17** on October 9, 2026, explicitly authorized stable release-channel publication of **0.1.18** on October 10, 2026, and explicitly authorized prerelease-channel publication of **0.1.19** on October 10, 2026 (“bump version to 0.1.19 and publish to pre-release”). That authorization covers 0.1.19 on the prerelease channel only. The owner explicitly authorized prerelease-channel publication of **0.1.21** on October 12, 2026 (“publish this new version to pre-release channel”); that authorization covers 0.1.21 on the prerelease channel only and does not extend to the stable release channel. The owner explicitly authorized prerelease-channel publication of **0.1.20** on October 11, 2026 (“publish it to pre-release”); that authorization covers 0.1.20 on the prerelease channel only and does not extend to the stable release channel.

Current release checkpoint: v0.3.2 is published to the prerelease channel from `cd9f622` (October 24, 2026); v0.2.7 remains the stable release from `dc775df`. Earlier checkpoints are recorded in the sections below.

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

## 0.2.2 prerelease-channel publication

- The owner explicitly authorized publishing the current tree as the next available version on the Marketplace prerelease channel ("publish our current latest to the next available version number as pre-release"); the next version after 0.2.1 is **0.2.2**. That authorization covers 0.2.2 on the prerelease channel only.
- Source commit `8b02ae4` on `feat/worktrees-from-main` (first commit after `0ec8b69`). Validation: TypeScript, 442 deterministic tests and the full production build. A fresh-context regression review against v0.2.1 found two blocking defects, both fixed with tests; a second fresh-context review covered the fixes and found nothing blocking.
- `pnpm package` built `target-installer/t3-vscode-0.2.2.vsix` (45 files, 3.17 MB). Verified version `0.2.2`, `preview: true`, `Microsoft.VisualStudio.Code.PreRelease=true` and ZIP integrity. SHA-256: `7c411431e37630aa3db8f71d08eea64b3a2a0e5dd4dec546e696e436af5cdc68`.
- `vsce publish --packagePath target-installer/t3-vscode-0.2.2.vsix --pre-release` reported `DONE Published hungtienhuang.t3-vscode v0.2.2.` on October 22, 2026 at 05:34 UTC. The public listing can take a few minutes to update after acceptance.

## 0.2.3 release-channel publication

- Owner explicitly authorized version **0.2.3** on the stable release channel. Comparison revision: `8cf4892` (0.2.2 publication record).
- Fresh-context GPT-6.1 Sol regression review approved the final changes with no blockers. TypeScript, 443 deterministic tests and the full production build passed; no live provider or normal-profile installation was performed.
- A separate fresh-context Sonnet regression review of the same tree approved it with no blockers. Its one actionable finding (an account reporting only model-specific weeks showed "Usage unavailable" in the status bar) was fixed with a test, and the reviewer approved that follow-up delta before the VSIX was built. The `dist/webview.js` in the VSIX contains that fix.
- Built `target-installer/t3-vscode-0.2.3.vsix` (45 files, 3.17 MB). Verified ZIP integrity, publisher `hungtienhuang`, version `0.2.3`, `preview: false`, absence of the prerelease property, and exact bundled distribution/resource/vendor assets. SHA-256: `a89e77d4a2d3ca37182ebecdb8341385f3d4dff5af9d53ec18b771b315ee0ec6` (adjacent sidecar).
- On October 22, 2026, `pnpm exec vsce publish --packagePath target-installer/t3-vscode-0.2.3.vsix` reported `DONE Published hungtienhuang.t3-vscode v0.2.3.` after retrying outside restricted network access. Immediate public readback still listed 0.2.2 as newest, so public indexing/validation remains pending.

## 0.2.4 release-channel publication

- Owner explicitly authorized version **0.2.4** on the stable release channel. Comparison revision: `ff784d0` (0.2.3).
- Fresh-context Sonnet regression reviews of `da36d14` and `9238e95` found blocking issues that were fixed and re-reviewed; final sign-off with no blockers. A fresh-context Haiku review approved the version and release-notes delta. TypeScript, 452 deterministic tests, the full production build and `verify-views.ts` passed; native undo was verified in an isolated VS Code 1.143 profile against an isolated server, with no live provider turn and no normal-profile installation.
- Built `target-installer/t3-vscode-0.2.4.vsix` (45 files, 3.17 MB) from `c7085f4`. Verified ZIP integrity, version `0.2.4` and the absence of the prerelease property. SHA-256: `9f4a44f8e4f6ed17240ebf6ef39d674460282806291b2220cd628f116bc9d823`.
- On October 22, 2026 (19:26 UTC), `pnpm exec vsce publish --packagePath target-installer/t3-vscode-0.2.4.vsix` reported `DONE Published hungtienhuang.t3-vscode v0.2.4.` Immediate `vsce show` readback still listed 0.2.3 as newest, so public indexing remained pending.

## 0.2.5 release-channel publication

- Owner explicitly authorized building the next available version and publishing it to the Marketplace stable release channel on October 23, 2026; the Marketplace's newest version was 0.2.4, so that is **0.2.5**. The authorization covers 0.2.5 on the stable channel only. Comparison revision: `a9d036d` (0.2.4 publication record).
- Scope: T3 `request_secret` support (secret card, `secrets.answerRequest`) and an "Unsupported item (type …)" placeholder for unknown transcript item types. Source commit `fd6c52a`, fast-forwarded into `main` and pushed with `feat/worktrees-from-main`.
- Two fresh-context Sonnet regression reviews: the first (secret request) found no blockers, and two minor findings were fixed; the final review of the whole candidate returned APPROVE with no blockers. TypeScript, 462 deterministic tests and the full production build passed. Live verification against the real T3 0.1.1 server in an isolated home with GPT-6 Luna (low effort) passed via `scripts/verify-secret-request.ts`.
- Built `target-installer/t3-vscode-0.2.5.vsix` (45 files, 3.17 MB). Verified ZIP integrity, version `0.2.5`, publisher `hungtienhuang`, `preview: false`, absence of the prerelease property, the new code in `dist/extension.mjs` and `dist/webview.js`, and that the verification script is not packaged. SHA-256: `f07837c3198872101068195b9655f8f0c7d7e7b1d320197116b8f0f18d36d2b3` (adjacent sidecar).
- On October 23, 2026 (19:42 UTC), `pnpm exec vsce publish --packagePath target-installer/t3-vscode-0.2.5.vsix` reported `DONE Published hungtienhuang.t3-vscode v0.2.5.` Immediate `vsce show` readback still listed 0.2.4 as newest, so public indexing is pending. No Marketplace installation was attempted.

## 0.2.6 release-channel publication

- On October 23, 2026, the owner bumped the version to **0.2.6** and then explicitly authorized publishing it to the Microsoft Marketplace (“publish to ms store but not open vsx”). It went to the stable release channel, the channel of 0.2.3–0.2.5 and the channel the installer was built for (`preview: false`, no prerelease property). Open VSX was explicitly excluded; the extension and its `hungtienhuang` namespace do not exist there. Comparison revision: `5f6a63f` (0.2.5 publication record).
- Scope: per-session branch policy for worktree checkouts that change branch (Follow the checkout by default, or Keep the session branch), plus UI verification fixture repairs. Source commit `d7b390b` on `feat/session-branch-policy`; not yet merged into `main` at publication.
- Fresh-context Sonnet regression review returned no blockers and approved the final changes on re-review. TypeScript, 468 deterministic tests, the full production build and both browser UI verification scripts passed. The suite and build were also rerun on Node 24.22.1 with pnpm 11.28.8 before publication. No live provider test was run; deterministic fixtures do not call a model.
- Built `target-installer/t3-vscode-0.2.6.vsix` (45 files, 3.18 MB). Before upload, the adjacent SHA-256 sidecar verified `c95f4864aa6fb220e85fcf1201582ba6876c270fc22937f72ae6fe2a0ee34e09`, and the packaged manifest showed version 0.2.6, publisher `hungtienhuang` and no prerelease flag.
- On October 24, 2026 (00:03 UTC), `vsce publish --packagePath target-installer/t3-vscode-0.2.6.vsix` (vsce 4.0.0) reported `DONE Published hungtienhuang.t3-vscode v0.2.6.` Immediate `vsce show` readback still listed 0.2.5 as newest, so public indexing is pending. No Marketplace installation was attempted.

## 0.2.7 release-channel publication

- Owner explicitly authorized commit, push and publication of **0.2.7** to the stable release channel on October 24, 2026. Version 0.2.6 had already been published from another machine (`31296db`), so this change was merged onto it and bumped to 0.2.7. Comparison revision: `31296db`. Source commit `dc775df`, pushed to `main`.
- Scope: the effort selector in the composer and scheduled task editor labels the server-advertised default level "(Default)", also on the closed control by owner choice.
- Fresh-context Sonnet regression reviews of the change and of the merged candidate: APPROVE, no blockers. TypeScript and 469 deterministic tests passed; `scripts/verify-views.ts` passed on the pre-merge tree. Native/e2e scripts were not rerun after the merge.
- Built `target-installer/t3-vscode-0.2.7.vsix` (45 files, 3.18 MB): version `0.2.7`, `preview: false`. SHA-256: `42646ee33772a6fd211686e32647e41f1f8148ae54aaa6f96d28cf1e11de4669`.
- On October 24, 2026 (05:13 UTC), `pnpm exec vsce publish --packagePath target-installer/t3-vscode-0.2.7.vsix` reported `DONE Published hungtienhuang.t3-vscode v0.2.7.` No Marketplace installation was attempted.

## 0.3.0 prerelease-channel publication

- The owner explicitly requested the 0.3.0 version for the multi-environment change and, on October 24, 2026, authorized merging to `main`, per-feature commits, a push and publication "as preview". The authorization covers 0.3.0 on the prerelease channel only. Comparison revision: `842e482` (v0.2.7). Source commit: `f9ffb9b`, pushed to `origin/main`.
- Scope: remote environments. Pair other machines' T3 servers from a pairing link; their sessions for the same Git repository appear in Sessions and can be read, answered and managed. Remote sessions cannot yet start new sessions, use checkout actions or saved-turn diffs, or restore files. Local behaviour is unchanged.
- Fresh-context Opus regression review against `842e482`: no blocking regressions. All six non-blocking findings were fixed and confirmed in a second review. TypeScript and 511 deterministic tests passed. `scripts/verify-multi-environment.ts` passed 13/13 deterministic checks and 14/14 with the GPT-6 Luna low-effort live turn.
- Set `preview: true` with the bump, so `scripts/package-vsix.mjs` passes `--pre-release`. Built `target-installer/t3-vscode-0.3.0.vsix` (45 files, 3.19 MB) from the clean commit. The packaged manifest has version `0.3.0`, publisher `hungtienhuang` and `preview: true`, and `extension.vsixmanifest` has `PreRelease` `true`. SHA-256: `d1593033359e31c155439b5eeaba7c39bed87cbf5505a8314d8324a8f74fb604`.
- On October 24, 2026 (about 07:10 UTC), `pnpm exec vsce publish --packagePath target-installer/t3-vscode-0.3.0.vsix` reported `DONE Published hungtienhuang.t3-vscode v0.3.0.` An immediate `vsce show` readback listed 0.2.7 as the latest version. This listing lag matches earlier uploads, so the listed channel is not yet confirmed by readback. No Marketplace installation was attempted.

## 0.3.2 prerelease-channel publication

- On October 24, 2026, the owner asked to publish "to the next available version number" and chose the prerelease channel, with commits per feature pushed to `main`. The Marketplace listed 0.3.1 as its latest version, so 0.3.2 was chosen. The authorization covers 0.3.2 on the prerelease channel only. Comparison revision: `d3fa97f` (v0.3.1). Source commit: `cd9f622`, pushed to `origin/main`.
- Scope:
  - Long conversations no longer drop the T3 connection while loading earlier messages, and loaded history survives a reconnect.
  - The image preview gains zoom, pan and Copy image.
  - Composer copy/cut keeps attached images across tabs and into other apps.
- Review and checks: a fresh-context Opus regression review blocked on two findings (encoder keyed by view id; untrusted clipboard HTML adding hidden contexts). Both were fixed, and its re-review returned APPROVE WITH NITS. On `cd9f622`: typecheck clean, 574/574 unit tests, `pnpm build`, and `scripts/verify-views.ts` 16/16 PASS. Not exercised in a live VS Code window.
- Built `target-installer/t3-vscode-0.3.2.vsix` from the clean commit. The packaged manifest has version `0.3.2`, publisher `hungtienhuang` and `preview: true`, and `extension.vsixmanifest` has `PreRelease` `true`. SHA-256: `cc7fca9736ef1c8bf2f5b1a9848a2d877851abb173d6cf6ea1db95e71f626886`.
- At 19:39 UTC, `pnpm exec vsce publish --packagePath target-installer/t3-vscode-0.3.2.vsix` reported `DONE Published hungtienhuang.t3-vscode v0.3.2.` The Marketplace package endpoint then served 0.3.2 with the same SHA-256 (after gzip decoding) and `preview: true`. The extension query still listed 0.3.1 as latest immediately afterwards, so listing refresh was pending. No Marketplace installation was attempted.

## 0.3.1 prerelease-channel publication

- On October 24, 2026, the owner asked to commit per feature, merge to `main` and publish a prerelease "with the next available version number". The Marketplace listed 0.3.0 as its latest version and 0.3.1 was unused, so 0.3.1 was chosen. The authorization covers 0.3.1 on the prerelease channel only. Comparison revision: `0c85077` (v0.3.0). Source commit: `549d871`, fast-forwarded onto `main` and pushed to `origin/main`.
- Scope:
  - Add Environment from Pairing Link and Manage Environments in the sidebar "…" menu.
  - A foldable Environments section with one status dot, plus expiry, revocation and ignore handling.
  - Provider subagents show Working while they run.
  - Running and Past subagent groups, with Failed and Stopped markers.
- Fresh-context Opus regression reviews of both feature sets reported no blocking regressions. All findings were fixed and re-reviewed. TypeScript and 549 deterministic tests passed. `scripts/verify-multi-environment.ts` passed 13/13 for the Environments changes. The Environments section was captured in a real isolated VS Code window. The subagent changes are covered by unit tests only; a live provider-subagent run was not repeated.
- Built `target-installer/t3-vscode-0.3.1.vsix` from the clean commit. The packaged manifest has version `0.3.1`, publisher `hungtienhuang` and `preview: true`, and `extension.vsixmanifest` has `PreRelease` `true`. SHA-256: `4d4e19f14856abaf69a7dfbf6ac5c820869856c51cec6f42ba0bb94caa47ebcf`.
- At 09:45 UTC, `pnpm exec vsce publish --packagePath target-installer/t3-vscode-0.3.1.vsix` reported `DONE Published hungtienhuang.t3-vscode v0.3.1.` The Marketplace package endpoint then served 0.3.1 with the same SHA-256 and `PreRelease` `true`. No Marketplace installation was attempted.
