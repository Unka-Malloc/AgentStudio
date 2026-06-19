import { createPactium } from "../src/index.js";
import { createLicoLiteAspect } from "../src/aspects/licolite/index.js";

const pactium = createPactium({ dataDir: "./.pactium" });
const licolite = createLicoLiteAspect({
  pactium,
  evidencePolicy: "opportunistic"
});

const envelope = await licolite.recordWorkspaceOperation({
  operationId: "example.write",
  workspaceId: "example",
  idempotencyKey: "example-intent",
  outcomeIdempotencyKey: "example-outcome",
  input: { target: "hello.json" },
  policyEvidence: { decision: "allow" },
  workspaceEffectEvidence: { durableRef: "host:example:hello" },
  stateMutations: [
    { key: "hello.json", value: { hello: "pactium" } }
  ]
});

console.log(JSON.stringify({
  envelopeId: envelope.envelopeId,
  verification: await licolite.verifyEnvelope(envelope)
}, null, 2));
