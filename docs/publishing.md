# Publishing T3 VSCode

The current candidate is **0.1.13 (Alpha)** for the [Marketplace release channel](https://marketplace.visualstudio.com/items?itemName=hungtienhuang.t3-vscode). The owner authorized release-only publication; do not upload a new prerelease. The preceding published version is 0.1.12 on the prerelease channel. Future publishing requires the owner’s explicit permission; building a VSIX does not authorize publication or installation.

## Version policy

Use one version everywhere: **0.1.13**, read directly from `package.json`. README headings, release notes, VSIX filenames and the Marketplace all use that same value; there is no separate release label or encoded version.

VS Code accepts only `major.minor.patch`, so the four-number form `0.1.0.10` is not supported. Alpha, Beta and RC describe development stages; they do not determine the distribution channel or add a fourth version component. Advance the three-number version for each package, and never reuse a published version. [VS Code version requirements](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#pre-release-extensions)

The packager validates the version through vsce and derives the prerelease flag from `preview: true`. A later stable build needs its own higher version and `preview: false`; prerelease subscribers can update to a higher stable version. Historical local versions remain in the feature history.

## Details the owner must provide

- The Marketplace publisher is `hungtienhuang`, confirmed by the owner.
- The prepared listing uses the owner-approved name “T3 VSCode”, MIT license and GitHub repository/issues links.
- A publishing login must have permission for that publisher; publication of 0.1.13 on the release channel is authorized by the owner.

Create a publisher in [Marketplace publisher management](https://marketplace.visualstudio.com/manage/publishers/). The publisher ID becomes part of the permanent extension identity, `<publisher>.t3-vscode`, so set the actual ID before the final public package is built. Changing the publisher also changes the installed extension identity.

Microsoft recommends Entra ID–based publishing. Azure DevOps PATs currently work with **All accessible organizations** and **Marketplace → Manage**, but global PATs retire on **December 1, 2026**. Prefer the identity-based workflow for ongoing automation. Configure credentials locally or through a private credential mechanism; do not put a token in source files or chat. [Current authentication instructions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)

For local PAT-based publishing, use `pnpm exec vsce login <publisher-id>` and enter the token at its private terminal prompt. This version of vsce prefers the operating system keyring (`vscode-vsce`); on Linux it needs a working Secret Service/keyring. Its fallback stores credentials in `~/.vsce` with mode 0600, outside this repository, and `VSCE_STORE=file` explicitly selects that fallback. Prefer the keyring; this preparation does not read or create credential stores. CI publishing credentials belong in the CI secret/identity configuration. See the [vsce credential store implementation](https://github.com/microsoft/vscode-vsce/blob/main/src/store.ts).

## Repository preparation

The candidate includes a 256×256 PNG icon, alpha description, keywords, repository/support links, three native extension screenshots, `CHANGELOG.md`, `SUPPORT.md`, the project license and bundled dependency notices. Confirm the repository and support URLs are public and contain the release documentation and `docs/screenshots/` images before publishing; `vsce` rewrites relative Markdown links to repository URLs.

Linux and local T3 servers are the verified scope. Other platforms need verification before the listing claims support for them. T3 Code and the selected provider are installed/configured separately; the extension does not bundle them.

## Build and review

1. Update `package.json`, the changelog and linked feature history for the candidate.
2. Run relevant unit, type, browser and isolated native checks; use GPT-6 Luna with low effort only when a live provider check is needed.
3. Start a regression reviewer with fresh context, resolve blockers, obtain final signoff and record the outcome in the feature history.
4. Run `pnpm package` and verify the VSIX version, publisher, release-channel metadata and bundled assets; 0.1.13 uses `preview: false` and must omit the prerelease property.

The packaging script reads the version from `package.json`, adds `--pre-release` when `preview: true`, and writes to `target-installer/`. The prerelease flag is required in addition to the Marketplace Preview label. Never use `--skip-license` for the public candidate.

## Publish the reviewed package

The owner has authorized publishing v0.1.13 on the release channel under `hungtienhuang`; publish the reviewed package after all checks pass and credentials are verified:

```sh
pnpm exec vsce publish --packagePath target-installer/t3-vscode-0.1.13.vsix
```

Using the reviewed package avoids rebuilding different code while publishing. Do not pass `patch` or another version argument: those commands can modify the version and create Git commits/tags. After publication, check the Marketplace page, verify release-channel metadata and installation in an isolated VS Code profile, and record the published URL and version.

## First public release

- Published `hungtienhuang.t3-vscode` version **0.1.12** to the prerelease channel on **October 7, 2026**, from source commit `3e9d971`.
- Made `busFred/t3-vscode` public with the owner's explicit permission and verified anonymous access to all README screenshots and development documentation.
- Passed 121 unit tests, browser checks, isolated native editor-reference checks and a fresh-context regression review before packaging.
- Installed the reviewed local VSIX successfully into disposable VS Code storage without changing the normal profile.
- VSIX SHA-256: `82c59225f4f27f29ed561c4e39e441df76f6177b00ca74c60b41637b2be495ff`.

At 04:22 UTC on October 7, the Marketplace reported version 0.1.12 with the prerelease property but had not marked it validated, and an isolated Marketplace installation still reported the extension unavailable. The local VSIX installation passed; Marketplace installation remains pending its validation and discovery update.
