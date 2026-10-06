# T3 VSCode assets

The activity-bar icon, extension PNG and light/dark tab icons use the ribbon artwork supplied in `t3-ribbon-suite.zip`. The monochrome activity icon inherits VS Code’s foreground color; the tab variants retain contrast in native light and dark themes.

`provider-codex.svg` and `provider-claude.svg` reuse the small provider marks from T3 Code’s `apps/web/src/components/Icons.tsx`. The upstream MIT notice is retained in `vendor/LICENSE.t3code`. The Kimi initial and generic provider mark are local drawings. React renders these paths at 12px in session rows.

`provider-icons.woff` contains those four marks for native status-bar and Quick Pick icons. Normal builds use the checked-in font. To regenerate after changing the SVGs, install FontTools in a temporary environment and run `python3 scripts/build-provider-icons.py`; generation was verified with FontTools 4.60.1. The VSIX contains the compiled font, activity icon, extension PNG and tab SVGs.
