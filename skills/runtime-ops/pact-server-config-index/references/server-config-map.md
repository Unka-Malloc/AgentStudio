# Server Config Map

Primary files:

- `server/platform/common/platform-core/settings.mjs`: default settings and environment variables.
- `$PACT_SERVER_DATA_DIR/settings.json`: persisted settings.
- `$PACT_SERVER_DATA_DIR/mount-modules.json`: mount module paths.
- `$PACT_SERVER_DATA_DIR/mount-routing.json`: route table.
- `$PACT_SERVER_DATA_DIR/rules/email-rules.json`: email analysis rules.

Important settings:

- `tikaJarPath`, `javaBinPath`
- `cloudParsingEnabled`, `cloudParsingProvider`
- `googleApiKey`, `googleModel`, `openAiModel`
- `cloudParsingMaxSources`, `cloudParsingMaxChars`
- `cloudParsingHttpHead`, `cloudParsingHttpBody`
- `analysisModuleId`
- `ocrEnabled`, `ocrPythonPath`, `ocrLanguage`
- `retrievalHalfLifeDays`, `staleAfterDays`, `transactionWindowDays`

Environment variables mirror the defaults with `PACT_` prefixes, including `PACT_TIKA_JAR_PATH`, `PACT_JAVA_BIN_PATH`, `PACT_GOOGLE_API_KEY`, `PACT_OPENAI_MODEL`, `PACT_OCR_PYTHON_PATH`, and retrieval window variables.
