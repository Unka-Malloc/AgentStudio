# Mail Parser Mount Contract

Use this contract for `.eml` and `.msg` mounts.

The parser must preserve evidence:

- Return body text in reading order.
- Preserve subject, from, to, cc, date, message id, thread ids, and attachment summaries in `metadata`.
- Keep raw mail persistence enabled by letting normal ingest receive the original file.
- Do not flatten tables into prose when the mail body contains HTML tables. Use text with stable row and cell boundaries, or return structured table metadata.

Recommended metadata keys:

```json
{
  "subject": "",
  "from": "",
  "to": [],
  "cc": [],
  "sentAt": "",
  "messageId": "",
  "inReplyTo": "",
  "references": [],
  "attachments": []
}
```

Route example:

```json
{
  "extensionRoutes": {
    ".eml": { "mountName": "mailAgent", "action": "extractDocument" },
    ".msg": { "mountName": "mailAgent", "action": "extractDocument" }
  }
}
```
