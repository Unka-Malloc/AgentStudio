---
name: pact-mcp-upload-audit
description: Use when verifying a claim that a Pact MCP agent uploaded a workspace file, especially when the user cannot find the file on disk or needs the exact log, SQLite, and filesystem evidence order.
---

# Pact MCP Upload Audit

Use this workflow to verify whether a Pact MCP upload really happened. The goal is not to trust the agent's prose; prove the claim from runtime logs, audit SQLite, workspace SQLite, and the filesystem.

## Investigation order

1. Identify the live server and active data directory.
   Run from the Pact repo when possible. Confirm the server process, port, and discovery response before reading storage:
   ```bash
   ps -axo pid,command | rg 'start-server|pact|7228'
   curl -sS http://127.0.0.1:7228/.well-known/pact/mcp.json
   ```
   Default runtime data is usually `/Users/unka/.pact-server-data`, but do not assume it if discovery or process args show another path.

2. Search the runtime JSONL log for the claimed upload markers.
   Look under `<dataDir>/logs/runtime/pact-server-YYYY-MM-DD.jsonl`. Search by `workspaceId`, `traceId`, `tool_exec`, relative path, `pact.workspace.file.upload`, and `agent_workspace.file.upload.completed`.
   Expected useful events include `http.request.completed`, `tools.execution.completed`, `tool_management.execute.completed`, `operation.tool-management.completed`, and `agent_workspace.file.upload.completed`.

3. Query Tool Management audit SQLite.
   Use `<dataDir>/tool-management/tool-management.sqlite`. Prove tool execution, policy decision, grant, and prior denial if present:
   ```sql
   SELECT tool_execution_id, trace_id, tool_id, operation_id, risk, decision, status, error_code, started_at, finished_at, redacted_input_json, result_summary_json
   FROM tool_executions
   WHERE tool_id IN ('pact.workspace.file.upload', 'pact.workspace.folder.create')
      OR trace_id = '<trace_id>'
      OR redacted_input_json LIKE '%<workspace_id>%'
   ORDER BY started_at DESC;

   SELECT decision_id, tool_execution_id, trace_id, tool_id, grant_id, effect, reason_code, missing_scopes_json, created_at
   FROM tool_policy_decisions
   WHERE trace_id = '<trace_id>' OR tool_execution_id = '<tool_execution_id>';

   SELECT grant_id, subject_id, scopes_json, toolsets_json, created_at, expires_at
   FROM tool_grants
   WHERE grant_id = '<grant_id>' OR subject_id LIKE '%codex%';
   ```

4. Query Agent Workspace SQLite.
   Use `<dataDir>/agent-workspaces/agent-workspace.sqlite`. Resolve the real workspace root from `aw_workspaces.fs_path`; do not infer it from `<dataDir>/agent-workspaces/folders`.
   ```sql
   SELECT workspace_id, title, status, fs_path, updated_at
   FROM aw_workspaces
   WHERE workspace_id = '<workspace_id>';

   SELECT artifact_id, workspace_id, run_id, title, created_by, created_at, coverage_json
   FROM aw_artifacts
   WHERE workspace_id = '<workspace_id>'
   ORDER BY created_at DESC;
   ```

5. Resolve and inspect the real file.
   Join `aw_workspaces.fs_path` with the uploaded relative path. Then check metadata and digest:
   ```bash
   stat '<fs_path>/<relative_path>'
   shasum -a 256 '<fs_path>/<relative_path>'
   ```
   Only print file content when it is small and safe to disclose.

6. Correlate the evidence.
   A valid upload needs all of these to agree: runtime trace completed, tool execution status `ok`, policy decision `allow`, workspace row exists, artifact row matches, and the file exists at `fs_path + relative_path` with the expected size/hash.

7. Interpret common failure modes.
   If the tool was denied, report the missing scopes and grant state. If audit says `ok` but the file is absent, suspect wrong data directory, wrong `fs_path`, later cleanup, or a post-write logging gap. If the user searched under `<dataDir>/agent-workspaces/folders` but `aw_workspaces.fs_path` points elsewhere, show the actual `fs_path`.

## Response format

Start with the conclusion: `confirmed`, `not confirmed`, or `inconclusive`.

Include these fields when available: `workspaceId`, `traceId`, `toolExecutionId`, `grantId`, `workspaceFsPath`, final absolute file path, relative path, size, sha256, artifactId, and exact runtime log file.

Call out logging gaps explicitly. Do not say upload behavior is fully traced unless a dedicated upload completion event records the final file path or path digest, size, hash, and artifact id.
