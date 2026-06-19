import crypto from "node:crypto";

import { LICOLITE_ASPECT_PROTOCOL } from "./constants.js";

function hmac(secret, text) {
  return crypto.createHmac("sha256", String(secret || "")).update(String(text || "")).digest("hex");
}

function ed25519Sign(privateKey, text) {
  if (!privateKey) throw new Error("Ed25519 LicoLite signer requires a privateKey for signing.");
  return crypto.sign(null, Buffer.from(String(text || "")), privateKey).toString("base64");
}

function ed25519Verify(publicKey, text, signature) {
  if (!publicKey || !String(signature || "").startsWith("ed25519:")) return false;
  return crypto.verify(
    null,
    Buffer.from(String(text || "")),
    publicKey,
    Buffer.from(String(signature).slice("ed25519:".length), "base64")
  );
}

function publicKeyFromPrivateKey(privateKey) {
  if (!privateKey) return "";
  return crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" });
}

/* node:coverage disable */
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeText(value, fallback = "") {
  const output = String(value ?? "").trim();
  return output || fallback;
}
/* node:coverage enable */

export function createLicoLiteSigner({
  signerId = "licolite-local",
  secret = "licolite-development-signer",
  algorithm = "",
  privateKey = "",
  publicKey = ""
} = {}) {
  const resolvedAlgorithm = safeText(algorithm, privateKey || publicKey ? "ed25519" : "hmac-sha256");
  if (resolvedAlgorithm === "ed25519") {
    const verifierPublicKey = publicKey || publicKeyFromPrivateKey(privateKey);
    return Object.freeze({
      protocol: LICOLITE_ASPECT_PROTOCOL,
      signerId,
      algorithm: "ed25519",
      publicKey: verifierPublicKey,
      async sign(message) {
        return `ed25519:${ed25519Sign(privateKey, message)}`;
      },
      async verify(message, signature) {
        return ed25519Verify(verifierPublicKey, message, signature);
      }
    });
  }
  return Object.freeze({
    protocol: LICOLITE_ASPECT_PROTOCOL,
    signerId,
    algorithm: "hmac-sha256",
    async sign(message) {
      return `hmac-sha256:${hmac(secret, message)}`;
    },
    async verify(message, signature) {
      return signature === `hmac-sha256:${hmac(secret, message)}`;
    }
  });
}
