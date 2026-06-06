const METHODS = [
  "initialize",
  "_pact/agent/list",
  "agent/list",
  "_pact/target/list",
  "target/list",
  "_pact/session/list",
  "session/list",
  "_pact/session/get",
  "session/get",
  "_pact/turn/list",
  "turn/list",
  "_pact/turn/observe",
  "turn/observe",
  "session/new",
  "session/load",
  "session/resume",
  "session/prompt",
  "session/update",
  "session/cancel",
  "session/close",
  "session/request_permission",
  "fs/read_text_file",
  "fs/write_text_file"
];

export const ACP_PROTOCOL_VERSION = 1;

METHODS.initialize = "initialize";
METHODS.pactAgentList = "_pact/agent/list";
METHODS.agentList = "agent/list";
METHODS.pactTargetList = "_pact/target/list";
METHODS.targetList = "target/list";
METHODS.pactSessionList = "_pact/session/list";
METHODS.sessionList = "session/list";
METHODS.pactSessionGet = "_pact/session/get";
METHODS.sessionGet = "session/get";
METHODS.pactTurnList = "_pact/turn/list";
METHODS.turnList = "turn/list";
METHODS.pactTurnObserve = "_pact/turn/observe";
METHODS.turnObserve = "turn/observe";
METHODS.sessionNew = "session/new";
METHODS.sessionLoad = "session/load";
METHODS.sessionResume = "session/resume";
METHODS.sessionPrompt = "session/prompt";
METHODS.sessionUpdate = "session/update";
METHODS.sessionCancel = "session/cancel";
METHODS.sessionClose = "session/close";
METHODS.sessionRequestPermission = "session/request_permission";
METHODS.fsReadTextFile = "fs/read_text_file";
METHODS.fsWriteTextFile = "fs/write_text_file";

export const ACP_METHODS = Object.freeze(METHODS);
