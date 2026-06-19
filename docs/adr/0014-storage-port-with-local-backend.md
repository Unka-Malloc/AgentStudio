# Storage Port With Local Filesystem Backend

Pactium defines a storage port so proof algorithms are decoupled from persistence mechanics. The current package ships a local filesystem backend that stores JSON protocol objects and content-addressed CAS block records. It does not ship a SQLite backend.

Storage backends store and retrieve protocol material; they do not define canonical encoding, hash roots, proof formats, or verification semantics. Adding SQLite or another indexed backend requires implementation, tests, and an ADR update before docs may describe it as current behavior.
