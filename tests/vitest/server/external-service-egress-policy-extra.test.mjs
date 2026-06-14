import http from "node:http";

import { describe, expect, it, vi } from "vitest";

import {
  assertExternalServiceEgressAllowed,
  assertExternalServiceRuntimeEgressAllowed,
  classifyExternalServiceHost,
  evaluateExternalServiceEgressUrl,
  evaluateExternalServiceEgressUrlWithDns,
  evaluateExternalServiceRedirectLocationWithDns,
  fetchExternalServiceWithPinnedDns
} from "../../../server/platform/common/composition-management/external-service-egress-policy.mjs";

function listen(server, ...args) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(...args, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe("ServiceHub external service egress policy", () => {
  it("classifies restricted local and private address families", () => {
    expect(classifyExternalServiceHost("localhost")).toMatchObject({
      kind: "hostname",
      category: "loopback",
      restricted: true
    });
    expect(classifyExternalServiceHost("127.0.0.1")).toMatchObject({
      kind: "ipv4",
      category: "loopback",
      restricted: true
    });
    expect(classifyExternalServiceHost("10.1.2.3")).toMatchObject({
      category: "private",
      restricted: true
    });
    expect(classifyExternalServiceHost("169.254.169.254")).toMatchObject({
      category: "link-local",
      restricted: true
    });
    expect(classifyExternalServiceHost("api.example.com")).toMatchObject({
      kind: "hostname",
      category: "hostname",
      restricted: false
    });
  });

  it("fails closed for restricted addresses unless the local-development preset is explicit", () => {
    expect(() => assertExternalServiceEgressAllowed({
      url: "http://169.254.169.254:80/latest/meta-data/",
      label: "upstream.url"
    })).toThrow("ServiceHub egress denied for upstream.url: restricted_address_link-local.");

    expect(evaluateExternalServiceEgressUrl({
      url: "http://127.0.0.1:8787/mcp",
      label: "upstream.url",
      policyPreset: "servicehub.development-local"
    })).toMatchObject({
      ok: true,
      allowLocalForDevelopment: true,
      addressCategory: "loopback"
    });
  });

  it("fails closed when DNS resolves hostnames to restricted addresses", async () => {
    const lookup = vi.fn(async () => [
      { address: "203.0.113.10", family: 4 },
      { address: "10.1.2.3", family: 4 }
    ]);

    await expect(assertExternalServiceRuntimeEgressAllowed({
      url: "https://api.example.test:443/mcp",
      label: "upstream.url",
      policyPreset: "servicehub.production-default",
      lookup
    })).rejects.toMatchObject({
      code: "servicehub_egress_denied",
      decision: {
        reason: "restricted_dns_address_private",
        dns: {
          status: "resolved",
          restrictedAddressCount: 1
        }
      }
    });
    expect(lookup).toHaveBeenCalledWith("api.example.test", { all: true, verbatim: true });

    await expect(assertExternalServiceRuntimeEgressAllowed({
      url: "https://unresolved.example.test:443/mcp",
      label: "upstream.url",
      policyPreset: "servicehub.production-default",
      lookup: async () => {
        throw new Error("ENOTFOUND");
      }
    })).rejects.toMatchObject({
      decision: {
        reason: "dns_lookup_failed",
        dns: {
          status: "failed"
        }
      }
    });
  });

  it("allows explicitly marked development-local DNS targets while recording restricted answers", async () => {
    const decision = await evaluateExternalServiceEgressUrlWithDns({
      url: "https://dev.service.test:443/mcp",
      label: "upstream.url",
      policyPreset: "servicehub.development-local",
      lookup: async () => [
        { address: "127.0.0.1", family: 4 },
        { address: "fe80::1", family: 6 }
      ]
    });

    expect(decision).toMatchObject({
      ok: true,
      reason: "allowed",
      allowLocalForDevelopment: true,
      dns: {
        status: "resolved",
        restrictedAddressCount: 2
      }
    });
  });

  it("pins fetch connections to the DNS answers evaluated by policy", async () => {
    const server = http.createServer((request, response) => {
      response.writeHead(200, {
        "content-type": "application/json",
        "x-request-host": request.headers.host || ""
      });
      response.end(JSON.stringify({ ok: true }));
    });
    const address = await listen(server, 0, "127.0.0.1");
    const lookup = vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]);
    let pinnedFetch = null;
    try {
      pinnedFetch = await fetchExternalServiceWithPinnedDns({
        url: `http://service.example.test:${address.port}/health`,
        label: "healthCheck.url",
        policyPreset: "servicehub.development-local",
        lookup,
        init: {
          redirect: "manual"
        }
      });
      expect(await pinnedFetch.response.json()).toEqual({ ok: true });
      expect(pinnedFetch.pinnedDns).toMatchObject({
        host: "service.example.test",
        address: "127.0.0.1",
        family: 4,
        addressCategory: "loopback",
        restricted: true
      });
      expect(pinnedFetch.response.headers.get("x-request-host")).toBe(`service.example.test:${address.port}`);
      expect(lookup).toHaveBeenCalledTimes(1);
      expect(lookup).toHaveBeenCalledWith("service.example.test", { all: true, verbatim: true });
    } finally {
      await pinnedFetch?.close?.();
      await closeServer(server);
    }
  });

  it("validates redirect Location decisions without following the redirect", async () => {
    const literalDecision = await evaluateExternalServiceRedirectLocationWithDns({
      sourceUrl: "https://203.0.113.10:443/start",
      status: 302,
      location: "http://169.254.169.254:80/latest/meta-data/",
      label: "tools[].transport.url.redirectLocation",
      policyPreset: "servicehub.production-default",
      lookup: async () => {
        throw new Error("literal addresses should not need DNS");
      }
    });
    expect(literalDecision).toMatchObject({
      ok: false,
      reason: "restricted_address_link-local",
      targetUrl: "http://169.254.169.254/latest/meta-data/",
      targetDecision: {
        addressCategory: "link-local"
      }
    });

    const dnsDecision = await evaluateExternalServiceRedirectLocationWithDns({
      sourceUrl: "https://redirect.example.test:443/start",
      status: 307,
      location: "/next",
      label: "tools[].transport.url.redirectLocation",
      policyPreset: "servicehub.production-default",
      lookup: async () => [{ address: "192.168.1.10", family: 4 }]
    });
    expect(dnsDecision).toMatchObject({
      ok: false,
      reason: "restricted_dns_address_private",
      targetUrl: "https://redirect.example.test/next"
    });
  });
});
