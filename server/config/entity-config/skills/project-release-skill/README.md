# Pact Project Release Runbook

This built-in runbook defines the standard procedure for an AI agent to release
a new version of the Pact MCP system. It ships with the platform and is not a
Skill Hub contributed skill asset. It is explicitly prohibited from being
exposed to downstream agents (`allowDownstream: false`) in the manifest.

## Prerequisites
- Working directory: The root of the Pact repository.
- GitHub CLI (`gh`) must be authenticated if generating a GitHub release.

## Release Procedure

When the user asks to release the current version (currently `v0.0.1`), the agent MUST follow these exact steps:

1. **Verify the Release Build:**
   Run `npm run server:verify:mcp-release` locally to ensure the build works and tests pass.

2. **Bump Versions in Code:**
   Run the metadata bump script first so the three required files are updated together:
   ```bash
   npm run metadata:bump -- --version <VERSION>
   ```
   The script updates:
   - `package.json` (the root project)
   - `server/platform/common/mcp/gateway-installer/package.json`
   - `server/platform/common/mcp/http-mcp-adapter.mjs` (variables `MCP_SERVER_VERSION` and `MCP_CONNECTOR_VERSION`)

3. **Commit and Tag:**
   Run the following terminal commands:
   ```bash
   git add package.json server/platform/common/mcp/gateway-installer/package.json server/platform/common/mcp/http-mcp-adapter.mjs
   git commit -m "chore: bump version to <VERSION>"
   git tag v<VERSION>
   git push && git push --tags
   ```

4. **Generate Release Assets:**
   Run the release packaging script to generate the portable bundles and tarballs. By default, this will use the project-preferred Node.js version (resolved from project configuration first, then local Node runtime) for 4 target platforms (`darwin-arm64`, `linux-x64` (x86_64/amd64), `linux-arm64`, `linux-x64-musl` (x86_64/amd64 musl)). macOS outputs both `.zip` and `.tar.gz`; Linux platforms default to `.tar.gz`. Output asset names are named with `x86_64` (for example `linux-x86_64`, `linux-x86_64-musl`). Override with `--node-version=<version>` or `PACT_MCP_NODE_VERSION` if you need a pinned version.
   ```bash
   npm run server:mcp:release
   ```
   *Note: If you only need specific platforms, you can pass `-- --platforms=linux-x64,darwin-arm64` (x86_64 is still `linux-x64`).*
   This will output files to `build/release/mcp/`.

5. **Upload Assets to GitHub Release:**
   Use the GitHub CLI (`gh`) to upload the assets, ensuring you only upload the archive files and scripts (avoiding the unpacked directory).
   Before running this command, copy `.github/RELEASE_TEMPLATE.md` to a temporary file (e.g., `/tmp/release_notes.md`), fill in the highlights and details of the release, and then run:
   ```bash
   gh release create v<VERSION> build/release/mcp/*.zip build/release/mcp/*.tar.gz build/release/mcp/*.tgz build/release/mcp/*.sh build/release/mcp/*.json --title "v<VERSION>" -F /tmp/release_notes.md
   ```
