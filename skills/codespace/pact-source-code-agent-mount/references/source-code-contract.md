# Source Code Agent Mount Contract

Use this contract for code-aware document ingestion.

Good candidates:

- `.py`, `.js`, `.ts`, `.tsx`, `.java`, `.go`, `.rs`, `.md`, `.yaml`, `.json`

The mount should:

- Return source text unchanged enough for later line-level reference.
- Add metadata such as language, exported symbols, imports, framework hints, and detected entry points.
- Avoid running untrusted code.
- Prefer static parsing over regex for languages where a parser is available.

Route example:

```json
{
  "extensionRoutes": {
    ".py": { "mountName": "sourceCodeAgent", "action": "extractDocument" },
    ".ts": { "mountName": "sourceCodeAgent", "action": "extractDocument" }
  }
}
```
