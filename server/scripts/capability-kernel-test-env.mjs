export function useIsolatedCapabilityKernelForVerifier() {
  const originalEnv = {
    PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER: process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER,
    PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER: process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER,
    PACT_OPAQUE_CAPABILITY_KEY_PROVIDER: process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER,
    PACT_CAPABILITY_BINDING_GUARD_PROVIDER: process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER
  };

  process.env.PACT_TOOL_GRANT_CAPABILITY_KEY_PROVIDER = "local-file";
  process.env.PACT_TOOL_GRANT_BINDING_GUARD_PROVIDER = "local-file";
  process.env.PACT_OPAQUE_CAPABILITY_KEY_PROVIDER = "local-file";
  process.env.PACT_CAPABILITY_BINDING_GUARD_PROVIDER = "local-file";

  return () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}
