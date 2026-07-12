#!/usr/bin/env node
import fs from "node:fs/promises";
import { createPactium, resolveDataDir } from "../src/index.js";
import { startPactiumHttpServer } from "../src/http.js";
import { createLicoLiteAspect } from "../src/aspects/licolite/index.js";
import { redactLocalOutput } from "../src/shared/output-redaction.js";

function argValue(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function hasArg(args, name) {
  return args.includes(name);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(redactLocalOutput(value), null, 2)}\n`);
}

async function bodyFromArgs(args) {
  const inline = argValue(args, "--body", "");
  if (inline) return JSON.parse(inline);
  const file = argValue(args, "--body-file", "");
  if (file) return JSON.parse(await fs.readFile(file, "utf8"));
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (text) return JSON.parse(text);
  }
  return {};
}

function usage() {
  return `Pactium

Usage:
  pactium doctor [--data-dir DIR]
  pactium serve [--data-dir DIR] [--host HOST] [--port PORT] [--max-body-bytes BYTES]
  pactium intent begin --body JSON
  pactium outcome append --body JSON
  pactium operation record --body JSON
  pactium envelope verify --body JSON
  pactium bundle verify --body JSON
  pactium licolite record --body JSON [--signer-secret SECRET]
  pactium licolite verify --body JSON [--signer-secret SECRET] [--public-key KEY] [--manifest-file PATH]

  licolite record and verify require the same signer configuration
  to verify envelopes that were recorded with a signing secret.
  Use --signer-secret or LICOLITE_SIGNING_SECRET for HMAC.
  Use --public-key for Ed25519 public-key verification.
  Use --manifest-file to load a verifier manifest JSON.
`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || hasArg(args, "--help") || hasArg(args, "-h")) {
    process.stdout.write(usage());
    return;
  }
  const dataDir = resolveDataDir(argValue(args, "--data-dir", ""));
  const pactium = createPactium({ dataDir });
  const licolite = createLicoLiteAspect({
    pactium,
    evidencePolicy: argValue(args, "--evidence-policy", "opportunistic")
  });
  const [domain, action] = args.filter((arg, index, all) => {
    if (index > 0 && all[index - 1].startsWith("--")) return false;
    return !arg.startsWith("--");
  });

  if (domain === "doctor") {
    printJson(await pactium.doctor());
    return;
  }
  if (domain === "serve") {
    const host = argValue(args, "--host", process.env.PACTIUM_HTTP_HOST || "127.0.0.1");
    const port = Number(argValue(args, "--port", process.env.PACTIUM_HTTP_PORT || "7288"));
    const maxBodyBytes = Number(argValue(args, "--max-body-bytes", process.env.PACTIUM_HTTP_MAX_BODY_BYTES || "1048576"));
    const started = await startPactiumHttpServer({ dataDir, host, port, maxBodyBytes });
    printJson({
      protocol: started.protocol,
      url: started.url,
      dataDir,
      maxBodyBytes: started.maxBodyBytes
    });
    return;
  }
  if (domain === "intent" && action === "begin") {
    printJson(await pactium.beginOperationIntent(await bodyFromArgs(args)));
    return;
  }
  if (domain === "outcome" && action === "append") {
    printJson(await pactium.appendOperationOutcome(await bodyFromArgs(args)));
    return;
  }
  if (domain === "operation" && action === "record") {
    printJson(await pactium.recordOperation(await bodyFromArgs(args)));
    return;
  }
  if (domain === "envelope" && action === "verify") {
    const input = await bodyFromArgs(args);
    const envelope = input && typeof input === "object" && input.envelope ? input.envelope : input;
    const options = input && typeof input === "object" && input.envelope ? input.options || {} : {};
    printJson(await pactium.verifyEnvelope(envelope, options));
    return;
  }
  if (domain === "bundle" && action === "verify") {
    const { verifyProofBundle } = await import("../src/index.js");
    const input = await bodyFromArgs(args);
    const bundle = input && typeof input === "object" && input.bundle ? input.bundle : input;
    const options = input && typeof input === "object" && input.bundle ? input.options || {} : {};
    printJson(await verifyProofBundle(bundle, options));
    return;
  }
  if (domain === "licolite" && action === "record") {
    const scopedLicoLite = createLicoLiteAspect({
      pactium,
      evidencePolicy: argValue(args, "--evidence-policy", "opportunistic"),
      signerSecret: argValue(args, "--signer-secret", process.env.LICOLITE_SIGNING_SECRET || "")
    });
    printJson(await scopedLicoLite.recordWorkspaceOperation(await bodyFromArgs(args)));
    return;
  }
  if (domain === "licolite" && action === "verify") {
    const signerSecret = argValue(args, "--signer-secret", process.env.LICOLITE_SIGNING_SECRET || "");
    const publicKey = argValue(args, "--public-key", "");
    const manifestFile = argValue(args, "--manifest-file", "");
    let verifierManifest = null;
    if (manifestFile) {
      verifierManifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    }
    const verifyLicoLite = createLicoLiteAspect({
      pactium,
      evidencePolicy: argValue(args, "--evidence-policy", "opportunistic"),
      signerSecret,
      signer: publicKey ? { signerId: "cli-verifier", algorithm: "ed25519", publicKey } : null
    });
    const body = await bodyFromArgs(args);
    const envelope = body.envelope || body;
    const options = body.options || {};
    const result = await verifyLicoLite.verifyEnvelope(envelope, {
      ...options,
      verifierManifest: verifierManifest || options.verifierManifest || null
    });
    printJson(result);
    return;
  }
  process.exitCode = 1;
  process.stderr.write(usage());
}

main().catch((error) => {
  process.exitCode = 1;
  printJson({
    code: "pactium_cli_error",
    error: error instanceof Error ? error.message : String(error)
  });
});
