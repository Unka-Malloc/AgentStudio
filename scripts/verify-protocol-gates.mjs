#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  PACTIUM_PROTOCOL,
  PACTIUM_PROTOCOL_PROFILE,
  canonicalString,
  createLedgerConsistencyProof,
  createLedgerInclusionProof,
  createLedgerTransparencyLog,
  createPactium,
  createRepairPlanner,
  createStoragePort,
  createVerifiableIndexEngine,
  createVerificationFailure,
  emptyTreeHash,
  ledgerLeafHash,
  ledgerNodeHash,
  protocolHash,
  runPactiumQualityGateProfile,
  verifyLedgerConsistencyProof,
  verifyLedgerInclusionProof,
  verifyProofBundle
} from "../src/index.js";
import {
  LICOLITE_CRITICAL_EXTENSIONS,
  createLicoLiteAspect
} from "../src/aspects/licolite/index.js";
import packageJson from "../package.json" with { type: "json" };

const root = process.cwd();
const fixturesDir = path.join(root, "tests", "fixtures");
const vectorPath = path.join(fixturesDir, "proof-vectors.json");
const snapshotPath = path.join(fixturesDir, "regression-snapshots.json");

const oldRootExports = [
  "createOperationLedger",
  "createCheckpointTreeStore",
  "createMerkleStateSubstrate",
  "checkpointTreeId",
  "startCheckpointTree",
  "createPactiumKernel"
];

function stable(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function readFixture(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function assertDeepEqual(actual, expected, label) {
  if (stable(actual) !== stable(expected)) {
    throw new Error(`${label} fixture mismatch. Run an explicit protocol review before updating ${label}.`);
  }
}

async function buildProofVectors() {
  const canonicalA = {
    z: true,
    a: [1, null, "value"],
    bytes: Buffer.from("pactium-proof-vector")
  };
  const canonicalB = {
    bytes: new Uint8Array(Buffer.from("pactium-proof-vector")),
    a: [1, null, "value"],
    z: true
  };
  const leafA = {
    protocol: PACTIUM_PROTOCOL,
    index: 0,
    factType: "operation.intent",
    factCid: "cid:sha256:1111",
    factHash: "sha256:1111",
    timestamp: "2026-01-01T00:00:00.000Z"
  };
  const leafB = {
    protocol: PACTIUM_PROTOCOL,
    index: 1,
    factType: "operation.outcome",
    factCid: "cid:sha256:2222",
    factHash: "sha256:2222",
    timestamp: "2026-01-01T00:00:01.000Z"
  };
  const leafHashes = [ledgerLeafHash(leafA), ledgerLeafHash(leafB)];
  const head = {
    protocol: PACTIUM_PROTOCOL,
    size: 2,
    rootHash: ledgerNodeHash(leafHashes[0], leafHashes[1])
  };
  const indexEngine = createVerifiableIndexEngine({ storage: createStoragePort({ inMemory: true }), domain: "vector" });
  const index = await indexEngine.createIndex([
    { key: "alpha", valueRef: "ref:alpha", valueHash: protocolHash("block", "alpha") },
    { key: "omega", valueRef: "ref:omega", valueHash: protocolHash("block", "omega") }
  ]);
  const membership = await indexEngine.prove(index.root, "alpha");
  const nonMembership = await indexEngine.prove(index.root, "middle");
  const chunkFixture = await indexEngine.createIndex(Array.from({ length: 384 }, (_, entryIndex) => ({
    key: `fixture:${String(entryIndex).padStart(4, "0")}`,
    valueRef: `ref:fixture:${entryIndex}`,
    valueHash: protocolHash("block", { fixture: "chunk-boundary", entryIndex })
  })), { domain: "vector-chunk-boundary" });
  const chunkFixtureSnapshot = await indexEngine.readSnapshot(chunkFixture.root);
  const ledger = createLedgerTransparencyLog({ storage: createStoragePort({ inMemory: true }) });
  const first = await ledger.append({ factType: "operation.intent", deterministic: true }, { timestamp: "2026-01-01T00:00:00.000Z" });
  const second = await ledger.append({ factType: "operation.outcome", deterministic: true }, { timestamp: "2026-01-01T00:00:01.000Z" });
  return {
    protocol: PACTIUM_PROTOCOL,
    canonical: {
      stableA: canonicalString(canonicalA),
      stableB: canonicalString(canonicalB),
      equal: canonicalString(canonicalA) === canonicalString(canonicalB)
    },
    hashDomains: {
      intent: protocolHash("operation.intent", { same: true }),
      outcome: protocolHash("operation.outcome", { same: true }),
      separated: protocolHash("operation.intent", { same: true }) !== protocolHash("operation.outcome", { same: true })
    },
    ledger: {
      emptyTreeHash: emptyTreeHash(),
      leafHashes,
      head,
      inclusion: createLedgerInclusionProof({ leafHashes, index: 1, leaf: leafB }),
      consistency: createLedgerConsistencyProof({
        oldHead: { protocol: PACTIUM_PROTOCOL, size: 1, rootHash: leafHashes[0] },
        newEntries: [{ leafHash: leafHashes[0] }, { leafHash: leafHashes[1] }]
      }),
      runtimeInclusionOk: verifyLedgerInclusionProof({ head: second.head, proof: second.inclusionProof }),
      runtimeConsistencyOk: verifyLedgerConsistencyProof({ oldHead: first.head, newHead: second.head, proof: second.consistencyProof })
    },
    index: {
      root: index.root,
      chunkBoundaries: index.chunkBoundaries,
      membership,
      nonMembership,
      membershipOk: indexEngine.verifyProof(membership),
      nonMembershipOk: indexEngine.verifyProof(nonMembership),
      deterministicChunkFixture: {
        root: chunkFixture.root,
        rootHash: chunkFixture.rootHash,
        height: chunkFixture.height,
        count: chunkFixture.count,
        keyRange: chunkFixture.keyRange,
        chunkBoundaries: chunkFixtureSnapshot.chunkBoundaries.map((boundary) => ({
          startKey: boundary.startKey,
          endKey: boundary.endKey,
          count: boundary.count,
          rootHash: boundary.rootHash
        }))
      }
    }
  };
}

async function buildRegressionSnapshots() {
  const rootExports = Object.keys(await import("../src/index.js")).sort();
  const licoLiteExports = Object.keys(await import("../src/aspects/licolite/index.js")).sort();
  const declarationFiles = [
    "src/index.d.ts",
    "src/aspects/licolite/index.d.ts"
  ];
  const declarations = Object.fromEntries(await Promise.all(
    declarationFiles.map(async (file) => {
      const text = await fs.readFile(path.join(root, file), "utf8");
      return [file, {
        sha256: sha256Text(text),
        byteLength: Buffer.byteLength(text),
        exportCount: Array.from(text.matchAll(/\bexport\s+(?:declare\s+)?(?:const|function|interface|type|class)\b/g)).length
      }];
    })
  ));
  const pactium = createPactium({ inMemory: true });
  const aspect = createLicoLiteAspect({ pactium, evidencePolicy: "opportunistic" });
  const envelope = await aspect.recordWorkspaceOperation({ operationId: "snapshot", workspaceId: "snap" });
  const bundle = await pactium.exportProofBundle(envelope);
  const bundleResult = await verifyProofBundle(bundle, {
    supportedCriticalExtensions: aspect.supportedCriticalExtensions
  });
  const failure = createVerificationFailure({
    layer: "workspace-projection",
    code: "derived_index_missing",
    repairable: true
  });
  return {
    protocol: PACTIUM_PROTOCOL,
    packageExports: packageJson.exports,
    rootExports,
    licoLiteExports,
    declarations,
    oldRootExportsAbsent: oldRootExports.every((name) => !rootExports.includes(name)),
    profile: PACTIUM_PROTOCOL_PROFILE,
    licoLiteDefaults: {
      workspaceProjectionDefault: aspect.workspaceProjectionDefault,
      criticalExtensions: LICOLITE_CRITICAL_EXTENSIONS
    },
    proofBundle: {
      ok: bundleResult.ok,
      bundleType: bundle.bundleType,
      blockCount: (bundle.index || bundle.blocks || []).length,
      criticalExtensions: bundle.manifest.criticalExtensions
    },
    failureCodes: [
      failure.code,
      ...createRepairPlanner().plan([failure]).tasks.map((task) => task.action)
    ]
  };
}

function makePrng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

async function runPropertyGates() {
  const seed = Number(process.env.PACTIUM_PROPERTY_SEED || 20260619);
  const random = makePrng(seed);
  for (let run = 0; run < 50; run += 1) {
    const entries = Array.from({ length: 32 }, (_, index) => ({
      key: `k-${index}`,
      valueRef: `ref-${Math.floor(random() * 100000)}`,
      valueHash: protocolHash("block", { run, index })
    }));
    const shuffled = [...entries].sort(() => random() - 0.5);
    const engine = createVerifiableIndexEngine({ storage: createStoragePort({ inMemory: true }), domain: `property-${run}` });
    const left = await engine.createIndex(entries);
    const right = await engine.createIndex(shuffled);
    if (left.root !== right.root) {
      throw new Error(`Prolly insertion-order property failed with seed ${seed}.`);
    }
    for (const key of ["k-0", "k-31", "missing"]) {
      const proof = await engine.prove(left.root, key);
      if (!engine.verifyProof(proof)) {
        throw new Error(`Index proof property failed with seed ${seed}.`);
      }
    }
  }
  return { seed, runs: 50 };
}

async function runPressureGates() {
  const full = process.env.PACTIUM_FULL_PRESSURE === "1";
  const profiles = full
    ? {
        "api:operation-lifecycle": { operations: 10000 },
        "api:licolite-record": { operations: 5000 },
        "api:index-engine": {
          operations: 100000,
          membershipProofs: 10000,
          nonMembershipProofs: 10000,
          requireDiff: true
        },
        "api:proof-bundle": { operations: 1000 },
        "api:recovery": { operations: 1000 }
      }
    : {
        "api:operation-lifecycle": { operations: 20 },
        "api:licolite-record": { operations: 20 },
        "api:index-engine": {
          operations: 512,
          membershipProofs: 100,
          nonMembershipProofs: 100,
          requireDiff: true
        },
        "api:proof-bundle": { operations: 10 },
        "api:recovery": { operations: 20 }
      };
  const results = [];
  const progressInterval = full ? 1000 : 0;
  const onProgress = full || process.env.PACTIUM_PRESSURE_PROGRESS === "1"
    ? (event) => process.stderr.write(`${stable({ event: "pressure-progress", ...event })}`)
    : null;
  for (const [profile, options] of Object.entries(profiles)) {
    emitPressureProgress(onProgress, {
      profile,
      phase: "profile:start",
      completed: 0,
      total: options.operations
    });
    results.push(await runPactiumQualityGateProfile({
      profile,
      ...options,
      progressInterval,
      onProgress
    }));
    emitPressureProgress(onProgress, {
      profile,
      phase: "profile:end",
      completed: options.operations,
      total: options.operations
    });
  }
  return {
    full,
    results
  };
}

function emitPressureProgress(onProgress, event) {
  if (typeof onProgress === "function") onProgress(event);
}

async function assertNoLegacyResidue() {
  const files = (await fs.readdir(path.join(root, "src"))).sort();
  const forbiddenFiles = ["ledger.js", "checkpoint-tree.js", "merkle-state.js", "paths.js", "kernel.js"];
  const presentForbidden = forbiddenFiles.filter((file) => files.includes(file));
  if (presentForbidden.length > 0) {
    throw new Error(`Historical storage-shaped source files remain: ${presentForbidden.join(", ")}`);
  }
  const sourceText = await Promise.all(
    files
      .filter((file) => file.endsWith(".js") || file.endsWith(".d.ts"))
      .map((file) => fs.readFile(path.join(root, "src", file), "utf8"))
  );
  const forbidden = [
    "earlier-storage-protocol",
    "createOperationLedger",
    "createCheckpointTreeStore",
    "createMerkleStateSubstrate"
  ];
  for (const pattern of forbidden) {
    if (sourceText.some((text) => text.includes(pattern))) {
      throw new Error(`Historical residue detected in src/: ${pattern}`);
    }
  }
}

async function main() {
  await assertNoLegacyResidue();
  const rootExports = Object.keys(await import("../src/index.js"));
  for (const name of oldRootExports) {
    if (rootExports.includes(name)) {
      throw new Error(`Old storage-first root export remains: ${name}`);
    }
  }
  const allowedExports = Object.keys(packageJson.exports).sort();
  assertDeepEqual(allowedExports, [".", "./licolite", "./package.json"], "package exports");
  const vectors = await buildProofVectors();
  const snapshots = await buildRegressionSnapshots();
  if (process.env.PACTIUM_UPDATE_FIXTURES === "1") {
    if (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true") {
      throw new Error("PACTIUM_UPDATE_FIXTURES is not allowed in CI.");
    }
    await fs.mkdir(fixturesDir, { recursive: true });
    await fs.writeFile(vectorPath, stable(vectors));
    await fs.writeFile(snapshotPath, stable(snapshots));
    process.stdout.write(stable({
      ok: true,
      updated: [path.relative(root, vectorPath), path.relative(root, snapshotPath)]
    }));
    return;
  }
  assertDeepEqual(vectors, await readFixture(vectorPath), "proof vectors");
  assertDeepEqual(snapshots, await readFixture(snapshotPath), "regression snapshots");
  const properties = await runPropertyGates();
  const pressure = await runPressureGates();
  process.stdout.write(stable({
    ok: true,
    gate: "pactium-protocol",
    protocol: PACTIUM_PROTOCOL,
    properties,
    pressure
  }));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
