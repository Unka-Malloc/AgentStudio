import { createPactium } from "../src/index.js";

const pactium = createPactium({ dataDir: "./.pactium" });

const envelope = await pactium.recordOperation({
  operationId: "example.write",
  workspaceId: "example",
  idempotencyKey: "example-intent",
  outcomeIdempotencyKey: "example-outcome",
  input: { target: "hello.json" },
  result: { status: "recorded" },
  extensions: [{
    name: "host.operation-copy",
    critical: false,
    value: {
      input: { target: "hello.json" },
      result: { status: "recorded" }
    }
  }],
  stateMutations: [
    { key: "hello.json", value: { hello: "pactium" } }
  ]
});

console.log(JSON.stringify({
  envelopeId: envelope.envelopeId,
  verification: await pactium.verifyEnvelope(envelope)
}, null, 2));
