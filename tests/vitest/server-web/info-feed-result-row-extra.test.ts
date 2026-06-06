// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import InfoFeedResultRow from "../../../server-web/components/InfoFeedResultRow.vue";
import type { KnowledgeSearchResult } from "../../../server-web/lib/types";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeItem(item: Partial<KnowledgeSearchResult>): KnowledgeSearchResult {
  return {
    title: "",
    ...item,
  } as KnowledgeSearchResult;
}

function mountRow(item: Partial<KnowledgeSearchResult>, tier?: "high" | "low" | "debug") {
  return mount(InfoFeedResultRow, {
    props: {
      item: makeItem(item),
      tier,
    },
  });
}

describe("InfoFeedResultRow", () => {
  it("renders high tier row with local mirror metadata, source, evidence, and score", async () => {
    const wrapper = mountRow({
      title: "邮件标题",
      snippet: "这是一个可直接打开的高相关片段。",
      evidenceId: "ev-high",
      score: 0.987654,
      localMirror: {
        matched: true,
        providerId: "provider-a",
        sourceType: "mirror",
      },
      source: {
        providerId: "ignored-provider",
        sourceType: "ignored-source",
      },
    }, "high");

    const button = wrapper.get("button");
    const details = wrapper.get("small").text();

    expect(button.attributes("data-tier")).toBe("high");
    expect(button.attributes("data-local-mirror")).toBe("true");
    expect(button.attributes("type")).toBe("button");
    expect(button.text()).toContain("邮件标题");
    expect(button.text()).toContain("本地 mirror");
    expect(wrapper.get("span").text()).toBe("这是一个可直接打开的高相关片段。");
    expect(details).toContain("ev-high");
    expect(details).toContain("0.988");
    expect(details).toContain("provider-a / mirror");

    await button.trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
    expect(wrapper.emitted("open")?.[0]).toEqual(["ev-high"]);
  });

  it("falls back title/snippet/scope values for low tier row and emits open with documentId", async () => {
    const wrapper = mountRow({
      title: "",
      snippet: "  多空   格式   \n  混杂  ",
      documentId: "doc-low-1",
      source: {
        providerId: "provider-low",
        sourceType: "docx",
      },
    }, "low");

    const button = wrapper.get("button");
    const details = wrapper.get("small").text();

    expect(button.attributes("data-tier")).toBe("low");
    expect(button.text()).toContain("未命名来源");
    expect(wrapper.get("span").text()).toBe("多空 格式 混杂");
    expect(details).toContain("doc-low-1");
    expect(details).toContain("provider-low / docx");
    expect(details).not.toContain("ev");

    await button.trigger("click");
    expect(wrapper.emitted("open")?.[0]).toEqual(["doc-low-1"]);
  });

  it("truncates long snippets, keeps score formatting, and hides source when unavailable", () => {
    const wrapper = mountRow({
      title: "很长片段测试",
      snippet: "片段 ".repeat(100),
      score: 0,
      evidenceId: "ev-trunc",
    }, "low");

    const fullNormalizedSnippet = "片段 ".repeat(100).trimEnd();
    const snippetText = wrapper.get("span").text();
    const details = wrapper.get("small").text();

    expect(snippetText).toHaveLength(180);
    expect(snippetText.endsWith("…")).toBe(true);
    expect(snippetText).toBe(`${fullNormalizedSnippet.slice(0, 179)}…`);
    expect(details).toContain("ev-trunc");
    expect(details).toContain("0.000");
    expect(details).not.toMatch(/ · .*\/.*/);
  });

  it("disables and blocks open when evidence and document id are both absent", async () => {
    const wrapper = mountRow({
      title: "无证据",
      snippet: "只展示文本",
      source: {
        providerId: "",
        sourceType: "",
      },
    });

    const button = wrapper.get("button");
    expect(button.attributes("disabled")).toBe("");
    expect(button.text()).toContain("无证据编号");

    await button.trigger("click");
    expect(wrapper.emitted("open")).toBeUndefined();
  });

  it("falls back to placeholder snippet and exercises open suppression with no identifier", async () => {
    const wrapper = mountRow({
      title: "缺少 snippet",
    }, "high");

    const button = wrapper.get("button");
    expect(wrapper.get("span").text()).toBe("无片段");
    expect(button.attributes("disabled")).toBe("");

    button.element.disabled = false;
    await button.trigger("click");
    expect(wrapper.emitted("open")).toBeUndefined();
  });
});
