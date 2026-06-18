import { createPactiumKernel } from "../src/index.js";

const kernel = createPactiumKernel({ dataDir: "./.pactium" });

const receipt = await kernel.recordOperation({
  operationId: "example.write",
  workspaceId: "example",
  subject: { type: "example" },
  effectKind: "state.changed",
  state: {
    mutations: [
      { action: "put", key: "hello.json", value: { hello: "pactium" } }
    ]
  }
});

console.log(JSON.stringify(receipt, null, 2));
