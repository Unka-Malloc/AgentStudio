import { sendJson } from "../http-utils.mjs";

function parseBody(parseJsonBody, requestBody) {
  return requestBody?.length > 0 ? parseJsonBody(requestBody) : {};
}

function requestSourceKey(request = {}) {
  return String(
    request.socket?.remoteAddress ||
      request.connection?.remoteAddress ||
      request.info?.remoteAddress ||
      ""
  ).trim();
}

async function sendRelayResult(response, promise) {
  const operationResult = await promise;
  sendJson(response, operationResult.status || 200, operationResult.payload || {});
}

export function createSystemControllerMobileRelayHandlers({
  parseJsonBody,
  mobileRelayStore
}) {
  return {
    async verifyMobileRelayExternalAuth({ operation, request, input }) {
      return mobileRelayStore.authorizeExternalOperation({
        operationId: operation?.id || "",
        input,
        headers: request?.headers || {}
      });
    },

    async handleMobileRelayConfig({ response }) {
      sendJson(response, 200, mobileRelayStore.gatewayConfig());
    },

    async handleMobileRelayPairingCreate({ request, requestBody, response }) {
      await sendRelayResult(
        response,
        mobileRelayStore.createPairing(
          parseBody(parseJsonBody, requestBody),
          { sourceKey: requestSourceKey(request) }
        )
      );
    },

    async handleMobileRelayPairingClaim({ request, requestBody, response }) {
      await sendRelayResult(
        response,
        mobileRelayStore.claimPairing(
          parseBody(parseJsonBody, requestBody),
          { sourceKey: requestSourceKey(request) }
        )
      );
    },

    async handleMobileRelayPairingStatus({ request, requestBody, response }) {
      await sendRelayResult(
        response,
        mobileRelayStore.pairingStatus(
          parseBody(parseJsonBody, requestBody),
          request.headers || {}
        )
      );
    },

    async handleMobileRelayPairingRevoke({ request, requestBody, response }) {
      await sendRelayResult(
        response,
        mobileRelayStore.revokePairing(
          parseBody(parseJsonBody, requestBody),
          request.headers || {}
        )
      );
    },

    async handleMobileRelayPcCheckIn({ request, requestBody, response }) {
      await sendRelayResult(
        response,
        mobileRelayStore.checkIn(
          parseBody(parseJsonBody, requestBody),
          request.headers || {}
        )
      );
    },

    async handleMobileRelayCommandCreate({ request, requestBody, response }) {
      await sendRelayResult(
        response,
        mobileRelayStore.enqueueCommand(
          parseBody(parseJsonBody, requestBody),
          request.headers || {}
        )
      );
    },

    async handleMobileRelayCommandPoll({ request, requestBody, response }) {
      await sendRelayResult(
        response,
        mobileRelayStore.pollCommands(
          parseBody(parseJsonBody, requestBody),
          request.headers || {}
        )
      );
    },

    async handleMobileRelayCommandComplete({
      commandId,
      request,
      requestBody,
      response
    }) {
      await sendRelayResult(
        response,
        mobileRelayStore.completeCommand(
          {
            ...parseBody(parseJsonBody, requestBody),
            commandId
          },
          request.headers || {}
        )
      );
    },

    async handleMobileRelayCommandResult({
      commandId,
      request,
      requestBody,
      response
    }) {
      await sendRelayResult(
        response,
        mobileRelayStore.commandResult(
          {
            ...parseBody(parseJsonBody, requestBody),
            commandId
          },
          request.headers || {}
        )
      );
    }
  };
}
