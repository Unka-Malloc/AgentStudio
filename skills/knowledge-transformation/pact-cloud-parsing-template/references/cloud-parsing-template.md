# Cloud Parsing HTTP Template

Settings:

- `cloudParsingEnabled`
- `cloudParsingProvider`
- `googleApiKey`
- `googleModel`
- `openAiModel`
- `cloudParsingMaxSources`
- `cloudParsingMaxChars`
- `cloudParsingHttpHead`
- `cloudParsingHttpBody`

Use the custom HTTP provider when the built-in provider is not enough.

Template variables supported by the UI and parser layer include:

- `{{prompt}}`
- `{{documentName}}`
- `{{sourceKind}}`
- `{{mediaType}}`

Validation rules:

- Keep secrets out of prompt body when they belong in headers.
- Limit source count and chars before testing a new endpoint.
- Save a sample response and map it to Pact document intelligence fields before enabling broadly.
