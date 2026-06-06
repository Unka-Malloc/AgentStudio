import BinaryCheckbox from "./BinaryCheckbox.vue";
import AgentModelOptionBar from "./AgentModelOptionBar.vue";
import BrowseSelectButton from "./BrowseSelectButton.vue";
import ConfigFloatingPanel from "./ConfigFloatingPanel.vue";
import ConfigFoldCard from "./ConfigFoldCard.vue";
import ConfigListSummaryBubble from "./ConfigListSummaryBubble.vue";
import FeatureToggle from "./FeatureToggle.vue";
import HistorySessionPanel from "./HistorySessionPanel.vue";
import InfoFeedResultRow from "./InfoFeedResultRow.vue";
import JsonConfigFileEditor from "./JsonConfigFileEditor.vue";
import OptionBar from "./OptionBar.vue";
import SafeHtmlBlock from "./SafeHtmlBlock.vue";
import SegmentedProgressBar from "./SegmentedProgressBar.vue";
import SegmentedToggle from "./SegmentedToggle.vue";
import StatusPill from "./StatusPill.vue";

export { AgentModelOptionBar, BinaryCheckbox, BrowseSelectButton, ConfigFloatingPanel, ConfigFoldCard, ConfigListSummaryBubble, FeatureToggle, HistorySessionPanel, InfoFeedResultRow, JsonConfigFileEditor, OptionBar, SafeHtmlBlock, SegmentedProgressBar, SegmentedToggle, StatusPill };

export type CommonComponentRegistration = {
  name: string;
  file: string;
  category: "choice" | "picker" | "history" | "result" | "config" | "render" | "progress";
  description: string;
  usageRule: string;
};

export const commonComponentReusePolicy = [
  "能用通用组件就用通用组件，业务页面不得重新手写已有语义覆盖的控件。",
  "能继承就继承，页面级样式只负责布局、间距和局部状态组合。",
  "新场景优先扩展通用组件的 props、slot 或 token 化样式；语义无法覆盖时才新增组件并登记到本注册表。",
] as const;

export const commonComponentRegistry: CommonComponentRegistration[] = [
  {
    name: "BinaryCheckbox",
    file: "server-web/components/BinaryCheckbox.vue",
    category: "choice",
    description: "独立布尔选项的标准复选控件。",
    usageRule: "页面需要复选框式布尔开关时使用；不要替代胶囊型二态 Toggle。",
  },
  {
    name: "OptionBar",
    file: "server-web/components/OptionBar.vue",
    category: "choice",
    description: "选项栏的标准选择控件外壳。",
    usageRule: "页面需要下拉选项栏时使用；选项列表和值必须由调用方传入，组件不得写默认业务值。",
  },
  {
    name: "AgentModelOptionBar",
    file: "server-web/components/AgentModelOptionBar.vue",
    category: "picker",
    description: "智能体选择的标准选项框，统一候选项、空模型库入口、空值和禁用原因展示。",
    usageRule: "页面需要选择已有智能体时使用；业务页面只提供候选源，不重复实现智能体选项渲染或空库跳转。",
  },
  {
    name: "FeatureToggle",
    file: "server-web/components/FeatureToggle.vue",
    category: "choice",
    description: "功能、模块、授权等启停状态的标准胶囊 Toggle。",
    usageRule: "页面需要表达某个功能是否开启并允许直接启停时使用；组件只发出布尔值，启停逻辑和保存行为由调用方绑定。",
  },
  {
    name: "StatusPill",
    file: "server-web/components/StatusPill.vue",
    category: "result",
    description: "状态展示的标准圆点胶囊。",
    usageRule: "页面需要展示运行状态、配置状态、风险等级或启用状态时使用；只传入 label/tone/enabled，不在业务页面手写状态胶囊。",
  },
  {
    name: "BrowseSelectButton",
    file: "server-web/components/BrowseSelectButton.vue",
    category: "picker",
    description: "文件、文件夹、本地路径选择入口。",
    usageRule: "页面需要触发浏览文件、文件夹或本地路径选择时使用，按钮文案和选择类型由调用方传入。",
  },
  {
    name: "配置悬浮框",
    file: "server-web/components/ConfigFloatingPanel.vue",
    category: "config",
    description: "可编辑配置弹层的标准外壳，统一标题、副标题、状态、校验按钮、关闭行为和滚动容器。",
    usageRule: "页面需要新增或修改配置时使用；业务页面通过 slot 传入输入框、选择框、校验结果和保存按钮，不重复手写弹层外壳。",
  },
  {
    name: "配置列表简化展示气泡",
    file: "server-web/components/ConfigListSummaryBubble.vue",
    category: "config",
    description: "配置项只读概览气泡，统一锚点定位、关闭行为、分组列表和值状态展示。",
    usageRule: "页面只需要快速查看配置来源和值时使用；需要修改配置时使用配置悬浮框。",
  },
  {
    name: "ConfigFoldCard",
    file: "server-web/components/ConfigFoldCard.vue",
    category: "config",
    description: "配置、JSON、运行结构和诊断信息的标准折叠卡片。",
    usageRule: "页面需要展开/收起配置、JSON、诊断结构或详情时使用；具体表单、JSON 和数据内容由调用方通过 slot 提供。",
  },
  {
    name: "JsonConfigFileEditor",
    file: "server-web/components/JsonConfigFileEditor.vue",
    category: "config",
    description: "真实配置文件 JSON 的标准单例编辑框，统一展示、编辑、取消、保存和 JSON 校验。",
    usageRule: "页面需要展示或编辑 JSON/配置文件内容时使用；必须传入稳定 fileKey 和保存回调，不在业务页面手写 textarea/pre 保存按钮。",
  },
  {
    name: "HistorySessionPanel",
    file: "server-web/components/HistorySessionPanel.vue",
    category: "history",
    description: "可折叠、可选择、可删除的历史会话列表。",
    usageRule: "页面需要历史会话、历史记录或可恢复运行列表时使用；列表数据和删除行为由调用方绑定。",
  },
  {
    name: "InfoFeedResultRow",
    file: "server-web/components/InfoFeedResultRow.vue",
    category: "result",
    description: "信息流和调试面板复用的结果行渲染组件。",
    usageRule: "需要与信息流结果保持一致的召回/规划结果展示时使用，避免重新绘制相似卡片。",
  },
  {
    name: "SafeHtmlBlock",
    file: "server-web/components/SafeHtmlBlock.vue",
    category: "render",
    description: "已净化或沙箱化 HTML 的唯一页面渲染边界。",
    usageRule: "页面需要渲染 HTML 时使用；调用方必须传入由 markdownToSafeHtml 或 renderEvidenceReadableHtml 生成的内容，并声明 source。",
  },
  {
    name: "SegmentedToggle",
    file: "server-web/components/SegmentedToggle.vue",
    category: "choice",
    description: "多选项平铺分段控制器组件。",
    usageRule: "页面需要分段切换视图或选项时使用，替代零散的 tabs 样式或 el-radio-group。",
  },
  {
    name: "SegmentedProgressBar",
    file: "server-web/components/SegmentedProgressBar.vue",
    category: "progress",
    description: "标准分段式进度条，支持步骤标签和 pending/active/complete/failed 状态。",
    usageRule: "页面需要按步骤展示进度时使用；业务页面只传步骤数据，不重新手写分段条 DOM 或颜色状态。",
  },
];
