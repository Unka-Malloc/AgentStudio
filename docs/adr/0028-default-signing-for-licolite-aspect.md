# Default Signing for the LicoLite Aspect

The LicoLite Aspect enables signing for Pactium Proof Envelopes by default. Pactium remains usable without keys in plain library mode, but LicoLite policy controls whether missing signing material fails closed or falls back to opportunistic signing.

The current core also signs Ledger Heads by default with a local Ed25519 signer and verifier manifest unless unsigned mode is explicitly requested. LicoLite envelope signing remains separate and can use HMAC or Ed25519 signer material under LicoLite policy.
