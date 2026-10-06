# T3 VSCode development

- Keep [docs/feature-history.md](docs/feature-history.md) current whenever a feature is introduced, changed or removed. Maintain its linked overview table and add concise versioned entries under the affected feature; verify historical release versions from Git rather than guessing.
- Before creating any VSIX, launch a separate regression-review agent with fresh context (`fork_turns: "none"`). Give it the repository, comparison revision, scope and existing feature requirements; ask it to check for accidental regressions independently.
- Resolve blocking review findings, run relevant verification, and obtain the agent's review of the final changes before packaging. Record the review and validation outcome in the release notes or feature history.
- Build installers under `target-installer/`; packaging does not authorize installation into the user's normal VS Code profile.
- All native VS Code tests must isolate user data, extensions and shared data. All T3 verification must use an explicitly isolated home; never mutate the user's normal T3 state or VS Code extension catalogs.
- Use an inexpensive advertised model for live provider tests, currently GPT-6 Luna with low effort. Test scripts accept `T3_VSCODE_TEST_MODEL` for an explicit alternative and must fail rather than silently falling back to a premium model; deterministic fixtures do not call a model.
