# Local VSIX packaging and publication history

Current owner policy: build local installers after implementation and review, **never publish them**, and **do not change the version unless the owner explicitly requests it**. The manifest remains **0.1.16**. Earlier publication approvals recorded below are historical and do not authorize another upload.

Current packaging checkpoint: wait until task configuration has been implemented. The session activity and model drag layouts are design mockups; no installer containing those proposed features has been built yet.

## Version policy

Read the version directly from `package.json`; use the same value in release notes and installer filenames. Local revisions may rebuild the same unpublished candidate version. Keep the three-number version and channel metadata unchanged unless the owner requests a change. Historical versions remain in the feature history.

## Build and review

1. Complete the requested implementation and update the changelog and linked feature history without changing the manifest version.
2. Run relevant unit, type, browser and isolated native checks; use GPT-6 Luna with low effort only when a live provider check is needed.
3. Start a regression reviewer with fresh context, resolve blockers, obtain final signoff and record the outcome in the feature history.
4. Run `pnpm package` and verify the VSIX version, publisher, channel metadata and bundled assets. Store the installer and checksum under `target-installer/`.

The packaging script reads the existing manifest and derives the prerelease flag from `preview: true`. Do not run publishing, version-bump, tagging or release-upload commands. Packaging does not authorize installation into the normal VS Code profile. T3 Code and providers remain separately installed applications.

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
