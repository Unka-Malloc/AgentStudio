# Pact v0.0.1 Runtime Migration Report

- Run ID: `20260525T171911Z`
- Generated At: `2026-05-25T17:19:11.987Z`
- Data Dir: `/var/folders/zd/s8tbt3211318l01qswk3sfmw0000gn/T/pact-v001-migration-fixture-LUWtyz`
- Mode: `report-and-recovery-point`
- Status: `ready`

## Summary

- Runtime files scanned: 9
- Symlinks recorded: 0
- Runtime bytes scanned: 165
- Recovery files copied: 0
- Recovery files skipped: 9

## Runtime Areas

| Area | Present | Files | Symlinks | Bytes | Policy |
| --- | --- | ---: | ---: | ---: | --- |
auth | yes | 1 | 0 | 19 | retain
security-authorization | yes | 1 | 0 | 18 | retain
agent-workspaces | yes | 3 | 0 | 63 | retain
code-management | yes | 1 | 0 | 21 | retain
knowledge | yes | 1 | 0 | 21 | retain
operation-audit | no | 0 | 0 | 0 | retain
protocol-events | yes | 1 | 0 | 0 | retain
logs | yes | 1 | 0 | 23 | retain

## Migration Policy

- v0.0.1 does not move runtime state back into the repository.
- Existing data remains in `ServerConfig.getDataDir()` and is retained in place.
- External provider credentials must remain secret refs; raw token values are not copied into reports.
- The recovery point contains small runtime files only; large files are represented by hash and path.

## Warnings

- Repository root contains .pact-server-data; this is local runtime state and should not be committed.
