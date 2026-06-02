# macOS Mail Import Operations

Relevant implementation:

- `client-gui/lib/src/services/macos_mail_importer.dart`
- `client-gui/macos/Runner/MacOSMailImporter.swift`
- `client-gui/lib/src/controllers/app_controller.dart`

Operational paths:

- Imported mail workspace: `portable-data/mail-imports/`
- Diagnostics: `portable-data/mail-imports/mail-*/diagnostics.json`
- Client log: `portable-data/logs/client.log`
- Knowledge index: `mail-imports/.../index/docs.tsv`
- Cloud taxonomy cache: `mail-imports/.../index/cloud-taxonomy.json`

Checklist:

- Confirm macOS Mail permission or guide authorization activation.
- Check diagnostics JSON before changing parser logic.
- Refresh index stats before judging whether import is empty.
- Use evidence open action to verify message ids still resolve.
- Keep raw `.eml` files available for server ingestion.
