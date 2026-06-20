# Fail Closed for Missing LicoLite Evidence in Production

The LicoLite Aspect uses LicoLite Evidence Policy to decide how missing critical evidence extensions are handled. Production profiles default to failing closed so a LicoLite-level proof is not silently downgraded to a plain Pactium envelope when policy or workspace effect evidence is absent.
