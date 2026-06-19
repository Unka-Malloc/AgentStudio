# Root Export Latest Proof API Only

The Pactium package root export will expose only the latest proof-first API. Earlier experimental storage-first APIs will not remain in the root export, because mixed-version exports would make it easy for LicoLite or third-party users to depend on weak proof semantics accidentally.
