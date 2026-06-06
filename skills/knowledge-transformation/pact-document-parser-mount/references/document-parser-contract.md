# Document Parser Mount Contract

Use this contract when writing a custom `documentParser` or named parser such as `pdfAgent`.

Required export:

```js
export function createMount({ mountName, userDataPath, runtimeOptions }) {
  return {
    id: "custom/parser",
    kind: mountName,
    enabled: true,
    supports({ extension, mediaTypeHint, sourceKind }) {
      return extension === ".pdf";
    },
    async extractDocument(input) {
      return {
        parserId: "custom/parser",
        mediaType: input.mediaTypeHint || "",
        metadata: {},
        text: "...",
        embeddedDocuments: []
      };
    },
    async extractText(input) {
      return (await this.extractDocument(input)).text;
    }
  };
}
```

`extractDocument` input usually includes `filePath`, `fileName`, `buffer`, `settings`, and `userDataPath`.

Output rules:

- Always return a stable `parserId`.
- Always return `text` as a string. Use an empty string only when the format genuinely has no text.
- Put source-level metadata in `metadata`; do not overload `text` with JSON.
- Put child files or embedded objects in `embeddedDocuments` as `{ id, metadata, text }`.
- Throw an error for unsupported or lossy extraction instead of silently downgrading.

Route examples:

```json
{
  "extensionRoutes": {
    ".pdf": { "mountName": "pdfAgent", "action": "extractDocument" },
    ".docx": { "mountName": "documentParser", "action": "extractDocument" }
  }
}
```
