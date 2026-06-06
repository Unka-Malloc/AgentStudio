import { createContextRuntime } from "../../../platform/specialized/agent/agent-context/context-core/index.mjs";
import os from "node:os";
import path from "node:path";

const cr = createContextRuntime({ userDataPath: process.env.PACT_SERVER_DATA_DIR || path.join(os.homedir(), ".pact-server-data") });
cr.listProfiles().then(res => console.log(JSON.stringify(res, null, 2)));
