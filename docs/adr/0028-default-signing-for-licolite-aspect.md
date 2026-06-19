# Default Signing for the LicoLite Aspect

The LicoLite Aspect enables signing for Pactium Proof Envelopes by default. Pactium remains usable without keys in plain library mode, but LicoLite policy controls whether missing signing material fails closed or falls back to opportunistic signing.

The current package does not sign Ledger Heads. Ledger Head signing is an extension point that requires implementation and tests before docs may describe it as current behavior.
