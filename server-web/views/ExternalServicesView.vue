<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import BinaryCheckbox from "../components/BinaryCheckbox.vue";
import ConfigFloatingPanel from "../components/ConfigFloatingPanel.vue";
import HelpTooltip from "../components/HelpTooltip.vue";
import StatusPill from "../components/StatusPill.vue";
import { copyConsoleTextWithFeedback } from "../composables/console-browser-effects";
import { useExternalServicesViewController } from "../composables/external-services-view-controller";
import { useServerConsoleShellContext } from "../composables/serverConsoleShellContext";
import type { ExternalServiceEntry, ExternalServiceToolReview } from "../lib/external-services-client";

const externalServicesView = useExternalServicesViewController(useServerConsoleShellContext());
const serviceTableScroller = ref<HTMLElement | null>(null);
const isServiceTableDragging = ref(false);
const serviceTableScrollState = ref({
  atEnd: true,
  atStart: true,
  canScroll: false,
});
const upstreamValueBubble = ref({
  placement: "above" as "above" | "below",
  text: "",
  visible: false,
  x: 0,
  y: 0,
});
const toolListPopover = ref({
  activeTools: [] as ExternalServiceToolReview[],
  candidateTools: [] as ExternalServiceToolReview[],
  placement: "below" as "above" | "below",
  selectedCandidateToolNames: [] as string[],
  serviceId: "",
  serviceName: "",
  tools: [] as string[],
  visible: false,
  x: 0,
  y: 0,
});
const interactiveDragTargetSelector = "a, button, input, select, textarea, [role='button'], [tabindex]";
let serviceTableDragPointerId: number | null = null;
let serviceTableDragStartX = 0;
let serviceTableDragScrollLeft = 0;
let serviceTableResizeObserver: ResizeObserver | null = null;

function updateServiceTableScrollState() {
  const scroller = serviceTableScroller.value;
  if (!scroller) {
    serviceTableScrollState.value = { atEnd: true, atStart: true, canScroll: false };
    return;
  }
  const maxScrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const scrollLeft = Math.min(maxScrollLeft, Math.max(0, scroller.scrollLeft));
  serviceTableScrollState.value = {
    atEnd: maxScrollLeft - scrollLeft <= 2,
    atStart: scrollLeft <= 2,
    canScroll: maxScrollLeft > 2,
  };
}

function fullCopyValue(value: unknown) {
  return String(value ?? "").trim();
}

const upstreamValueBubbleStyle = computed(() => ({
  left: `${upstreamValueBubble.value.x}px`,
  top: `${upstreamValueBubble.value.y}px`,
}));

const toolListPopoverStyle = computed(() => ({
  left: `${toolListPopover.value.x}px`,
  top: `${toolListPopover.value.y}px`,
}));

function serviceToolNames(service: ExternalServiceEntry) {
  return [...new Set((service.externalMcp?.tools || []).map((tool) => {
    if (typeof tool === "string") {
      return tool.trim();
    }
    if (tool && typeof tool === "object") {
      const record = tool as { name?: unknown; toolId?: unknown; id?: unknown };
      return String(record.name || record.toolId || record.id || "").trim();
    }
    return "";
  }).filter(Boolean))];
}

function toolReviewTitle(tool: ExternalServiceToolReview) {
  return String(tool.title || tool.name || "").trim();
}

function toolReviewDescription(tool: ExternalServiceToolReview) {
  return String(tool.descriptionPreview || "").trim();
}

function toolReviewSchemaLabel(tool: ExternalServiceToolReview) {
  const schema = tool.inputSchema;
  if (!schema) return "schema 未提供";
  const requiredCount = schema.required?.length || 0;
  const propertyCount = schema.propertyCount ?? schema.properties?.length ?? 0;
  return `${propertyCount} fields / ${requiredCount} required`;
}

function toolReviewPropertyLabel(tool: ExternalServiceToolReview) {
  const properties = tool.inputSchema?.properties || [];
  if (!properties.length) return "";
  const label = properties
    .slice(0, 6)
    .map((property) => `${property.name}${property.required ? "*" : ""}${property.type ? `:${property.type}` : ""}`)
    .join(", ");
  return tool.inputSchema?.truncated ? `${label}, …` : label;
}

function toolReviewTransportLabel(tool: ExternalServiceToolReview) {
  const transport = tool.transport || {};
  if (transport.rpcMethod) return `JSON-RPC ${transport.rpcMethod}`;
  if (transport.method || transport.path) return `${transport.method || "HTTP"} ${transport.path || ""}`.trim();
  if (transport.openapiOperationId) return `OpenAPI ${transport.openapiOperationId}`;
  return transport.type || "transport 未提供";
}

function toolReviewReasonLabel(tool: ExternalServiceToolReview) {
  const reason = String(tool.reasonCode || tool.review?.reasonCode || "").trim();
  if (reason === "fingerprint_changed_requires_readoption") return "指纹变化，需要重新采纳";
  if (reason === "awaiting_operator_adoption") return "新候选，等待采纳";
  if (reason === "details_missing") return "详情缺失";
  return reason || "已采纳";
}

function toolReviewChangedFields(tool: ExternalServiceToolReview) {
  return tool.review?.diff?.changedFields || [];
}

function isCandidateToolSelected(tool: ExternalServiceToolReview) {
  return toolListPopover.value.selectedCandidateToolNames.includes(tool.name);
}

function toggleCandidateToolSelection(tool: ExternalServiceToolReview, checked: boolean) {
  const name = String(tool.name || "").trim();
  if (!name) return;
  const selected = new Set(toolListPopover.value.selectedCandidateToolNames);
  if (checked) {
    selected.add(name);
  } else {
    selected.delete(name);
  }
  toolListPopover.value.selectedCandidateToolNames = [...selected].sort();
}

function handleCandidateToolSelectionChange(tool: ExternalServiceToolReview, event: Event) {
  const target = event.target;
  toggleCandidateToolSelection(tool, target instanceof HTMLInputElement && target.checked);
}

function showUpstreamValueBubble(event: MouseEvent | FocusEvent, value: unknown) {
  const text = fullCopyValue(value);
  const target = event.currentTarget;
  const browser = target instanceof Element ? target.ownerDocument.defaultView : null;
  if (!text || !(target instanceof HTMLElement) || !browser) {
    upstreamValueBubble.value.visible = false;
    return;
  }
  const rect = target.getBoundingClientRect();
  const placeBelow = rect.top < 86;
  const maxLeft = Math.max(12, browser.innerWidth - 384);
  upstreamValueBubble.value = {
    placement: placeBelow ? "below" : "above",
    text,
    visible: true,
    x: Math.max(12, Math.min(rect.left, maxLeft)),
    y: placeBelow ? rect.bottom + 8 : rect.top - 8,
  };
}

function hideUpstreamValueBubble() {
  upstreamValueBubble.value.visible = false;
}

function closeToolListPopover() {
  toolListPopover.value.visible = false;
}

function toggleToolListPopover(event: MouseEvent, service: ExternalServiceEntry) {
  const tools = serviceToolNames(service);
  const target = event.currentTarget;
  const browser = target instanceof Element ? target.ownerDocument.defaultView : null;
  if (tools.length === 0 || !(target instanceof HTMLElement) || !browser) {
    closeToolListPopover();
    return;
  }
  const isSameService = toolListPopover.value.visible && toolListPopover.value.serviceId === service.serviceId;
  if (isSameService) {
    closeToolListPopover();
    return;
  }
  const rect = target.getBoundingClientRect();
  const placeAbove = browser.innerHeight - rect.bottom < 220 && rect.top > 240;
  const maxLeft = Math.max(12, browser.innerWidth - 320);
  toolListPopover.value = {
    activeTools: externalServicesView.serviceActiveToolReviewRows(service),
    candidateTools: externalServicesView.serviceCandidateToolReviewRows(service),
    placement: placeAbove ? "above" : "below",
    selectedCandidateToolNames: externalServicesView.serviceCandidateToolReviewRows(service).map((tool) => tool.name),
    serviceId: service.serviceId,
    serviceName: service.displayName || service.serviceName || service.serviceId,
    tools,
    visible: true,
    x: Math.max(12, Math.min(rect.left, maxLeft)),
    y: placeAbove ? rect.top - 8 : rect.bottom + 8,
  };
}

async function adoptSelectedToolPopoverCandidates() {
  const service = externalServicesView.services.find((entry) => entry.serviceId === toolListPopover.value.serviceId);
  const selected = toolListPopover.value.selectedCandidateToolNames;
  if (!service || selected.length === 0) return;
  await externalServicesView.adoptCandidateTools(service, selected);
  closeToolListPopover();
}

async function copyExternalServiceValue(event: MouseEvent, value: unknown) {
  const text = fullCopyValue(value);
  if (!text) return;
  hideUpstreamValueBubble();
  await copyConsoleTextWithFeedback(event, text, { message: "已复制" });
}

function handleServiceTableScroll() {
  hideUpstreamValueBubble();
  closeToolListPopover();
  updateServiceTableScrollState();
}

function handleExternalServiceDocumentPointerDown(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !toolListPopover.value.visible) {
    return;
  }
  if (
    target.closest(".external-service-tool-popover") ||
    target.closest(".external-service-tool-list-button")
  ) {
    return;
  }
  closeToolListPopover();
}

function isInteractiveTableDragTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const interactiveElement = target.closest(interactiveDragTargetSelector);
  return Boolean(interactiveElement && interactiveElement !== serviceTableScroller.value);
}

function beginServiceTableDrag(event: PointerEvent) {
  if (event.button !== 0 || isInteractiveTableDragTarget(event.target)) {
    return;
  }
  const scroller = serviceTableScroller.value;
  if (!scroller || scroller.scrollWidth <= scroller.clientWidth) {
    return;
  }
  serviceTableDragPointerId = event.pointerId;
  serviceTableDragStartX = event.clientX;
  serviceTableDragScrollLeft = scroller.scrollLeft;
  scroller.setPointerCapture(event.pointerId);
}

function moveServiceTableDrag(event: PointerEvent) {
  if (serviceTableDragPointerId !== event.pointerId) {
    return;
  }
  const scroller = serviceTableScroller.value;
  if (!scroller) {
    return;
  }
  const deltaX = event.clientX - serviceTableDragStartX;
  if (!isServiceTableDragging.value && Math.abs(deltaX) < 4) {
    return;
  }
  isServiceTableDragging.value = true;
  scroller.scrollLeft = serviceTableDragScrollLeft - deltaX;
  updateServiceTableScrollState();
  event.preventDefault();
}

function endServiceTableDrag(event: PointerEvent) {
  const scroller = serviceTableScroller.value;
  if (serviceTableDragPointerId === event.pointerId && scroller?.hasPointerCapture(event.pointerId)) {
    scroller.releasePointerCapture(event.pointerId);
  }
  serviceTableDragPointerId = null;
  isServiceTableDragging.value = false;
  updateServiceTableScrollState();
}

function handleServiceTableKeydown(event: KeyboardEvent) {
  const scroller = serviceTableScroller.value;
  if (!scroller || event.target !== scroller) {
    return;
  }
  const scrollStep = event.shiftKey ? 320 : 96;
  if (event.key === "ArrowLeft") {
    scroller.scrollLeft -= scrollStep;
  } else if (event.key === "ArrowRight") {
    scroller.scrollLeft += scrollStep;
  } else if (event.key === "Home") {
    scroller.scrollLeft = 0;
  } else if (event.key === "End") {
    scroller.scrollLeft = scroller.scrollWidth;
  } else {
    return;
  }
  updateServiceTableScrollState();
  event.preventDefault();
}

onMounted(() => {
  document.addEventListener("pointerdown", handleExternalServiceDocumentPointerDown);
  void nextTick(() => {
    updateServiceTableScrollState();
    const scroller = serviceTableScroller.value;
    if (!scroller || typeof ResizeObserver === "undefined") {
      return;
    }
    serviceTableResizeObserver = new ResizeObserver(updateServiceTableScrollState);
    serviceTableResizeObserver.observe(scroller);
    const table = scroller.querySelector(".external-service-table");
    if (table instanceof HTMLElement) {
      serviceTableResizeObserver.observe(table);
    }
  });
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", handleExternalServiceDocumentPointerDown);
  serviceTableResizeObserver?.disconnect();
  serviceTableResizeObserver = null;
});

watch(
  () => externalServicesView.services.length,
  () => void nextTick(updateServiceTableScrollState),
);

type SelectHelpItems = Array<readonly [string, string]>;

const selectHelp: Record<string, SelectHelpItems> = {
  mode: [
    ["managed", "由 Pact 负责启动、停止和健康检查，适合平台托管的服务。"],
    ["connected", "服务已经在外部运行，Pact 只保存连接配置并调用它。"],
    ["on-demand", "默认不随平台启动，按需通过脚本或操作员动作拉起。"],
  ],
  startupPolicy: [
    ["with-platform", "跟随 Pact 平台启动，通常配合 managed 使用。"],
    ["on-demand", "需要时再启动，适合本地依赖、测试服务或可选能力。"],
    ["external-only", "Pact 不启动服务，只连接已经存在的外部运行实例。"],
  ],
  upstreamType: [
    ["MCP 服务", "外部服务本身暴露 MCP 协议，Pact 可发现并转发工具。"],
    ["ACP 服务", "外部服务使用 Agent Client / Communication Protocol 类协议。"],
    ["LLM Service", "大模型服务，后台会进一步识别模型协议和 provider。"],
    ["Cloud Drive Service", "iCloud、OneDrive、Google Drive、Dropbox 等网盘上游服务。"],
    ["HTTP 服务", "普通 HTTP JSON endpoint，必须显式写端口；生产公开服务应优先使用 HTTPS。"],
    ["HTTPS 服务", "普通 HTTPS JSON endpoint，必须显式写端口，默认启用 TLS 校验。"],
    ["JSON-RPC 服务", "JSON-RPC 2.0 endpoint，使用 method + params + result 映射为 MCP 工具。"],
    ["SSE 服务", "普通 Server-Sent Events endpoint，独立于 MCP SSE transport。"],
    ["其它服务", "暂时无法归入内置类型的服务，保留自定义类型。"],
  ],
  cloudDriveProvider: [
    ["iCloud Drive", "通过本机 iCloud Drive 受控目录适配。"],
    ["OneDrive", "v0.0.1 通过本机 OneDrive 同步目录投影适配。"],
    ["Google Drive", "通过 OAuth secretRef 和上游网关适配。"],
    ["Dropbox", "通过 OAuth secretRef 和上游网关适配。"],
  ],
  cloudDriveMode: [
    ["local", "本机目录投影，当前用于 iCloud Drive 和 OneDrive。"],
    ["contract", "只验证连接合同、secretRef、receipt 和权限语义，不调用真实远端 API。"],
    ["remote-live", "调用真实上游 provider endpoint，需要显式 endpoint 和 secretRef。"],
  ],
	  modelProtocol: [
	    ["OpenAI Compatible", "兼容 OpenAI Chat Completions 风格的模型 API。"],
	    ["OpenAI Responses", "OpenAI Responses API 风格。"],
	  ],
  transport: [
    ["streamable-http", "MCP Streamable HTTP，推荐用于现代 HTTP MCP 服务。"],
    ["sse", "Server-Sent Events 风格 MCP 连接。"],
  ],
  bindingMode: [
    ["passthrough", "将外部 MCP 工具以转发方式挂到 Pact outlet。"],
    ["compile", "将 HTTP、OpenAPI 或 RPC 配置编译成 Pact 工具。"],
  ],
  outlet: [
    ["pact.serviceHub", "把外部服务能力暴露到 Pact ServiceHub outlet。"],
  ],
  risk: [
    ["read_only", "只读操作，不应改变外部系统状态。"],
    ["safe_write", "低风险写入，例如创建草稿或非破坏性更新。"],
    ["repair_write", "维护或修复类写入，需要更高审计关注。"],
    ["destructive", "可能删除、覆盖或不可逆改变外部状态。"],
  ],
  healthCheckType: [
    ["none", "保存时不执行独立健康检查。"],
    ["http", "通过 HTTP health endpoint 检查服务是否可用。"],
  ],
};
</script>

<template>
  <section class="external-services-layout">
    <div class="external-services-summary">
      <article class="external-services-summary-item">
        <span>已保存</span>
        <strong>{{ externalServicesView.configuredCount }}</strong>
      </article>
      <article class="external-services-summary-item">
        <span>服务发现</span>
        <strong>{{ externalServicesView.discoveredServiceCount }}</strong>
      </article>
      <article class="external-services-summary-item">
        <span>MCP 工具</span>
        <strong>{{ externalServicesView.mcpToolCount }}</strong>
      </article>
      <article class="external-services-summary-item">
        <span>有效配置</span>
        <strong>{{ externalServicesView.validServiceCount }}</strong>
      </article>
    </div>

    <ConfigFloatingPanel
      :open="externalServicesView.configEditorOpen"
      :title="externalServicesView.configEditorTitle"
      :subtitle="externalServicesView.configEditorSubtitle"
      :status-tone="externalServicesView.configStatusTone"
      :status-label="externalServicesView.configStatusLabel"
      :verifying="externalServicesView.verifying"
      @close="externalServicesView.closeConfigEditor"
      @verify="externalServicesView.verifyConfig"
    >
          <div v-if="externalServicesView.loadError" class="external-service-alert is-danger">
            {{ externalServicesView.loadError }}
          </div>
          <div v-if="externalServicesView.actionError" class="external-service-alert is-danger">
            {{ externalServicesView.actionError }}
          </div>
          <div v-if="externalServicesView.actionMessage" class="external-service-alert is-info">
            {{ externalServicesView.actionMessage }}
          </div>

          <form class="external-service-config-form" @submit.prevent="externalServicesView.saveConfig">
            <section class="external-service-form-section">
              <div class="external-service-form-section-header">
                <h4>服务身份</h4>
                <span>最小注册只要求稳定服务 ID；名称默认跟随服务 ID。</span>
              </div>
              <div class="external-service-form-grid">
                <label>
                  <span>服务 ID</span>
                  <input
                    autocomplete="off"
                    :disabled="externalServicesView.configEditorMode === 'edit'"
                    :value="externalServicesView.configDraft.serviceId"
                    @input="externalServicesView.updateRootField('serviceId', ($event.target as HTMLInputElement).value)"
                  />
                </label>
              </div>
            </section>

        <section class="external-service-form-section">
          <div class="external-service-form-section-header">
            <h4>上游服务</h4>
            <span>HTTP、HTTPS、JSON-RPC、SSE 和 MCP transport 分开选择；endpoint 必须显式包含端口。</span>
          </div>
          <div class="external-service-form-grid">
            <label>
              <span class="external-service-field-label">
                <span>上游类型</span>
                <HelpTooltip aria-label="上游类型选项说明" :items="selectHelp.upstreamType" />
              </span>
              <select
                aria-label="上游类型"
                :value="externalServicesView.upstreamTypeSelectValue"
                @change="externalServicesView.updateUpstreamTypeSelection(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in externalServicesView.upstreamTypeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label v-if="externalServicesView.showCustomUpstreamType">
              <span>自定义类型</span>
              <input
                autocomplete="off"
                placeholder="internal-proprietary-service"
                :value="externalServicesView.customUpstreamTypeValue"
                @input="externalServicesView.updateCustomUpstreamType(($event.target as HTMLInputElement).value)"
              />
            </label>
            <label v-if="externalServicesView.isCloudDriveServiceDraft">
              <span class="external-service-field-label">
                <span>网盘 Provider</span>
                <HelpTooltip aria-label="网盘 Provider 选项说明" :items="selectHelp.cloudDriveProvider" />
              </span>
              <select
                aria-label="网盘 Provider"
                :value="externalServicesView.configDraft.upstream?.provider || 'icloud'"
                @change="externalServicesView.updateCloudDriveProvider(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in externalServicesView.cloudDriveProviderOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label v-if="externalServicesView.isCloudDriveServiceDraft">
              <span class="external-service-field-label">
                <span>适配模式</span>
                <HelpTooltip aria-label="网盘适配模式选项说明" :items="selectHelp.cloudDriveMode" />
              </span>
              <select
                aria-label="网盘适配模式"
                :value="externalServicesView.configDraft.upstream?.mode || 'contract'"
                @change="externalServicesView.updateCloudDriveMode(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in externalServicesView.cloudDriveModeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
	            <label v-if="externalServicesView.showMcpTransportField">
	              <span class="external-service-field-label">
	                <span>MCP Transport</span>
                <HelpTooltip aria-label="协议和传输选项说明" :items="selectHelp.transport" />
              </span>
              <select
                aria-label="MCP Transport"
                :value="externalServicesView.configDraft.upstream?.transport"
                @change="externalServicesView.updateUpstreamField('transport', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in externalServicesView.mcpTransportOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
	                </option>
	              </select>
	            </label>
            <label v-if="externalServicesView.isCloudDriveServiceDraft && externalServicesView.configDraft.upstream?.mode !== 'local'">
              <span>Secret Ref</span>
              <input
                autocomplete="off"
                placeholder="secret://pact/drive/onedrive-oauth"
                :value="externalServicesView.configDraft.upstream?.secretRef"
                @input="externalServicesView.updateUpstreamField('secretRef', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label v-if="externalServicesView.isCloudDriveServiceDraft && externalServicesView.configDraft.upstream?.mode !== 'local'">
              <span>Endpoint Ref</span>
              <input
                autocomplete="off"
                placeholder="config://pact/drive/provider-endpoint"
                :value="externalServicesView.configDraft.upstream?.endpointRef"
                @input="externalServicesView.updateUpstreamField('endpointRef', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label v-if="externalServicesView.isCloudDriveServiceDraft && externalServicesView.configDraft.upstream?.provider === 'icloud'" class="external-service-form-wide">
              <span>iCloud Root Path</span>
              <input
                autocomplete="off"
                placeholder="/Users/name/Library/Mobile Documents/com~apple~CloudDocs"
                :value="externalServicesView.configDraft.upstream?.rootPath"
                @input="externalServicesView.updateUpstreamField('rootPath', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label v-if="externalServicesView.isCloudDriveServiceDraft && externalServicesView.configDraft.upstream?.provider === 'onedrive' && externalServicesView.configDraft.upstream?.mode === 'local'" class="external-service-form-wide">
              <span>OneDrive Local Root Path</span>
              <input
                autocomplete="off"
                placeholder="/Users/name/Library/CloudStorage/OneDrive"
                :value="externalServicesView.configDraft.upstream?.rootPath"
                @input="externalServicesView.updateUpstreamField('rootPath', ($event.target as HTMLInputElement).value)"
              />
            </label>
	            <label v-if="!externalServicesView.isCloudDriveServiceDraft" class="external-service-form-wide">
	              <span>{{ externalServicesView.endpointFieldLabel }}</span>
	              <input
                autocomplete="off"
                :placeholder="externalServicesView.endpointFieldPlaceholder"
                :value="externalServicesView.endpointFieldValue"
                @input="externalServicesView.updateUpstreamField('url', ($event.target as HTMLInputElement).value)"
	              />
	            </label>
            <label v-if="externalServicesView.isCloudDriveServiceDraft && externalServicesView.configDraft.upstream?.mode === 'remote-live'" class="external-service-form-wide">
              <span>Endpoint URL</span>
              <input
                autocomplete="off"
                placeholder="http://127.0.0.1:8787/cloud-drive/"
                :value="externalServicesView.configDraft.upstream?.endpointUrl || externalServicesView.configDraft.upstream?.url"
                @input="externalServicesView.updateUpstreamField('endpointUrl', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </section>

        <section v-if="externalServicesView.minimumFieldLabels.length" class="external-service-form-section external-service-field-contract-section">
          <div class="external-service-form-section-header">
            <h4>注册字段</h4>
            <span>{{ externalServicesView.currentTemplateLabel }}</span>
          </div>
          <div class="external-service-field-contract-grid">
            <article>
              <strong>最小组合</strong>
              <div class="external-service-field-chip-list">
                <code v-for="field in externalServicesView.minimumFieldLabels" :key="field">{{ field }}</code>
              </div>
            </article>
            <article>
              <strong>必填分组</strong>
              <div class="external-service-field-chip-list">
                <span
                  v-for="group in externalServicesView.requiredFieldGroupSummaries"
                  :key="group.id"
                  class="external-service-field-group-pill"
                >
                  {{ group.label }}
                </span>
              </div>
            </article>
            <article>
              <strong>组合可选</strong>
              <div class="external-service-field-chip-list">
                <span
                  v-for="group in externalServicesView.optionalFieldGroupSummaries"
                  :key="group.id"
                  class="external-service-field-group-pill"
                  :title="group.fields.join(', ')"
                >
                  {{ group.label }}<small v-if="group.mode"> / {{ group.mode }}</small>
                </span>
              </div>
            </article>
            <article>
              <strong>自动默认</strong>
              <div class="external-service-field-chip-list">
                <code v-for="field in externalServicesView.defaultedFieldLabels" :key="field">{{ field }}</code>
              </div>
            </article>
          </div>
        </section>

        <section v-if="externalServicesView.showToolMappingFields" class="external-service-form-section">
          <div class="external-service-form-section-header">
            <h4>工具映射</h4>
            <span>只填写第一个最小工具；更多映射可在高级 JSON 中追加。</span>
          </div>
          <div class="external-service-form-grid">
            <label>
              <span>工具名</span>
              <input
                autocomplete="off"
                placeholder="searchItems"
                :value="externalServicesView.primaryToolName"
                @input="externalServicesView.updatePrimaryToolField('name', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label v-if="externalServicesView.isHttpJsonServiceDraft">
              <span>HTTP Method</span>
              <select
                aria-label="HTTP Method"
                :value="externalServicesView.primaryHttpMethod"
                @change="externalServicesView.updatePrimaryToolField('method', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="method in externalServicesView.httpMethodOptions" :key="method" :value="method">
                  {{ method }}
                </option>
              </select>
            </label>
            <label v-if="externalServicesView.isHttpJsonServiceDraft" class="external-service-form-wide">
              <span>Path</span>
              <input
                autocomplete="off"
                placeholder="/v1/items/{id}"
                :value="externalServicesView.primaryHttpPath"
                @input="externalServicesView.updatePrimaryToolField('path', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label v-if="externalServicesView.isJsonRpcServiceDraft" class="external-service-form-wide">
              <span>RPC Method</span>
              <input
                autocomplete="off"
                placeholder="ticket.lookup"
                :value="externalServicesView.primaryRpcMethod"
                @input="externalServicesView.updatePrimaryToolField('method', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </section>

        <details class="external-service-advanced-json">
          <summary>可选字段</summary>

	        <section v-if="externalServicesView.isLlmServiceDraft" class="external-service-form-section">
          <div class="external-service-form-section-header">
            <h4>模型网关 Hint</h4>
            <span>Provider 是可选提示；默认由 endpoint 和 modelProtocol 推断。</span>
          </div>
          <div class="external-service-form-grid">
            <label>
              <span class="external-service-field-label">
                <span>模型协议</span>
                <HelpTooltip aria-label="模型协议选项说明" :items="selectHelp.modelProtocol" />
              </span>
              <select
                aria-label="模型协议"
                :value="externalServicesView.modelProtocolSelectValue"
                @change="externalServicesView.updateModelProtocol(($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in externalServicesView.modelProtocolOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label>
              <span>Provider</span>
              <input
                autocomplete="off"
                placeholder="openai / anthropic / google / aws-bedrock"
                :value="externalServicesView.configDraft.upstream?.provider"
                @input="externalServicesView.updateModelProvider(($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
	        </section>

        <section
          v-if="externalServicesView.advancedOptionalFieldRows && externalServicesView.advancedOptionalFieldRows.length"
          class="external-service-form-section"
        >
          <div class="external-service-form-section-header">
            <h4>组合可选字段</h4>
            <span>按模板契约填写，留空表示不启用该可选组合。</span>
          </div>
          <div class="external-service-form-grid">
            <label
              v-for="row in externalServicesView.advancedOptionalFieldRows"
              :key="row.id"
              class="external-service-form-wide"
            >
              <span class="external-service-field-label">
                <span>{{ row.groupLabel }} / {{ row.label }}</span>
                <small>{{ row.path }}</small>
              </span>
              <textarea
                rows="2"
                spellcheck="false"
                :placeholder="row.placeholder"
                :value="row.value"
                @input="externalServicesView.updateAdvancedOptionalField(row.path, ($event.target as HTMLTextAreaElement).value)"
              />
            </label>
          </div>
        </section>

	        <section class="external-service-form-section">
          <div class="external-service-form-section-header">
            <h4>显示与运行覆盖</h4>
            <span>这些字段都有默认值；只有需要覆盖时填写。</span>
          </div>
          <div class="external-service-form-grid">
            <label>
              <span>服务名称</span>
              <input
                autocomplete="off"
                :value="externalServicesView.configDraft.serviceName"
                @input="externalServicesView.updateRootField('serviceName', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              <span>超时 ms</span>
              <input
                inputmode="numeric"
                type="number"
                min="1"
                :value="externalServicesView.configDraft.upstream?.timeoutMs ?? ''"
                @input="externalServicesView.updateUpstreamField('timeoutMs', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              <span class="external-service-field-label">
                <span>运行模式</span>
                <HelpTooltip aria-label="运行模式选项说明" :items="selectHelp.mode" />
              </span>
              <select
                aria-label="运行模式"
                :value="externalServicesView.configDraft.mode"
                @change="externalServicesView.updateRootField('mode', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in externalServicesView.modeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label>
              <span class="external-service-field-label">
                <span>启动策略</span>
                <HelpTooltip aria-label="启动策略选项说明" :items="selectHelp.startupPolicy" />
              </span>
              <select
                aria-label="启动策略"
                :value="externalServicesView.configDraft.startupPolicy"
                @change="externalServicesView.updateRootField('startupPolicy', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in externalServicesView.startupPolicyOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label class="external-service-form-wide">
              <span>描述</span>
              <textarea
                rows="3"
                :value="externalServicesView.configDraft.description"
                @input="externalServicesView.updateRootField('description', ($event.target as HTMLTextAreaElement).value)"
              />
            </label>
          </div>
        </section>

        <section class="external-service-form-section">
          <div class="external-service-form-section-header">
            <h4>SecretStore Auth</h4>
            <span>组合可选字段；不鉴权时全部留空，鉴权时必须使用 secret:// 引用。</span>
          </div>
          <div class="external-service-form-grid">
            <label>
              <span>Auth Type</span>
              <input
                autocomplete="off"
                placeholder="bearer / api-key / basic"
                :value="externalServicesView.upstreamAuthType"
                @input="externalServicesView.updateUpstreamAuthField('type', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              <span>Secret Ref</span>
              <input
                autocomplete="off"
                placeholder="secret://servicehub/my-service/api-key"
                :value="externalServicesView.upstreamAuthSecretRef"
                @input="externalServicesView.updateUpstreamAuthField('secretRef', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              <span>Header Name</span>
              <input
                autocomplete="off"
                placeholder="X-API-Key"
                :value="externalServicesView.upstreamAuthHeaderName"
                @input="externalServicesView.updateUpstreamAuthField('headerName', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </section>

        <section class="external-service-form-section">
          <div class="external-service-form-section-header">
            <h4>Pact 暴露</h4>
            <span>控制下游 MCP outlet、权限范围和风险标签。</span>
          </div>
          <div class="external-service-form-grid">
            <label>
              <span class="external-service-field-label">
                <span>绑定模式</span>
                <HelpTooltip aria-label="绑定模式选项说明" :items="selectHelp.bindingMode" />
              </span>
              <select
                aria-label="绑定模式"
                :value="externalServicesView.configDraft.binding?.mode"
                @change="externalServicesView.updateBindingField('mode', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in externalServicesView.bindingModeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label>
              <span class="external-service-field-label">
                <span>Outlet</span>
                <HelpTooltip aria-label="Outlet 选项说明" :items="selectHelp.outlet" />
              </span>
              <select
                aria-label="Outlet"
                :value="externalServicesView.configDraft.binding?.outlet"
                @change="externalServicesView.updateBindingField('outlet', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in externalServicesView.bindingOutletOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label>
              <span class="external-service-field-label">
                <span>风险</span>
                <HelpTooltip aria-label="风险选项说明" :items="selectHelp.risk" />
              </span>
              <select
                aria-label="风险"
                :value="externalServicesView.configDraft.binding?.risk"
                @change="externalServicesView.updateBindingField('risk', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in externalServicesView.riskOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label class="external-service-form-wide">
              <span>Required Scopes</span>
              <input
                autocomplete="off"
                :value="externalServicesView.requiredScopesText"
                @input="externalServicesView.updateRequiredScopes(($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </section>

        <section class="external-service-form-section">
          <div class="external-service-form-section-header">
            <h4>健康检查</h4>
            <span>可选。MCP 服务保存时会额外校验 initialize 和 tools/list。</span>
          </div>
          <div class="external-service-form-grid">
            <label>
              <span class="external-service-field-label">
                <span>类型</span>
                <HelpTooltip aria-label="健康检查类型选项说明" :items="selectHelp.healthCheckType" />
              </span>
              <select
                aria-label="健康检查类型"
                :value="externalServicesView.configDraft.healthCheck?.type"
                @change="externalServicesView.updateHealthCheckField('type', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="option in externalServicesView.healthCheckTypeOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label>
              <span>Host</span>
              <input
                autocomplete="off"
                :value="externalServicesView.configDraft.healthCheck?.host"
                @input="externalServicesView.updateHealthCheckField('host', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              <span>Port</span>
              <input
                inputmode="numeric"
                type="number"
                min="1"
                max="65535"
                :value="externalServicesView.configDraft.healthCheck?.port ?? ''"
                @input="externalServicesView.updateHealthCheckField('port', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              <span>Timeout ms</span>
              <input
                inputmode="numeric"
                type="number"
                min="1"
                :value="externalServicesView.configDraft.healthCheck?.timeoutMs ?? ''"
                @input="externalServicesView.updateHealthCheckField('timeoutMs', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="external-service-form-wide">
              <span>健康检查 URL</span>
              <input
                autocomplete="off"
                :value="externalServicesView.configDraft.healthCheck?.url"
                @input="externalServicesView.updateHealthCheckField('url', ($event.target as HTMLInputElement).value)"
              />
            </label>
            <BinaryCheckbox
              class="external-service-checkbox-row"
              label="保存时要求健康检查通过"
              :model-value="externalServicesView.configDraft.healthCheck?.required === true"
              @update:model-value="externalServicesView.updateHealthCheckRequired"
            />
          </div>
        </section>

        </details>

        <details class="external-service-advanced-json">
          <summary>高级 JSON 配置</summary>
          <textarea
            class="external-service-config-editor"
            spellcheck="false"
            :value="externalServicesView.configText"
            @input="externalServicesView.onConfigInput(($event.target as HTMLTextAreaElement).value)"
          />
        </details>

        <div class="external-service-validation-grid">
          <section>
            <h4>错误</h4>
            <p v-if="externalServicesView.validationErrors.length === 0">无</p>
            <ul v-else>
              <li v-for="item in externalServicesView.validationErrors" :key="item">{{ item }}</li>
            </ul>
          </section>
          <section>
            <h4>警告</h4>
            <p v-if="externalServicesView.validationWarnings.length === 0">无</p>
            <ul v-else>
              <li v-for="item in externalServicesView.validationWarnings" :key="item">{{ item }}</li>
            </ul>
          </section>
        </div>
            <footer class="external-service-config-footer">
              <button
                class="tool-button tool-button-ghost"
                type="button"
                @click="externalServicesView.closeConfigEditor"
              >
                取消
              </button>
              <button
                class="primary-action"
                type="submit"
                :disabled="externalServicesView.saving"
              >
                {{ externalServicesView.saving ? "保存中" : "保存配置" }}
              </button>
            </footer>
          </form>
    </ConfigFloatingPanel>

    <article class="surface-card external-service-list-card">
      <div class="section-header external-service-list-header">
        <div class="external-service-list-heading">
          <h3>服务列表</h3>
          <div class="section-tags">
            <span>预设 {{ externalServicesView.presetCount }}</span>
            <span>工具缓存 {{ externalServicesView.discoveryCacheUpdatedAtLabel }}</span>
          </div>
        </div>
        <div class="external-service-actions">
          <button
            class="primary-action"
            type="button"
            @click="externalServicesView.openAddServiceConfig"
          >
            添加服务
          </button>
          <button
            class="tool-button tool-button-ghost"
            type="button"
            :disabled="externalServicesView.loading"
            @click="externalServicesView.refreshExternalServices"
          >
            {{ externalServicesView.loading ? "刷新中" : "刷新列表" }}
          </button>
        </div>
      </div>

      <div v-if="externalServicesView.loadError" class="external-service-alert is-danger">
        {{ externalServicesView.loadError }}
      </div>
      <div v-if="externalServicesView.actionError" class="external-service-alert is-danger">
        {{ externalServicesView.actionError }}
      </div>
      <div v-if="externalServicesView.actionMessage" class="external-service-alert is-info">
        {{ externalServicesView.actionMessage }}
      </div>

      <div
        ref="serviceTableScroller"
        class="external-service-table-scroll"
        :class="{
          'has-horizontal-overflow': serviceTableScrollState.canScroll,
          'has-left-overflow': serviceTableScrollState.canScroll && !serviceTableScrollState.atStart,
          'has-right-overflow': serviceTableScrollState.canScroll && !serviceTableScrollState.atEnd,
          'is-dragging': isServiceTableDragging,
        }"
        role="region"
        tabindex="0"
        aria-label="外部服务列表横向滚动区"
        @scroll="handleServiceTableScroll"
        @keydown="handleServiceTableKeydown"
        @pointerdown="beginServiceTableDrag"
        @pointermove="moveServiceTableDrag"
        @pointerup="endServiceTableDrag"
        @pointerleave="endServiceTableDrag"
        @pointercancel="endServiceTableDrag"
      >
        <div class="external-service-table">
          <div class="external-service-table-header">
            <span>服务</span>
            <span>上游</span>
            <span>服务发现</span>
            <span>状态</span>
            <span>心跳记录</span>
            <span>运行策略</span>
            <span>操作</span>
          </div>
          <div
            v-for="service in externalServicesView.services"
            :key="service.entryId"
            class="external-service-table-row"
          >
            <div class="external-service-name-cell" data-label="服务">
              <div class="external-service-title-line">
                <strong :title="service.displayName">{{ service.displayName }}</strong>
                <HelpTooltip
                  v-if="service.description"
                  :aria-label="`${service.displayName} 服务说明`"
                  :text="service.description"
                />
              </div>
              <small :title="externalServicesView.serviceSourceDetail(service)">
                {{ externalServicesView.serviceSourceDetail(service) }}
              </small>
              <small class="external-service-code-value" :title="service.serviceName">{{ service.serviceName }}</small>
            </div>
            <div class="external-service-stack-cell" data-label="上游">
              <button
                class="external-service-upstream-copy external-service-code-value"
                type="button"
                :aria-label="`复制上游：${externalServicesView.upstreamTargetLabel(service)}`"
                @mouseenter="showUpstreamValueBubble($event, externalServicesView.upstreamTargetLabel(service))"
                @focus="showUpstreamValueBubble($event, externalServicesView.upstreamTargetLabel(service))"
                @mouseleave="hideUpstreamValueBubble"
                @blur="hideUpstreamValueBubble"
                @click="copyExternalServiceValue($event, externalServicesView.upstreamTargetLabel(service))"
              >
                {{ externalServicesView.upstreamTargetLabel(service) }}
              </button>
              <small :title="externalServicesView.upstreamTargetDetailLabel(service)">
                {{ externalServicesView.upstreamTargetDetailLabel(service) }}
              </small>
            </div>
            <div class="external-service-pill-stack" data-label="服务发现">
              <StatusPill
                :tone="externalServicesView.serviceDiscoveryTone(service)"
                :label="externalServicesView.serviceDiscoveryLabel(service)"
              />
              <StatusPill
                :tone="externalServicesView.serviceDiscoveryRegistrationTone(service)"
                :label="externalServicesView.serviceDiscoveryRegistrationLabel(service)"
              />
            </div>
            <div class="external-service-pill-stack external-service-validation-pill-stack" data-label="状态">
              <StatusPill
                :tone="service.validationStatus === 'valid' ? 'success' : 'danger'"
                :label="service.validationStatus === 'valid' ? '有效' : '无效'"
              />
              <StatusPill
                v-if="service.externalMcp"
                :tone="externalServicesView.serviceCandidateToolCount(service) > 0 ? 'warning' : 'success'"
                :show-dot="false"
                :label="externalServicesView.serviceToolAdoptionLabel(service)"
              />
            </div>
            <div class="external-service-pill-stack external-service-time-pill-stack" data-label="心跳记录">
              <StatusPill
                tone="neutral"
                :show-dot="false"
                :label="externalServicesView.serviceHeartbeatLastAtLabel(service)"
              />
            </div>
            <div class="external-service-stack-cell" data-label="运行策略">
              <span :title="service.mode">{{ service.mode }}</span>
              <small :title="service.startupPolicy">{{ service.startupPolicy }}</small>
              <small :title="`${service.requiredOperations.length} operations / ${service.scriptCount} scripts`">
                {{ service.requiredOperations.length }} operations / {{ service.scriptCount }} scripts
              </small>
            </div>
            <div class="external-service-row-actions" data-label="操作">
              <button
                class="tool-button tool-button-ghost"
                type="button"
                :aria-label="`修改 ${service.displayName} 配置`"
                @click="externalServicesView.openEditServiceConfig(service)"
              >
                修改配置
              </button>
              <button
                class="tool-button tool-button-ghost"
                type="button"
                :disabled="externalServicesView.isServiceHeartbeatRefreshing(service)"
                :aria-label="`探测 ${service.displayName} 服务`"
                @click="externalServicesView.refreshRuntime(service.serviceId)"
              >
                {{ externalServicesView.isServiceHeartbeatRefreshing(service) ? "探测中" : "服务探测" }}
              </button>
              <button
                v-if="serviceToolNames(service).length > 0"
                class="tool-button tool-button-ghost external-service-tool-list-button"
                type="button"
                :aria-expanded="toolListPopover.visible && toolListPopover.serviceId === service.serviceId"
                :aria-label="`查看 ${service.displayName} 工具列表`"
                @click="toggleToolListPopover($event, service)"
              >
                工具列表
              </button>
              <button
                v-if="externalServicesView.serviceCandidateToolCount(service) > 0"
                class="tool-button tool-button-ghost"
                type="button"
                :disabled="externalServicesView.isServiceToolAdopting(service)"
                :aria-label="`采纳 ${service.displayName} 候选工具`"
                @click="externalServicesView.adoptCandidateTools(service)"
              >
                {{ externalServicesView.isServiceToolAdopting(service) ? "采纳中" : "采纳候选" }}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div
        v-if="upstreamValueBubble.visible"
        class="external-service-upstream-bubble"
        :class="`is-${upstreamValueBubble.placement}`"
        :style="upstreamValueBubbleStyle"
        role="tooltip"
      >
        {{ upstreamValueBubble.text }}
      </div>
      <div
        v-if="toolListPopover.visible"
        class="external-service-tool-popover"
        :class="`is-${toolListPopover.placement}`"
        :style="toolListPopoverStyle"
        role="dialog"
        aria-label="工具列表"
        @keydown.esc="closeToolListPopover"
      >
        <div class="external-service-tool-popover-header">
          <div>
            <strong>工具审查</strong>
            <span>{{ toolListPopover.serviceName }}</span>
          </div>
          <button
            class="external-service-tool-popover-close"
            type="button"
            aria-label="关闭工具列表"
            @click="closeToolListPopover"
          >
            ×
          </button>
        </div>
        <div class="external-service-tool-popover-body">
        <div v-if="toolListPopover.candidateTools.length" class="external-service-tool-review-section">
          <div class="external-service-tool-review-section-header">
            <strong>Candidate</strong>
            <button
              class="tool-button tool-button-ghost"
              type="button"
              :disabled="toolListPopover.selectedCandidateToolNames.length === 0 || externalServicesView.isServiceToolAdopting(toolListPopover.serviceId)"
              @click="adoptSelectedToolPopoverCandidates"
            >
              {{ externalServicesView.isServiceToolAdopting(toolListPopover.serviceId) ? "采纳中" : "采纳所选" }}
            </button>
          </div>
          <ul class="external-service-tool-list">
            <li
              v-for="tool in toolListPopover.candidateTools"
              :key="tool.name"
              class="external-service-tool-item external-service-tool-review-item"
            >
              <label class="external-service-tool-review-title">
                <input
                  type="checkbox"
                  :checked="isCandidateToolSelected(tool)"
                  @change="handleCandidateToolSelectionChange(tool, $event)"
                />
                <span>{{ toolReviewTitle(tool) }}</span>
              </label>
              <small>{{ tool.name }} · {{ toolReviewReasonLabel(tool) }}</small>
              <small v-if="toolReviewDescription(tool)">{{ toolReviewDescription(tool) }}</small>
              <small>{{ toolReviewSchemaLabel(tool) }}<template v-if="toolReviewPropertyLabel(tool)"> · {{ toolReviewPropertyLabel(tool) }}</template></small>
              <small>{{ toolReviewTransportLabel(tool) }}<template v-if="tool.risk"> · risk {{ tool.risk }}</template></small>
              <small v-if="toolReviewChangedFields(tool).length">changed {{ toolReviewChangedFields(tool).join(", ") }}</small>
              <small v-if="tool.fingerprint" class="external-service-code-value">fp {{ tool.fingerprint.slice(0, 12) }}</small>
              <small v-if="tool.previousFingerprint" class="external-service-code-value">prev {{ tool.previousFingerprint.slice(0, 12) }}</small>
            </li>
          </ul>
        </div>
        <div v-if="toolListPopover.activeTools.length" class="external-service-tool-review-section">
          <div class="external-service-tool-review-section-header">
            <strong>Active</strong>
          </div>
          <ul class="external-service-tool-list">
            <li
              v-for="tool in toolListPopover.activeTools"
              :key="tool.name"
              class="external-service-tool-item external-service-tool-review-item is-active"
            >
              <strong>{{ toolReviewTitle(tool) }}</strong>
              <small>{{ tool.name }} · {{ toolReviewSchemaLabel(tool) }}</small>
              <small>{{ toolReviewTransportLabel(tool) }}<template v-if="tool.risk"> · risk {{ tool.risk }}</template></small>
              <small v-if="tool.fingerprint" class="external-service-code-value">fp {{ tool.fingerprint.slice(0, 12) }}</small>
            </li>
          </ul>
        </div>
        <ul v-if="!toolListPopover.candidateTools.length && !toolListPopover.activeTools.length" class="external-service-tool-list">
          <li v-for="tool in toolListPopover.tools" :key="tool" class="external-service-tool-item">
            {{ tool }}
          </li>
        </ul>
        </div>
      </div>
      <div v-if="!externalServicesView.loading && externalServicesView.services.length === 0" class="empty-state">
        <strong>暂无外部服务</strong>
        <span>点击添加服务，注册一个外部服务 endpoint。</span>
      </div>
    </article>
  </section>
</template>

<style scoped>
.external-services-layout {
  display: grid;
  gap: var(--space-4);
}

.external-services-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
}

.external-services-summary-item {
  display: grid;
  gap: var(--space-2);
  min-height: 76px;
  padding: var(--space-3-5) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.external-services-summary-item span,
.external-service-form-section-header span,
.external-service-detail-cell small,
.external-service-stack-cell small,
.external-service-name-cell small {
  color: var(--text-muted);
  font-size: var(--text-md);
  line-height: 1.45;
}

.external-services-summary-item strong {
  color: var(--text-primary);
  font-size: var(--text-5xl);
}

.external-service-list-card,
.external-service-config-form {
  display: grid;
  gap: var(--space-4);
}

.external-service-list-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-3);
  margin-bottom: 0;
}

.external-service-list-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-width: 0;
}

.external-service-list-heading h3 {
  line-height: 1.2;
}

.external-service-list-heading .section-tags {
  justify-content: flex-end;
  max-width: 60%;
  min-width: 0;
}

.external-service-list-header .external-service-actions {
  justify-content: flex-end;
  width: 100%;
}

.external-service-config-footer {
  position: sticky;
  bottom: 0;
  z-index: var(--z-raised);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  box-shadow: var(--shadow-xs);
}

.external-service-actions,
.external-service-row-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
}

.external-service-row-actions {
  flex-wrap: nowrap;
  flex-direction: column;
  justify-content: center;
  align-items: stretch;
}

.external-service-row-actions .tool-button {
  width: 104px;
  height: 30px;
  min-height: 30px;
  padding: 0 var(--space-2);
  font-size: var(--text-md);
  white-space: nowrap;
}

.external-service-alert {
  padding: var(--space-2-5) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
  line-height: 1.5;
}

.external-service-alert.is-danger {
  border: 1px solid var(--danger-border);
  background: var(--danger-surface);
  color: var(--danger);
}

.external-service-alert.is-info {
  border: 1px solid var(--info-border);
  background: var(--info-surface);
  color: var(--info);
}

.external-service-form-section {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-subtle);
}

.external-service-form-section-header {
  display: grid;
  gap: var(--space-1);
}

.external-service-form-section-header h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--text-lg);
}

.external-service-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}

.external-service-form-grid label {
  display: grid;
  gap: var(--space-1-5);
  min-width: 0;
  color: var(--text-secondary);
  font-size: var(--text-md);
  font-weight: var(--font-semibold);
}

.external-service-field-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  width: fit-content;
  min-width: 0;
}

.external-service-form-grid input,
.external-service-form-grid select,
.external-service-form-grid textarea {
  width: 100%;
  min-height: 34px;
  padding: 0 var(--space-2-5);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  font: inherit;
  font-weight: var(--font-normal);
}

.external-service-form-grid textarea {
  min-height: 78px;
  padding: var(--space-2-5);
  resize: vertical;
  line-height: 1.5;
}

.external-service-form-grid input:focus,
.external-service-form-grid select:focus,
.external-service-form-grid textarea:focus,
.external-service-config-editor:focus {
  border-color: var(--brand);
  outline: none;
  box-shadow: 0 0 0 3px var(--brand-subtle);
}

.external-service-form-grid input:disabled {
  background: var(--bg-inset);
  color: var(--text-muted);
}

.external-service-form-wide {
  grid-column: span 3;
}

.external-service-field-contract-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.external-service-field-contract-grid article {
  display: grid;
  align-content: start;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
}

.external-service-field-contract-grid strong {
  color: var(--text-secondary);
  font-size: var(--text-md);
}

.external-service-field-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1-5);
  min-width: 0;
}

.external-service-field-chip-list code,
.external-service-field-group-pill {
  max-width: 100%;
  overflow-wrap: anywhere;
  padding: 2px var(--space-1-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-inset);
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: 1.4;
}

.external-service-field-group-pill small {
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.external-service-checkbox-row {
  grid-column: span 3;
  width: fit-content;
}

.external-service-advanced-json {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.external-service-advanced-json summary {
  cursor: pointer;
  padding: var(--space-3) var(--space-4);
  color: var(--text-secondary);
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
}

.external-service-config-editor {
  width: 100%;
  min-height: 300px;
  resize: vertical;
  padding: var(--space-3-5);
  border: 0;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-md);
  line-height: 1.55;
}

.external-service-validation-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.external-service-validation-grid section {
  min-height: 92px;
  padding: var(--space-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
}

.external-service-validation-grid h4 {
  margin: 0 0 var(--space-2);
  font-size: var(--text-base);
}

.external-service-validation-grid p,
.external-service-validation-grid ul {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-md);
  line-height: 1.5;
}

.external-service-validation-grid ul {
  padding-left: var(--space-5);
}

.external-service-table-scroll {
  --external-service-table-edge-shadow: color-mix(in srgb, var(--text-primary) 18%, transparent);
  position: relative;
  overflow-x: auto;
  overflow-y: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  cursor: grab;
  overscroll-behavior-x: contain;
  scroll-behavior: smooth;
  scrollbar-gutter: stable;
  touch-action: pan-x pan-y;
  transition: box-shadow var(--transition-default);
  -webkit-overflow-scrolling: touch;
}

.external-service-table-scroll.has-left-overflow.has-right-overflow {
  box-shadow:
    inset 14px 0 12px -14px var(--external-service-table-edge-shadow),
    inset -14px 0 12px -14px var(--external-service-table-edge-shadow);
}

.external-service-table-scroll.has-left-overflow:not(.has-right-overflow) {
  box-shadow: inset 14px 0 12px -14px var(--external-service-table-edge-shadow);
}

.external-service-table-scroll.has-right-overflow:not(.has-left-overflow) {
  box-shadow: inset -14px 0 12px -14px var(--external-service-table-edge-shadow);
}

.external-service-table-scroll:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

.external-service-table-scroll.is-dragging {
  cursor: grabbing;
  user-select: none;
}

.external-service-table {
  display: grid;
  min-width: 1220px;
  gap: 0;
  background: var(--bg-surface);
}

.external-service-table-header,
.external-service-table-row {
  display: grid;
  grid-template-columns: minmax(232px, 1fr) minmax(210px, 0.78fr) minmax(132px, 0.5fr) minmax(82px, 0.3fr) minmax(170px, 0.64fr) minmax(190px, 0.68fr) minmax(132px, 0.44fr);
  gap: var(--space-3);
  align-items: center;
}

.external-service-table-header > *,
.external-service-table-row > * {
  min-width: 0;
}

.external-service-table-header > :last-child,
.external-service-table-row > .external-service-row-actions {
  position: sticky;
  right: 0;
  z-index: 1;
  align-self: stretch;
  border-left: 1px solid var(--border-subtle);
}

.external-service-table-scroll.has-horizontal-overflow .external-service-table-header > :last-child,
.external-service-table-scroll.has-horizontal-overflow .external-service-table-row > .external-service-row-actions {
  box-shadow: -6px 0 8px -8px var(--external-service-table-edge-shadow);
}

.external-service-table-header > :last-child {
  display: flex;
  align-items: center;
  margin: calc(-1 * var(--space-3)) calc(-1 * var(--space-4)) calc(-1 * var(--space-3)) 0;
  padding: var(--space-3) var(--space-4) var(--space-3) var(--space-3);
  background: var(--bg-subtle);
}

.external-service-table-row > .external-service-row-actions {
  margin: calc(-1 * var(--space-3-5)) calc(-1 * var(--space-4)) calc(-1 * var(--space-3-5)) 0;
  padding: var(--space-3-5) var(--space-4) var(--space-3-5) var(--space-3);
  background: var(--bg-surface);
}

.external-service-table-header {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-subtle);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  text-transform: uppercase;
}

.external-service-table-row {
  min-height: 82px;
  padding: var(--space-3-5) var(--space-4);
  border-top: 1px solid var(--border-subtle);
  transition: background var(--transition-default);
}

.external-service-table-header + .external-service-table-row {
  border-top: 0;
}

.external-service-table-row:hover {
  background: var(--bg-subtle);
}

.external-service-table-row:hover > .external-service-row-actions {
  background: var(--bg-subtle);
}

.external-service-name-cell,
.external-service-detail-cell,
.external-service-pill-stack,
.external-service-stack-cell {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.external-service-pill-stack {
  --external-service-pill-width: 124px;
  align-content: center;
  gap: var(--space-1-5);
  justify-items: start;
}

.external-service-title-line {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  max-width: 100%;
}

.external-service-title-line strong {
  flex: 0 1 auto;
}

.external-service-pill-stack :deep(.standard-status-pill) {
  width: var(--external-service-pill-width);
  height: 24px;
  justify-content: flex-start;
}

.external-service-time-pill-stack {
  --external-service-pill-width: 142px;
}

.external-service-table-row > [data-label="状态"] :deep(.standard-status-pill) {
  width: 72px;
  height: 24px;
}

.external-service-detail-cell small,
.external-service-name-cell small,
.external-service-stack-cell small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.external-service-heartbeat-cell small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.external-service-name-cell strong,
.external-service-stack-cell span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.external-service-upstream-copy {
  display: block;
  box-sizing: border-box;
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  min-height: 26px;
  padding: 2px var(--space-2);
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-subtle);
  color: var(--text-primary);
  cursor: copy;
  font: inherit;
  line-height: 20px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    background var(--transition-default),
    border-color var(--transition-default),
    box-shadow var(--transition-default);
}

.external-service-upstream-copy:hover {
  border-color: var(--brand);
  background: var(--brand-subtle);
  box-shadow: inset 0 0 0 1px var(--brand-subtle);
}

.external-service-upstream-copy:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

.external-service-upstream-bubble {
  position: fixed;
  z-index: var(--z-top);
  width: max-content;
  max-width: min(360px, calc(100vw - 24px));
  padding: var(--space-2) var(--space-2-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.45;
  overflow-wrap: anywhere;
  pointer-events: none;
}

.external-service-upstream-bubble.is-above {
  transform: translateY(-100%);
}

.external-service-upstream-bubble.is-below {
  transform: translateY(0);
}

.external-service-tool-popover {
  position: fixed;
  z-index: var(--z-top);
  width: min(304px, calc(100vw - 24px));
  max-height: min(360px, calc(100vh - 24px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  box-shadow: var(--shadow-lg);
}

.external-service-tool-popover.is-above {
  transform: translateY(-100%);
}

.external-service-tool-popover.is-below {
  transform: translateY(0);
}

.external-service-tool-popover-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-subtle);
}

.external-service-tool-popover-header > div {
  display: grid;
  gap: var(--space-0-5);
  min-width: 0;
}

.external-service-tool-popover-header strong {
  color: var(--text-primary);
  font-size: var(--text-md);
  line-height: 1.3;
}

.external-service-tool-popover-header span {
  min-width: 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.external-service-tool-popover-body {
  min-height: 0;
  overflow-y: auto;
}

.external-service-tool-popover-close {
  width: 26px;
  height: 26px;
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--text-lg);
  line-height: 1;
}

.external-service-tool-popover-close:hover {
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.external-service-tool-popover-close:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 2px;
}

.external-service-tool-list {
  display: grid;
  gap: var(--space-1);
  min-height: 0;
  margin: 0;
  padding: var(--space-2);
  overflow-y: auto;
  list-style: none;
}

.external-service-tool-review-section {
  display: grid;
  gap: var(--space-1);
}

.external-service-tool-review-section + .external-service-tool-review-section {
  border-top: 1px solid var(--border-subtle);
}

.external-service-tool-review-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-2) 0;
}

.external-service-tool-review-section-header strong {
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: 1.3;
  text-transform: uppercase;
}

.external-service-tool-item {
  min-width: 0;
  padding: var(--space-1-5) var(--space-2);
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.external-service-tool-review-item {
  display: grid;
  gap: var(--space-0-5);
  font-family: var(--font-sans);
  white-space: normal;
}

.external-service-tool-review-item small {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-muted);
  font-size: var(--text-xs);
  line-height: 1.35;
}

.external-service-tool-review-title {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
  color: var(--text-primary);
  font-weight: var(--font-semibold);
}

.external-service-tool-review-title input {
  flex: 0 0 auto;
}

.external-service-tool-review-title span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.external-service-code-value {
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
}

@media (max-width: 1080px) {
  .external-service-table-scroll {
    overflow-x: visible;
    box-shadow: none;
    cursor: default;
  }

  .external-service-table {
    min-width: 0;
  }

  .external-service-table-header > :last-child,
  .external-service-table-row > .external-service-row-actions {
    position: static;
    align-self: auto;
    margin: 0;
    padding: 0;
    border-left: 0;
    box-shadow: none;
    background: transparent;
  }

  .external-service-table-header {
    display: none;
  }

  .external-service-table-row {
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }

  .external-service-table-row > [data-label] {
    display: grid;
    gap: var(--space-1);
  }

  .external-service-table-row > [data-label]::before {
    content: attr(data-label);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
  }

  .external-service-actions,
  .external-service-row-actions {
    flex-wrap: wrap;
    flex-direction: row;
    justify-content: flex-start;
  }

  .external-service-row-actions .tool-button {
    width: auto;
    height: 34px;
    min-height: 34px;
    padding: 0 var(--space-3-5);
  }
}

@media (prefers-reduced-motion: reduce) {
  .external-service-table-scroll,
  .external-service-upstream-copy {
    scroll-behavior: auto;
    transition: none;
  }
}

@media (max-width: 760px) {
  .external-service-form-grid,
  .external-service-field-contract-grid,
  .external-service-validation-grid {
    grid-template-columns: 1fr;
  }

  .external-service-form-wide,
  .external-service-checkbox-row {
    grid-column: auto;
  }
}
</style>
