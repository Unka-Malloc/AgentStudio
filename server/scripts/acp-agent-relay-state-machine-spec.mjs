export const ACP_AGENT_RELAY_STATE_MACHINE_SPEC = Object.freeze({
  schemaVersion: "pact.acp-agent-relay.state-machine.spec.v1",
  documentPath: "docs/ACP-AGENT-RELAY-STATE-MACHINE.md",
  domains: [
    {
      id: "FrameState",
      docHeading: "### Frame State",
      states: [
        "received",
        "parse_error",
        "invalid_request",
        "invalid_batch",
        "response_ignored",
        "notification",
        "request",
        "handler_error"
      ]
    },
    {
      id: "SourceIdentityState",
      docHeading: "### Source Identity State",
      states: [
        "auth_bound",
        "connection_bound",
        "remembered_connection",
        "body_fallback",
        "default_bound",
        "ownership_matched",
        "ownership_failed"
      ]
    },
    {
      id: "AuthorizationState",
      docHeading: "### Authorization State",
      states: ["preflight_pending", "authorized", "denied", "approval_required", "hard_denied"]
    },
    {
      id: "RouteState",
      docHeading: "### Route State",
      states: [
        "unresolved",
        "resolved",
        "virtual_agent_unavailable",
        "target_unavailable",
        "mode_denied",
        "workspace_denied",
        "data_source_denied",
        "capability_denied",
        "route_blocked"
      ]
    },
    {
      id: "SessionState",
      docHeading: "### Session State",
      states: ["absent", "dormant", "waking", "active", "approval_pending", "blocked", "closed"]
    },
    {
      id: "TurnState",
      docHeading: "### Turn State",
      states: [
        "absent",
        "queued",
        "running",
        "approval_pending",
        "completed",
        "cancelled",
        "approval_denied",
        "blocked",
        "idempotency_replay",
        "idempotency_conflict"
      ]
    },
    {
      id: "TargetState",
      docHeading: "### Target State",
      states: [
        "disconnected",
        "connecting",
        "initialized",
        "session_created",
        "session_resumed",
        "session_rehydrated",
        "prompting",
        "callback_waiting",
        "accepted_only",
        "completed",
        "target_error",
        "unavailable",
        "runtime_error",
        "closed"
      ]
    },
    {
      id: "ApprovalState",
      docHeading: "### Approval State",
      states: [
        "none",
        "pending",
        "completed",
        "denied",
        "cancelled",
        "payload_mismatch",
        "payload_unavailable",
        "replayed_completed",
        "replayed_pending"
      ]
    },
    {
      id: "ObservationState",
      docHeading: "### Observation State",
      states: [
        "not_requested",
        "guard_pending",
        "unsupported",
        "conversation_missing",
        "observing",
        "unchanged",
        "progress_refreshed",
        "final_refreshed",
        "target_error_refreshed",
        "runtime_error"
      ]
    },
    {
      id: "VisibilityState",
      docHeading: "### Visibility State",
      states: [
        "progress_only",
        "reasoning_requested",
        "reasoning_allowed",
        "reasoning_suppressed",
        "source_summary"
      ]
    }
  ],
  terminalOutcomes: [
    "parse_error",
    "invalid_request",
    "method not found",
    "operation error",
    "completed",
    "accepted",
    "target_error",
    "approval_pending",
    "approval_denied",
    "cancelled",
    "closed",
    "observation_unsupported",
    "observation_refreshed"
  ],
  invariants: [
    {
      id: "source_identity_ownership",
      docNeedles: [
        "relaySessionId` is not a bearer secret",
        "Request body source fields cannot override authenticated or connection-bound source identity",
        "relay_session_not_found"
      ]
    },
    {
      id: "operation_guard_before_side_effect",
      docNeedles: [
        "Source operation guard runs before target wake",
        "Route policy is recalculated on initialize",
        "ledger or receipt cannot be written before an external side effect"
      ]
    },
    {
      id: "no_raw_proxy_or_reasoning_contamination",
      docNeedles: [
        "ACP Relay never forwards a raw byte stream",
        "Child-agent reasoning is emitted only when explicitly requested",
        "historical `reasoning_trace` events are not replayed"
      ]
    },
    {
      id: "approval_and_idempotency_safety",
      docNeedles: [
        "Approval executes a write at most once",
        "Idempotency replays never wake the target",
        "Permission resolves for the same relay turn are serialized"
      ]
    },
    {
      id: "response_kind_is_semantic",
      docNeedles: [
        "semantic branching must use `responseKind` or `communicationSummary.summaryKind`",
        "Accepted-only acknowledgements must not be represented as final answers",
        "Non-terminal and failure classifications take precedence"
      ]
    }
  ],
  evidenceBranches: [
    {
      id: "json_rpc_frame_dispatch",
      docNeedles: ["Source JSON-RPC Frame Transitions", "Batch with requests", "Unsupported method"],
      evidence: [
        { file: "runtimeTest", patterns: ["handles source ACP JSON-RPC batch frames with response arrays"] },
        { file: "runtimeTest", patterns: ["returns JSON-RPC method-not-found errors for unsupported source ACP methods"] }
      ]
    },
    {
      id: "source_identity_isolation",
      docNeedles: ["ownership_failed", "relay_session_not_found", "request-body source spoofing"],
      evidence: [
        { file: "runtimeTest", patterns: ["rejects foreign source ACP access to a direct relay session id"] },
        { file: "runtimeTest", patterns: ["keeps source identity isolated across concurrent transports"] },
        { file: "codexAntigravityVerifier", patterns: ["foreign-source-spoof-owner-load", "relay_session_not_found"] },
        { file: "proofMatrix", patterns: ["source_identity_isolation", "requestBodyOverrideRejected"] }
      ]
    },
    {
      id: "source_guard_before_target_wake",
      docNeedles: ["Source guard preflight denies", "before target wake", "authorized"],
      evidence: [
        { file: "runtimeTest", patterns: ["denies source ACP prompt through the operation guard before waking the target"] },
        { file: "runtimeTest", patterns: ["denies guarded source ACP operations before target routing or transport wake"] }
      ]
    },
    {
      id: "durable_resume_and_multi_turn",
      docNeedles: ["session/load", "session/resume", "second delegated turn"],
      evidence: [
        { file: "codexAntigravityVerifier", patterns: ["session/load", "session/resume", "secondCommunicationSummary"] },
        { file: "proofMatrix", patterns: ["source_facing_multi_turn_continuity", "distinctRelayTurns"] },
        { file: "finalExtraTest", patterns: ["fails the relay proof matrix when the resumed prompt is not a distinct second turn"] }
      ]
    },
    {
      id: "prompt_terminal_classification",
      docNeedles: ["Target Final-Response Evidence Transitions", "accepted-only", "target_error"],
      evidence: [
        { file: "runtimeTest", patterns: ["responseKind", "acknowledgement", "final_response"] },
        { file: "runtimeTest", patterns: ["reports Antigravity Connect error steps as target errors instead of accepted-only completion"] },
        { file: "runtimeTest", patterns: ["persists target errors in generic target evidence for source agents"] }
      ]
    },
    {
      id: "target_callback_parent_binding",
      docNeedles: ["target_callback_parent_ambiguous", "target_callback_parent_not_found", "No relay side effect"],
      evidence: [
        { file: "runtimeTest", patterns: ["fails closed for ambiguous target callbacks without a parent request id"] },
        { file: "runtimeTest", patterns: ["routes target callbacks to an explicit callback-capable parent request"] },
        { file: "runtimeTest", patterns: ["target_callback_parent_ambiguous"] },
        {
          file: "targetCallbackApprovalVerifier",
          patterns: [
            "parentBindingProof",
            "target_callback_parent_ambiguous",
            "target_callback_parent_not_found",
            "noRelaySideEffect"
          ]
        },
        {
          file: "realProofBundle",
          patterns: ["target_callback_parent_binding", "targetCallbackParentBindingProofAcceptable", "noRelaySideEffect"]
        }
      ]
    },
    {
      id: "approval_suspend_resume_and_denial",
      docNeedles: ["approval_pending", "approval_denied", "permission_payload_unavailable"],
      evidence: [
        { file: "runtimeTest", patterns: ["does not wake the target transport before pending write approval is resolved"] },
        { file: "runtimeTest", patterns: ["resolves pending write approvals through source ACP session/request_permission"] },
        { file: "runtimeTest", patterns: ["denies pending write approvals through source ACP session/request_permission without writing files"] },
        {
          file: "targetCallbackApprovalVerifier",
          patterns: ["targetCallbackApprovalProofAcceptable", "usedSessionResume", "denialProof", "approval_denied"]
        },
        {
          file: "idempotencyVerifier",
          patterns: ["idempotencyReplay", "idempotency_key_conflict", "targetNotReawakenedForReplay"]
        }
      ]
    },
	    {
	      id: "cancel_and_close_terminal",
	      docNeedles: ["session/cancel", "session/close", "relay_session_closed"],
      evidence: [
        { file: "runtimeTest", patterns: ["transitions session to closed and rejects resume of a non-existent session"] },
        { file: "runtimeTest", patterns: ["handles source ACP cancel while a prompt request is still running"] },
        { file: "runtimeTest", patterns: ["cancels target-originated ACP file write callbacks without later writing"] },
        { file: "proofMatrix", patterns: ["source_facing_session_close_terminal", "promptAfterCloseRestartErrorCode"] },
        { file: "codexAntigravityVerifier", patterns: ["sourceSessionCloseProof", "codex-closed-session-resume-after-restart"] },
	        { file: "realVerifier", patterns: ["source_facing_session_close_terminal", "proven"] }
	      ]
	    },
	    {
	      id: "source_facing_session_cancel_running_prompt",
	      docNeedles: ["running delegated prompt", "session/cancel", "late target completion"],
	      evidence: [
	        {
	          file: "targetCallbackApprovalVerifier",
	          patterns: [
	            "sourceCancelProof",
	            "targetCancelObserved",
	            "lateTargetCompletionSuppressed",
	            "pact-source-acp-to-stdio-target-session-cancel-running-prompt"
	          ]
	        },
	        {
	          file: "realProofBundle",
	          patterns: [
	            "source_facing_session_cancel_running_prompt",
	            "sourceFacingCancelProofAcceptable",
	            "lateTargetCompletionSuppressed"
	          ]
	        },
	        {
	          file: "realVerifier",
	          patterns: ["source_facing_session_cancel_running_prompt", "proven"]
	        }
	      ]
	    },
	    {
	      id: "target_reconnect_resume_after_process_restart",
	      docNeedles: ["target process restart", "session/resume", "previous `targetResumeRef`"],
	      evidence: [
	        {
	          file: "targetReconnectVerifier",
	          patterns: [
	            "target_process_exit_after_first_prompt",
	            "resumeTargetResumeRefMatchedFirst",
	            "pact-source-acp-to-stdio-target-reconnect-resume"
	          ]
	        },
	        {
	          file: "realProofBundle",
	          patterns: [
	            "target_reconnect_resume_after_process_restart",
	            "targetReconnectProofAcceptable",
	            "reasoningTraceReplaySuppressed"
	          ]
	        },
	        {
	          file: "realVerifier",
	          patterns: ["target_reconnect_resume_after_process_restart", "proven"]
	        }
	      ]
	    },
	    {
	      id: "target_reconnect_load_only_after_process_restart",
	      docNeedles: ["Load-only target process restart", "session/load", "must not call `session/resume`"],
	      evidence: [
	        {
	          file: "targetLoadReconnectVerifier",
	          patterns: [
	            "session: [\"new\", \"load\"]",
	            "targetSessionLoadUsed",
	            "targetSessionResumeNotUsed",
	            "pact-source-acp-to-stdio-target-reconnect-load"
	          ]
	        },
	        {
	          file: "realProofBundle",
	          patterns: [
	            "target_reconnect_load_only_after_process_restart",
	            "targetLoadReconnectProofAcceptable",
	            "loadTargetResumeRefMatchedFirst"
	          ]
	        },
	        {
	          file: "realVerifier",
	          patterns: ["target_reconnect_load_only_after_process_restart", "proven"]
	        }
	      ]
	    },
	    {
	      id: "observation_refresh_safe",
      docNeedles: ["turn.observe", "target_observation_unsupported", "must not re-send the prompt"],
      evidence: [
        { file: "runtimeTest", patterns: ["keeps pending permission request details opt-in for source list/get/turn observability"] },
        { file: "codexCliTargetVerifier", patterns: ["target_observation_unsupported", "turnObserveReasonCodeAfterRestart"] },
        { file: "codexAcpTargetVerifier", patterns: ["target_observation_unsupported", "sourceAcpSessionLoadAfterRestartVerified"] }
      ]
    },
    {
      id: "accepted_only_observation_final_refresh",
      docNeedles: ["accepted-only", "turn.observe", "final_refreshed", "existing relay turn audit ids"],
      evidence: [
        {
          file: "runtimeTest",
          patterns: [
            "externalCompletionState, \"accepted_only\"",
            "observed.data.refreshed, true",
            "observed.data.communicationSummary.finalResponseAvailable, true",
            "event.operationId === \"acp_agent_relay.turn.observe\"",
            "observedAgain.data.refreshed, false"
          ]
        },
        {
          file: "runtimeTest",
          patterns: [
            "source ACP JSON-RPC turn.observe final response",
            "observed.result.responseKind, \"final_response\"",
            "observed.result.targetObservation.latestFinalResponse.text, undefined"
          ]
        }
      ]
    },
    {
      id: "source_fs_and_child_mcp_guard",
      docNeedles: ["fs/read_text_file", "fs/write_text_file", "relay_child_operation_binding_mismatch"],
      evidence: [
        { file: "runtimeTest", patterns: ["handles source-facing ACP file methods with policy-bound read and fail-closed write"] },
        { file: "runtimeTest", patterns: ["guards source-facing ACP file methods through the shared operation guard before file access"] },
        { file: "mcpScopeVerifier", patterns: ["relay_child_operation_binding_mismatch"] }
      ]
    },
    {
      id: "real_agent_proof_matrix",
      docNeedles: ["Real proof gates", "Proof matrix", "unsupported"],
      evidence: [
        { file: "realVerifier", patterns: ["source_facing_multi_turn_continuity", "proven"] },
        { file: "realProofBundle", patterns: ["codex_cli_participation", "codex_cli_target_communication", "codex_acp_target_communication"] },
        { file: "proofMatrix", patterns: ["native_codex_cli_acp_source", "native_antigravity_ide_cli_acp_source", "unsupported"] }
      ]
    }
  ]
});
