function toText(value) {
  return String(value ?? "").trim();
}

const MAX_PEER_RESPONSE_BYTES = 1024 * 1024;

async function readResponseTextWithLimit(response, maxBytes = MAX_PEER_RESPONSE_BYTES) {
  if (!response?.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`Peer response exceeded the ${maxBytes} byte limit.`);
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`Peer response exceeded the ${maxBytes} byte limit.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parsePeerUrls(value = process.env.PACT_WORK_QUEUE_PEERS || "") {
  return String(value || "")
    .split(",")
    .map(toText)
    .filter(Boolean)
    .map((url) => url.replace(/\/+$/, ""));
}

function summarizeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    code: error?.code || ""
  };
}

export function createQueuePeerRegistry({
  peers = parsePeerUrls(),
  fetchImpl = globalThis.fetch,
  timeoutMs = Number(process.env.PACT_WORK_QUEUE_PEER_TIMEOUT_MS || 1500),
  authHeaders = () => ({})
} = {}) {
  const peerUrls = [...new Set((peers || []).map(toText).filter(Boolean).map((url) => url.replace(/\/+$/, "")))];
  const health = new Map(peerUrls.map((url) => [url, {
    url,
    ok: true,
    failCount: 0,
    lastError: null,
    lastCheckedAtMs: 0
  }]));

  function listPeers() {
    return peerUrls.map((url) => ({ ...(health.get(url) || { url, ok: true }) }));
  }

  async function postPeer(url, pathname, body = {}) {
    if (typeof fetchImpl !== "function") {
      return { ok: false, reason: "fetch_unavailable" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));
    try {
      const response = await fetchImpl(`${url}${pathname}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders({ url, pathname })
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const text = await readResponseTextWithLimit(response);
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = { text };
      }
      return {
        ok: response.ok,
        status: response.status,
        payload
      };
    } catch (error) {
      return {
        ok: false,
        error: summarizeError(error)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function offer(input = {}) {
    for (const url of peerUrls) {
      const state = health.get(url) || { url, ok: true, failCount: 0 };
      if (state.failCount >= 3 && Date.now() - Number(state.lastCheckedAtMs || 0) < timeoutMs * 10) {
        continue;
      }
      const result = await postPeer(url, "/api/jobs/work-queue/dispatch", {
        reason: input.reason || "peer_backpressure_handoff",
        offeredBy: input.status?.workerId || "local"
      });
      state.lastCheckedAtMs = Date.now();
      if (result.ok) {
        state.ok = true;
        state.failCount = 0;
        state.lastError = null;
        health.set(url, state);
        return {
          accepted: true,
          peerUrl: url,
          result: result.payload
        };
      }
      state.ok = false;
      state.failCount = Number(state.failCount || 0) + 1;
      state.lastError = result.error || result.payload || { status: result.status };
      health.set(url, state);
    }
    return {
      accepted: false,
      reason: peerUrls.length ? "no_healthy_peer" : "no_peer_configured",
      peers: listPeers()
    };
  }

  return Object.freeze({
    listPeers,
    offer,
    selectPeer() {
      return { offer };
    }
  });
}
