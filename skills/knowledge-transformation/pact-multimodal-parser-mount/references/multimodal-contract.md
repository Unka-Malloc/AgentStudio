# Multimodal Parser Contract

Use this when replacing simple OCR with a richer image or scanned-PDF parser.

Mount name: `multimodalParser` or a custom routed mount.

Expected behavior:

- `extractDocument` returns visible text, layout notes, tables, form fields, and figure captions.
- `extractText` can return plain OCR text for compatibility.
- For images, route by extension or kind:

```json
{
  "kindRoutes": {
    "image": { "mountName": "multimodalParser", "action": "extractDocument" }
  },
  "extensionRoutes": {
    ".png": { "mountName": "multimodalParser", "action": "extractDocument" },
    ".jpg": { "mountName": "multimodalParser", "action": "extractDocument" }
  }
}
```

Do not return only captions when document text is visible. Include extracted text and separate metadata for layout confidence.
