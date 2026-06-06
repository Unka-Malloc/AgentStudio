// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createConsoleAgentExploreLayoutController } from "../../../server-web/composables/console-agent-explore-layout-controller";

function pointerEvent(type: string, clientX: number, currentTarget?: Element): PointerEvent {
  const event = new Event(type) as PointerEvent;
  Object.defineProperty(event, "clientX", {
    configurable: true,
    value: clientX,
  });
  if (currentTarget) {
    Object.defineProperty(event, "currentTarget", {
      configurable: true,
      value: currentTarget,
    });
  }
  return event;
}

function keyEvent(key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, shiftKey });
  vi.spyOn(event, "preventDefault");
  return event;
}

describe("console agent explore layout controller", () => {
  it("clamps split percentages and exposes the computed split style", () => {
    const controller = createConsoleAgentExploreLayoutController();

    expect(controller.clampAgentExploreSplitPercent(12)).toBe(28);
    expect(controller.clampAgentExploreSplitPercent(80)).toBe(68);
    expect(controller.clampAgentExploreSplitPercent(Number.NaN)).toBe(42);
    expect(controller.clampAgentExploreSplitPercent(44)).toBe(44);

    controller.agentExploreSplitLeftPercent.value = 51;
    expect(controller.agentExploreSplitStyle.value).toEqual({
      "--agent-explore-left": "51%",
    });
  });

  it("updates split from pointer positions and ignores missing or zero-width elements", () => {
    const controller = createConsoleAgentExploreLayoutController();

    controller.updateAgentExploreSplitFromClientX(500);
    expect(controller.agentExploreSplitLeftPercent.value).toBe(42);

    const split = document.createElement("section");
    split.getBoundingClientRect = vi.fn(() => ({
      left: 100,
      width: 400,
      top: 0,
      right: 500,
      bottom: 100,
      height: 100,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect));
    controller.agentExploreSplitRef.value = split;

    controller.updateAgentExploreSplitFromClientX(260);
    expect(controller.agentExploreSplitLeftPercent.value).toBe(40);

    controller.handleAgentExploreSplitPointerMove(pointerEvent("pointermove", 700));
    expect(controller.agentExploreSplitLeftPercent.value).toBe(68);

    split.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      width: 0,
      top: 0,
      right: 0,
      bottom: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect));
    controller.updateAgentExploreSplitFromClientX(20);
    expect(controller.agentExploreSplitLeftPercent.value).toBe(68);
  });

  it("handles keyboard split resizing with normal and shifted steps", () => {
    const controller = createConsoleAgentExploreLayoutController();

    controller.agentExploreSplitLeftPercent.value = 42;
    const left = keyEvent("ArrowLeft");
    controller.handleAgentExploreSplitKeydown(left);
    expect(left.preventDefault).toHaveBeenCalled();
    expect(controller.agentExploreSplitLeftPercent.value).toBe(40);

    const rightShift = keyEvent("ArrowRight", true);
    controller.handleAgentExploreSplitKeydown(rightShift);
    expect(rightShift.preventDefault).toHaveBeenCalled();
    expect(controller.agentExploreSplitLeftPercent.value).toBe(45);

    const home = keyEvent("Home");
    controller.handleAgentExploreSplitKeydown(home);
    expect(controller.agentExploreSplitLeftPercent.value).toBe(28);

    const end = keyEvent("End");
    controller.handleAgentExploreSplitKeydown(end);
    expect(controller.agentExploreSplitLeftPercent.value).toBe(68);

    const ignored = keyEvent("Escape");
    controller.handleAgentExploreSplitKeydown(ignored);
    expect(ignored.preventDefault).not.toHaveBeenCalled();
    expect(controller.agentExploreSplitLeftPercent.value).toBe(68);
  });

  it("starts and stops pointer drag while updating the split once immediately", () => {
    const controller = createConsoleAgentExploreLayoutController();
    const split = document.createElement("section");
    document.body.appendChild(split);
    split.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      width: 200,
      top: 0,
      right: 200,
      bottom: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect));
    controller.agentExploreSplitRef.value = split;

    const down = pointerEvent("pointerdown", 100, split);
    vi.spyOn(down, "preventDefault");

    controller.startAgentExploreSplitResize(down);

    expect(down.preventDefault).toHaveBeenCalled();
    expect(controller.agentExploreSplitLeftPercent.value).toBe(50);
    expect(controller.agentExploreSplitDragging.value).toBe(true);
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    document.dispatchEvent(pointerEvent("pointermove", 20));
    expect(controller.agentExploreSplitLeftPercent.value).toBe(28);

    controller.stopAgentExploreSplitResize();
    expect(controller.agentExploreSplitDragging.value).toBe(false);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  it("tracks details open state from toggle events", () => {
    const controller = createConsoleAgentExploreLayoutController();
    const details = document.createElement("details");

    details.open = false;
    controller.handleAgentExploreTraceToggle(new Event("toggle"));
    expect(controller.agentExploreTraceOpen.value).toBe(false);

    details.open = true;
    const openEvent = new Event("toggle");
    Object.defineProperty(openEvent, "currentTarget", {
      configurable: true,
      value: details,
    });
    controller.handleAgentExploreTraceToggle(openEvent);
    expect(controller.agentExploreTraceOpen.value).toBe(true);
  });
});
