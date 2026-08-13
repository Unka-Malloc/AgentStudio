import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { mergeCoverageScripts, summarizeSource } from "../../scripts/run-source-coverage.mjs";

function script(functions) {
  return {
    result: [{
      url: pathToFileURL(`${process.cwd()}/src/fixture.js`).href,
      functions
    }]
  };
}

describe("deterministic source coverage merger", () => {
  it("unions unique source ranges and keeps the maximum hit count across isolates", () => {
    const root = { startOffset: 0, endOffset: 24, count: 1 };
    const merged = mergeCoverageScripts([
      script([{
        functionName: "",
        isBlockCoverage: true,
        ranges: [root, { startOffset: 10, endOffset: 20, count: 0 }]
      }]),
      script([{
        functionName: "",
        isBlockCoverage: true,
        ranges: [{ ...root, count: 2 }, { startOffset: 10, endOffset: 20, count: 3 }]
      }]),
      script([{
        functionName: "",
        isBlockCoverage: false,
        ranges: [{ ...root, count: 4 }]
      }])
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].functions.length, 1);
    assert.deepEqual(merged[0].functions[0].ranges, [
      { startOffset: 0, endOffset: 24, count: 2 },
      { startOffset: 10, endOffset: 20, count: 3 }
    ]);
  });

  it("replaces function-level samples with block coverage without duplicating the script root", () => {
    const root = { startOffset: 0, endOffset: 30, count: 1 };
    const merged = mergeCoverageScripts([
      script([{
        functionName: "",
        isBlockCoverage: false,
        ranges: [root]
      }, {
        functionName: "work",
        isBlockCoverage: false,
        ranges: [{ startOffset: 5, endOffset: 25, count: 1 }]
      }]),
      script([{
        functionName: "",
        isBlockCoverage: true,
        ranges: [root, { startOffset: 20, endOffset: 29, count: 0 }]
      }, {
        functionName: "work",
        isBlockCoverage: true,
        ranges: [
          { startOffset: 5, endOffset: 25, count: 2 },
          { startOffset: 12, endOffset: 18, count: 0 }
        ]
      }])
    ]);
    assert.equal(merged[0].functions.length, 2);
    assert.equal(merged[0].functions[0].isBlockCoverage, true);
    assert.equal(merged[0].functions[0].ranges.length, 2);
    assert.equal(merged[0].functions[1].ranges.length, 2);
  });

  it("uses nested block ranges for lines and honors Node coverage-ignore comments", () => {
    const source = "const a = 1;\nif (a) {\n  use(a);\n}\n/* node:coverage ignore next */\nmiss();\n";
    const functions = [{
      functionName: "",
      isBlockCoverage: true,
      ranges: [
        { startOffset: 0, endOffset: source.length, count: 1 },
        { startOffset: source.indexOf("if"), endOffset: source.indexOf("}\n") + 1, count: 0 },
        { startOffset: source.indexOf("miss"), endOffset: source.indexOf("miss") + 7, count: 0 }
      ]
    }];
    const summary = summarizeSource(source, functions);
    assert.equal(summary.totalBranches, 3);
    assert.equal(summary.coveredBranches, 2);
    assert.ok(summary.coveredLines < summary.totalLines);
  });

  it("counts the first function only as script branches and honors disabled regions", () => {
    const source = "run();\n/* node:coverage disable */\nmiss();\n/* node:coverage enable */\nwork();\n";
    const functions = [{
      functionName: "",
      isBlockCoverage: true,
      ranges: [
        { startOffset: 0, endOffset: source.length, count: 1 },
        { startOffset: source.indexOf("miss"), endOffset: source.indexOf("miss") + 7, count: 0 }
      ]
    }, {
      functionName: "work",
      isBlockCoverage: true,
      ranges: [{ startOffset: source.indexOf("work"), endOffset: source.length, count: 1 }]
    }];
    const summary = summarizeSource(source, functions);
    assert.equal(summary.totalBranches, 3);
    assert.equal(summary.coveredBranches, 3);
    assert.equal(summary.totalFunctions, 1);
    assert.equal(summary.coveredFunctions, 1);
  });
});
