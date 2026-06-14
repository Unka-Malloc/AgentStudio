import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";

const DEFAULT_OUTPUT_DIR = "build/artifacts/transaction-continuity";
const DEFAULT_MAX_READ_BYTES = 256 * 1024;
const DEFAULT_MAX_DOCS = 80;
const DEFAULT_REVIEW_EVERY = 500;
const MAX_MESSAGE_BODY_TEXT = 2000;
const MAX_HUMAN_MESSAGE_BODY_TEXT = 700;
const GENERIC_LOCAL_PARTS = new Set([
  "admin",
  "alert",
  "alerts",
  "billing",
  "contact",
  "digest",
  "email",
  "hello",
  "info",
  "mail",
  "mailer",
  "marketing",
  "message",
  "news",
  "newsletter",
  "no-reply",
  "noreply",
  "notification",
  "notifications",
  "offers",
  "postmaster",
  "reminder",
  "reply",
  "security",
  "service",
  "support",
  "team",
  "updates"
]);
const GENERIC_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "new",
  "of",
  "on",
  "or",
  "our",
  "the",
  "to",
  "up",
  "we",
  "with",
  "you",
  "your",
  "您",
  "你的",
  "您有",
  "的",
  "了"
]);
const TIME_WORDS = new Set([
  "today",
  "tomorrow",
  "yesterday",
  "daily",
  "weekly",
  "monthly",
  "annual",
  "annually",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
  "本月",
  "上月",
  "下月",
  "今日",
  "今天",
  "明日",
  "明天",
  "昨日",
  "昨天",
  "每日",
  "每周",
  "每月",
  "年度",
  "月度",
  "周报",
  "月报",
  "日报"
]);
const CATEGORY_DEFINITIONS = [
  {
    id: "financial-statement",
    cadence: "monthly",
    tokens: [
      "statement",
      "bill",
      "billing",
      "invoice",
      "receipt",
      "payment",
      "credit",
      "bank",
      "card",
      "账单",
      "月结",
      "还款",
      "扣款",
      "发票",
      "付款",
      "支付"
    ]
  },
  {
    id: "reminder",
    cadence: "irregular",
    tokens: ["reminder", "due", "action", "required", "confirm", "verify", "提醒", "确认", "验证", "待办"]
  },
  {
    id: "security-alert",
    cadence: "irregular",
    tokens: ["security", "alert", "login", "password", "code", "verify", "安全", "登录", "验证码", "密码"]
  },
  {
    id: "notification-digest",
    cadence: "weekly",
    tokens: ["digest", "notification", "notifications", "messages", "searches", "summary", "动态", "消息", "通知", "摘要"]
  },
  {
    id: "marketing-series",
    cadence: "irregular",
    tokens: ["sale", "offer", "discount", "save", "deal", "new", "ends", "shop", "特卖", "优惠", "折扣", "促销", "新品"]
  },
  {
    id: "report-series",
    cadence: "weekly",
    tokens: ["report", "weekly", "monthly", "usage", "activity", "报表", "报告", "周报", "月报", "用量"]
  }
];
const NEGATIVE_CATEGORY_GROUPS = [
  new Set(["marketing-series"]),
  new Set(["security-alert"]),
  new Set(["financial-statement"]),
  new Set(["notification-digest"]),
  new Set(["reminder", "report-series", "general"])
];
const ACTION_DEFINITIONS = [
  {
    id: "request",
    words: ["request", "require", "need", "需求", "申请", "请求", "请提供", "请确认", "请协助"]
  },
  {
    id: "approval",
    words: ["approve", "approved", "approval", "review", "批准", "审批", "评审", "审核", "通过"]
  },
  {
    id: "payment",
    words: ["pay", "paid", "payment", "invoice", "receipt", "bill", "付款", "支付", "发票", "账单", "报销"]
  },
  {
    id: "delivery",
    words: ["deliver", "shipment", "parcel", "tracking", "order", "交付", "发货", "物流", "订单", "包裹"]
  },
  {
    id: "risk",
    words: ["risk", "issue", "incident", "alert", "blocked", "风险", "问题", "故障", "异常", "阻塞", "告警"]
  },
  {
    id: "meeting",
    words: ["meeting", "invite", "agenda", "minutes", "会议", "纪要", "议程", "邀请"]
  },
  {
    id: "status-update",
    words: ["status", "report", "weekly", "monthly", "update", "进展", "状态", "周报", "月报", "更新"]
  },
  {
    id: "marketing",
    words: ["sale", "offer", "discount", "deal", "shop", "促销", "优惠", "折扣", "特卖", "新品"]
  }
];
const SOURCE_LABEL_OVERRIDES = new Map([
  ["steampowered.com", "Steam"],
  ["steamcommunity.com", "Steam"],
  ["patreon.com", "Patreon"],
  ["paypal.com", "PayPal"],
  ["amazon.co.uk", "Amazon"],
  ["amazon.com", "Amazon"],
  ["netflix.com", "Netflix"],
  ["coursera.org", "Coursera"],
  ["linkedin.com", "LinkedIn"],
  ["twitter.com", "Twitter"],
  ["x.com", "X"],
  ["instagram.com", "Instagram"],
  ["taobao.com", "淘宝"],
  ["tmall.com", "天猫"],
  ["aliyun.com", "阿里云"],
  ["tencent.com", "腾讯云"],
  ["qq.com", "腾讯"],
  ["microsoft.com", "Microsoft"],
  ["apple.com", "Apple"],
  ["google.com", "Google"],
  ["github.com", "GitHub"]
]);
const SOURCE_BASE_LABEL_OVERRIDES = new Map([
  ["steam", "Steam"],
  ["steampowered", "Steam"],
  ["patreon", "Patreon"],
  ["paypal", "PayPal"],
  ["amazon", "Amazon"],
  ["netflix", "Netflix"],
  ["coursera", "Coursera"],
  ["linkedin", "LinkedIn"],
  ["instagram", "Instagram"],
  ["taobao", "淘宝"],
  ["tmall", "天猫"],
  ["aliyun", "阿里云"],
  ["tencent", "腾讯云"],
  ["microsoft", "Microsoft"],
  ["apple", "Apple"],
  ["google", "Google"],
  ["github", "GitHub"]
]);
const BANK_SOURCE_PATTERNS = [
  /bank/i,
  /finnair plus/i,
  /银行/,
  /信用/
];
const CREATOR_PLATFORM_PATTERNS = [/patreon/i, /substack/i, /onlyfans/i, /fanbox/i, /pixiv/i];
const ACTOR_AWARE_SOURCE_TYPES = new Set(["creator-platform"]);
const SOURCE_TYPE_OVERRIDES = new Map([
  ["steam", "commerce"],
  ["amazon", "commerce"],
  ["taobao", "commerce"],
  ["天猫", "commerce"],
  ["patreon", "creator-platform"],
  ["substack", "creator-platform"],
  ["pixiv", "creator-platform"],
  ["paypal", "bank"]
]);
const BUSINESS_ENTITY_PATTERNS = {
  contractIds: [
    /\b(?:contract|agreement|msa|sow)\s*(?:no\.?|number|#|编号)?\s*[:：#-]?\s*([A-Z]{1,8}[-_/]?\d{3,}(?:[-_/][A-Z0-9]{2,})*)/gi,
    /(?:合同|协议|框架协议)\s*(?:编号|号|代码)?\s*[:：#-]?\s*([A-Z0-9][A-Z0-9-_/]{4,})/gi
  ],
  ticketIds: [
    /\b(?:ticket|case|issue|jira|task|bug|incident|request)\s*(?:id|no\.?|#|编号)?\s*[:：#-]?\s*([A-Z]{1,12}-\d{1,8}|\d{5,})/gi,
    /(?:工单|单号|需求|缺陷|问题|事件)\s*(?:编号|号|ID)?\s*[:：#-]?\s*([A-Z0-9][A-Z0-9-_/]{3,})/gi
  ],
  invoiceIds: [
    /\b(?:invoice|receipt|bill)\s*(?:no\.?|number|#)?\s*[:：#-]?\s*([A-Z0-9][A-Z0-9-_/]{4,})/gi,
    /(?:发票|账单|收据)\s*(?:编号|号码|号)?\s*[:：#-]?\s*([A-Z0-9][A-Z0-9-_/]{4,})/gi
  ],
  orderIds: [
    /\b(?:order|po|purchase order)\s*(?:no\.?|number|id|#)\s*[:：#-]\s*([A-Z0-9][A-Z0-9-_/]{4,})/gi,
    /(?:订单|采购单|订单号|PO)\s*[:：#-]?\s*([A-Z0-9][A-Z0-9-_/]{4,})/gi
  ],
  projectIds: [
    /\b(?:project|proj|program)\s*(?:code|id|no\.?|#)?\s*[:：#-]?\s*([A-Z][A-Z0-9]{1,8}[-_]\d{2,6}|[A-Z]{2,10}-[A-Z0-9]{2,12})/gi,
    /(?:项目|工程|专项)\s*(?:编号|代码|代号)?\s*[:：#-]?\s*([A-Z0-9][A-Z0-9-_/]{3,})/gi
  ],
  systems: [
    /\b(?:system|platform|service|app|application)\s*[:：-]?\s*([A-Z][A-Za-z0-9._ -]{2,36})/g,
    /(?:系统|平台|应用|服务)\s*[:：-]?\s*([\u4e00-\u9fa5A-Za-z0-9._ -]{2,36})/g
  ],
  versions: [
    /\b(?:v|version|ver\.?)\s*[:：]?\s*(\d+(?:\.\d+){1,4}(?:[-_a-z0-9]+)?)/gi,
    /(?:版本|版次)\s*[:：]?\s*([A-Za-z]?\d+(?:\.\d+){0,4})/g
  ],
  amounts: [
    /(?:[$€£¥]|RMB|CNY|USD|GBP|EUR)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi,
    /([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:元|美元|英镑|欧元)/g
  ],
  organizations: [
    /\b([A-Z][A-Za-z0-9&.,' -]{2,48}\s(?:Ltd|Limited|Inc|LLC|GmbH|AG|PLC|Corp|Corporation|University|Bank|Department|Team))\b/g,
    /([\u4e00-\u9fa5]{2,24}(?:公司|大学|学院|银行|部门|团队|中心|供应商|客户))/g
  ],
  locations: [
    /\b(?:in|at|from|to)\s+([A-Z][A-Za-z .'-]{2,40})(?=[,.;\n]|$)/g,
    /(?:地点|地址|位于|前往|到达)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9 .'-]{2,40})/g
  ]
};

function scalar(value) {
  return String(value ?? "").trim();
}

function normalizeSpace(value) {
  return scalar(value).replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function sha1(value) {
  return createHash("sha1").update(String(value || "")).digest("hex");
}

function stableId(prefix, value) {
  return `${prefix}-${sha1(value).slice(0, 16)}`;
}

function slug(value, fallback = "item") {
  const normalized = scalar(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return normalized || fallback;
}

function decodeMimeWord(match, charset, encoding, encodedText) {
  try {
    const normalizedEncoding = String(encoding || "").toUpperCase();
    const binary =
      normalizedEncoding === "B"
        ? Buffer.from(encodedText, "base64")
        : Buffer.from(
            String(encodedText || "")
              .replace(/_/g, " ")
              .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) =>
                String.fromCharCode(Number.parseInt(hex, 16))
              ),
            "binary"
          );
    const normalizedCharset = String(charset || "utf8").toLowerCase();
    if (/utf-?8/.test(normalizedCharset) || /us-ascii/.test(normalizedCharset)) {
      return binary.toString("utf8");
    }
    if (/gb2312|gbk|gb18030|big5|shift|jis|euc|iso-2022/i.test(normalizedCharset)) {
      return binary.toString("utf8");
    }
    if (/iso-8859-1|latin-1/.test(normalizedCharset)) {
      return binary.toString("latin1");
    }
    return binary.toString("utf8");
  } catch {
    return match;
  }
}

function decodeMimeWords(value) {
  return normalizeSpace(
    scalar(value).replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, decodeMimeWord)
  );
}

function unfoldHeaders(headerText) {
  const headers = new Map();
  let currentName = "";
  let currentValue = "";

  function commit() {
    if (!currentName) {
      return;
    }
    const key = currentName.toLowerCase();
    const value = decodeMimeWords(currentValue);
    if (!headers.has(key)) {
      headers.set(key, []);
    }
    headers.get(key).push(value);
    currentName = "";
    currentValue = "";
  }

  for (const line of String(headerText || "").replace(/\r/g, "\n").split("\n")) {
    if (/^[ \t]/.test(line) && currentName) {
      currentValue = `${currentValue} ${line.trim()}`;
      continue;
    }
    const match = line.match(/^([^:]{1,80}):\s*(.*)$/);
    if (!match) {
      continue;
    }
    commit();
    currentName = match[1].trim();
    currentValue = match[2] || "";
  }
  commit();
  return headers;
}

function header(headers, name) {
  return (headers.get(String(name).toLowerCase()) || [])[0] || "";
}

function headerAll(headers, name) {
  return headers.get(String(name).toLowerCase()) || [];
}

function parseAddress(value) {
  const decoded = decodeMimeWords(value);
  const addressMatch = decoded.match(/<([^>]+)>/);
  const directMatch = decoded.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const address = scalar(addressMatch?.[1] || directMatch?.[0]).toLowerCase();
  const name = normalizeSpace(
    decoded
      .replace(/<[^>]+>/g, "")
      .replace(/[",']/g, " ")
      .replace(/\([^)]*\)/g, " ")
  );
  const local = address.includes("@") ? address.split("@")[0] : "";
  const domain = address.includes("@") ? address.split("@")[1] : "";
  return {
    raw: decoded,
    name: name || local || decoded,
    address,
    local,
    domain,
    orgDomain: organizationDomain(domain)
  };
}

function parseAddressList(value) {
  const items = [];
  const seen = new Set();
  for (const part of scalar(value).split(/[;,](?=(?:[^<]*<[^>]*>)*[^>]*$)/)) {
    const parsed = parseAddress(part);
    const key = parsed.address || parsed.raw.toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(parsed);
  }
  return items;
}

function organizationDomain(domain) {
  const parts = scalar(domain).toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) {
    return parts.join(".");
  }
  const secondLevel = parts[parts.length - 2];
  if (["ac", "co", "com", "edu", "gov", "net", "org"].includes(secondLevel)) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

function normalizeMessageId(value) {
  return scalar(value).replace(/[<>]/g, "").toLowerCase();
}

function parseReferenceIds(value) {
  return [
    ...new Set(
      (scalar(value).match(/<[^>]+>|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
        .map(normalizeMessageId)
        .filter(Boolean)
    )
  ];
}

function stripHtml(value) {
  return normalizeSpace(
    scalar(value)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
  );
}

function stripQuotedPrintableNoise(value) {
  return scalar(value)
    .replace(/=\r?\n/g, "")
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : " ";
    });
}

function cleanEmailBodyForKnowledge(value) {
  return normalizeSpace(
    scalar(value)
      .replace(/^--[^\n\r]{8,}$/gm, " ")
      .replace(/^Content-(?:Type|Transfer-Encoding|Disposition|ID|Description|Location):.*$/gim, " ")
      .replace(/^MIME-Version:.*$/gim, " ")
      .replace(/^charset\s*=\s*["']?[-A-Za-z0-9_]+["']?\s*$/gim, " ")
      .replace(/^name\s*=\s*["']?[^"'\n\r]+["']?\s*$/gim, " ")
      .replace(/This is a multi-part message in MIME format\./gi, " ")
  );
}

function parseDate(value, fallback = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback || "";
  }
  return date.toISOString();
}

function normalizeSubject(value) {
  return normalizeSpace(value)
    .replace(/^(?:(?:re|fw|fwd|答复|回复|转发)\s*[:：]\s*)+/i, "")
    .replace(/^\s*(?:\[[^\]]{1,24}\]|\([^)]{1,24}\))\s*/g, "")
    .trim();
}

function normalizedSubjectText(value) {
  return normalizeSubject(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b\d{1,4}([/-])\d{1,2}\1\d{1,4}\b/g, " ")
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, " ")
    .replace(/\b\d+(?:[.,]\d+)?\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  const rawTokens = normalizedSubjectText(value).match(/[\p{L}\p{N}]{2,}/gu) || [];
  const tokens = [];
  for (const token of rawTokens) {
    const normalized = token.toLowerCase();
    if (GENERIC_STOP_WORDS.has(normalized) || TIME_WORDS.has(normalized)) {
      continue;
    }
    if (/^\d+$/.test(normalized)) {
      continue;
    }
    tokens.push(normalized);
  }
  return [...new Set(tokens)].slice(0, 16);
}

function charSignature(value) {
  return normalizedSubjectText(value).replace(/\s+/g, "");
}

function ngrams(value, size = 3) {
  const text = charSignature(value);
  if (!text) {
    return [];
  }
  if (text.length <= size) {
    return [text];
  }
  const items = [];
  for (let index = 0; index <= text.length - size; index += 1) {
    items.push(text.slice(index, index + size));
  }
  return [...new Set(items)];
}

function jaccard(leftValues, rightValues) {
  const left = new Set((leftValues || []).filter(Boolean));
  const right = new Set((rightValues || []).filter(Boolean));
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const value of left) {
    if (right.has(value)) {
      overlap += 1;
    }
  }
  return overlap / (left.size + right.size - overlap);
}

function uniqueStrings(values, limit = 24) {
  const seen = new Set();
  const items = [];
  for (const value of values || []) {
    const normalized = normalizeSpace(value).replace(/^["'`]+|["'`]+$/g, "");
    if (!normalized || seen.has(normalized.toLowerCase())) {
      continue;
    }
    seen.add(normalized.toLowerCase());
    items.push(normalized);
    if (items.length >= limit) {
      break;
    }
  }
  return items;
}

function collectPatternMatches(text, patterns, limit = 24) {
  const values = [];
  for (const pattern of patterns || []) {
    pattern.lastIndex = 0;
    for (const match of String(text || "").matchAll(pattern)) {
      values.push(match[1] || match[0]);
      if (values.length >= limit * 2) {
        break;
      }
    }
  }
  return uniqueStrings(values, limit);
}

function businessIdentifierValues(values, limit = 18) {
  return uniqueStrings(
    (values || []).filter((value) => {
      const normalized = normalizeSpace(value)
        .replace(/^[#：:\s-]+/g, "")
        .replace(/[),.;，。；、\s]+$/g, "");
      const lower = normalized.toLowerCase();
      if (!normalized || normalized.length < 4 || GENERIC_STOP_WORDS.has(lower)) {
        return false;
      }
      if (normalized.length > 48) {
        return false;
      }
      if (!/\d/.test(normalized)) {
        return false;
      }
      if (/^[a-z]{4,}$/i.test(normalized) && !/[-_/]/.test(normalized)) {
        return false;
      }
      const hasUppercase = /[A-Z]/.test(normalized);
      const hasSeparator = /[-_/]/.test(normalized);
      const isPlainNumericId = /^\d{5,}$/.test(normalized);
      if (!hasUppercase && !hasSeparator && !isPlainNumericId) {
        return false;
      }
      const compact = normalized.replace(/[^A-Za-z0-9]/g, "");
      const digitCount = (compact.match(/\d/g) || []).length;
      if (compact.length >= 24 && digitCount <= 2) {
        return false;
      }
      return true;
    }),
    limit
  );
}

function collectIdentifierMatches(text, patterns, limit = 18) {
  return businessIdentifierValues(collectPatternMatches(text, patterns, limit * 2), limit);
}

function collectOrderIdentifierMatches(text, patterns, limit = 18) {
  return uniqueStrings(
    collectIdentifierMatches(text, patterns, limit * 2).filter((value) => {
      const normalized = normalizeSpace(value);
      if (normalized.length > 32 || /[+/=]/.test(normalized)) {
        return false;
      }
      if (/^\d{6,}$/.test(normalized)) {
        return true;
      }
      if (/[-_]/.test(normalized) && /\d{3,}/.test(normalized) && /[A-Z]/.test(normalized)) {
        return true;
      }
      if (/^(?:PO|SO|ORD|ORDER)[-_]?\d{3,}/.test(normalized)) {
        return true;
      }
      return false;
    }),
    limit
  );
}

function detectActionCategory(subject, body = "", attachmentRefs = []) {
  const text = `${subject}\n${body}\n${attachmentRefs.map((item) => item.fileName).join(" ")}`.toLowerCase();
  let best = { id: "inform", score: 0 };
  for (const definition of ACTION_DEFINITIONS) {
    const score = definition.words.reduce(
      (sum, word) => sum + (text.includes(String(word).toLowerCase()) ? 1 : 0),
      0
    );
    if (score > best.score) {
      best = { id: definition.id, score };
    }
  }
  return best.id;
}

function attachmentLookupKeys(fileName, title = "") {
  return uniqueStrings(
    [
      path.basename(scalar(fileName)).toLowerCase(),
      normalizeSubject(String(fileName || "").replace(/\.[a-z0-9]+$/i, "")).toLowerCase(),
      normalizeSubject(title).toLowerCase()
    ].filter(Boolean),
    8
  );
}

function extractAttachmentRefs(rawText, filePath = "", normalizedRefsByName = new Map()) {
  const refs = [];
  const patterns = [
    /(?:filename|name)\*?=(?:UTF-8''|")?([^";\n\r]+)"?/gi,
    /Content-Disposition:\s*attachment[\s\S]{0,240}?filename\*?=(?:UTF-8''|")?([^";\n\r]+)"?/gi
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of String(rawText || "").matchAll(pattern)) {
      let decoded = decodeMimeWords(match[1] || "").replace(/\s+/g, " ").trim();
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        // MIME filenames often contain bare percent signs; keep the decoded MIME word.
      }
      const fileName = path.basename(decoded);
      const extension = path.extname(fileName).toLowerCase();
      if (!fileName || !/\.(docx?|pptx?|xlsx?|pdf|csv|txt|rtf)$/i.test(extension)) {
        continue;
      }
      refs.push({
        fileName,
        extension,
        title: normalizeSubject(fileName.replace(/\.[a-z0-9]+$/i, "")),
        hash: sha1(`${filePath}:${fileName}`).slice(0, 16),
        normalizedDocument: false
      });
      for (const key of attachmentLookupKeys(fileName)) {
        for (const normalizedRef of normalizedRefsByName.get(key) || []) {
          refs.push({
            ...normalizedRef,
            sourceAttachmentFileName: fileName
          });
        }
      }
    }
  }
  return uniqueStrings(refs.map((item) => JSON.stringify(item)), 40).map((item) => JSON.parse(item));
}

function extractBusinessEntities({ subject, body, from, recipients, attachmentRefs }) {
  const attachmentText = (attachmentRefs || []).map((item) => `${item.title} ${item.fileName}`).join("\n");
  const text = `${subject}\n${body}\n${attachmentText}`;
  const entities = {
    projectNames: [],
    projectIds: collectIdentifierMatches(text, BUSINESS_ENTITY_PATTERNS.projectIds, 18),
    ticketIds: collectIdentifierMatches(text, BUSINESS_ENTITY_PATTERNS.ticketIds, 18),
    contractIds: collectIdentifierMatches(text, BUSINESS_ENTITY_PATTERNS.contractIds, 18),
    invoiceIds: collectIdentifierMatches(text, BUSINESS_ENTITY_PATTERNS.invoiceIds, 18),
    orderIds: collectOrderIdentifierMatches(text, BUSINESS_ENTITY_PATTERNS.orderIds, 18),
    amounts: collectPatternMatches(text, BUSINESS_ENTITY_PATTERNS.amounts, 12),
    customers: [],
    suppliers: [],
    organizations: collectPatternMatches(text, BUSINESS_ENTITY_PATTERNS.organizations, 18),
    systems: collectPatternMatches(text, BUSINESS_ENTITY_PATTERNS.systems, 12),
    locations: collectPatternMatches(text, BUSINESS_ENTITY_PATTERNS.locations, 12),
    versions: collectPatternMatches(text, BUSINESS_ENTITY_PATTERNS.versions, 12),
    attachmentTitles: uniqueStrings((attachmentRefs || []).map((item) => item.title), 18),
    attachmentHashes: uniqueStrings((attachmentRefs || []).map((item) => item.hash), 18)
  };
  const projectNameCandidates = [
    ...collectPatternMatches(text, [
      /\b(?:project|program|initiative)\s+([A-Z][A-Za-z0-9 _-]{2,48})/gi,
      /(?:项目|工程|专项)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9 _-]{2,48})/g
    ], 12),
    ...entities.attachmentTitles.filter((item) => /项目|project|program/i.test(item))
  ];
  entities.projectNames = uniqueStrings(projectNameCandidates, 12);
  const senderOrg = from?.orgDomain || from?.domain || "";
  const recipientDomains = uniqueStrings(
    (recipients || [])
      .map((item) => (String(item).includes("@") ? organizationDomain(String(item).split("@").pop()) : ""))
      .filter(Boolean),
    12
  );
  entities.suppliers = uniqueStrings([senderOrg, ...entities.organizations.filter((item) => /supplier|vendor|供应商/i.test(item))], 12);
  entities.customers = uniqueStrings([...recipientDomains, ...entities.organizations.filter((item) => /customer|client|客户/i.test(item))], 12);
  return entities;
}

function addNormalizedAttachmentRef(refsByName, key, ref) {
  const normalizedKey = scalar(key).toLowerCase();
  if (!normalizedKey) {
    return;
  }
  const list = refsByName.get(normalizedKey) || [];
  if (
    list.some(
      (item) =>
        item.normalizedDocumentId === ref.normalizedDocumentId &&
        item.hash === ref.hash &&
        item.normalizedRelativePath === ref.normalizedRelativePath
    )
  ) {
    return;
  }
  list.push(ref);
  refsByName.set(normalizedKey, list.slice(0, 12));
}

function normalizedManifestEntries(manifest) {
  return [...(Array.isArray(manifest?.documents) ? manifest.documents : []), ...(Array.isArray(manifest?.sourceMaterials) ? manifest.sourceMaterials : [])];
}

async function loadNormalizedAttachmentRefs(manifestPaths = []) {
  const refsByName = new Map();
  for (const manifestPath of uniqueStrings(manifestPaths, 24)) {
    if (!manifestPath) {
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(path.resolve(manifestPath), "utf8"));
    } catch {
      continue;
    }
    for (const entry of normalizedManifestEntries(manifest)) {
      const relativePath = scalar(entry.relativePath);
      const sourceMaterialRelativePath = scalar(entry.sourceMaterialRelativePath);
      const fileName =
        path.basename(sourceMaterialRelativePath || relativePath) ||
        path.basename(relativePath) ||
        scalar(entry.title) ||
        scalar(entry.documentId);
      const title = normalizeSubject(scalar(entry.title) || fileName.replace(/\.[a-z0-9]+$/i, ""));
      if (!fileName && !title) {
        continue;
      }
      const ref = {
        fileName,
        extension: path.extname(fileName || relativePath).toLowerCase(),
        title,
        hash: scalar(entry.sha256) || sha1(`${entry.documentId || ""}:${relativePath}`).slice(0, 16),
        normalizedDocument: true,
        normalizedDocumentId: scalar(entry.documentId),
        normalizedAdapterId: scalar(entry.adapterId),
        normalizedGranularity: scalar(entry.granularity),
        normalizedRelativePath: relativePath,
        sourceMaterialRelativePath
      };
      for (const key of [
        ...attachmentLookupKeys(fileName, title),
        ...attachmentLookupKeys(path.basename(relativePath), title),
        ...attachmentLookupKeys(path.basename(sourceMaterialRelativePath), title)
      ]) {
        addNormalizedAttachmentRef(refsByName, key, ref);
      }
    }
  }
  return refsByName;
}

function entityValues(entities = {}) {
  return Object.values(entities).flatMap((value) => (Array.isArray(value) ? value : []));
}

function strongBusinessKeys(entities = {}) {
  return [
    ...["contractIds", "ticketIds", "projectIds", "invoiceIds", "orderIds"].flatMap((key) =>
      (entities[key] || []).map((value) => `${key}:${String(value).toLowerCase()}`)
    ),
    ...(entities.attachmentHashes || []).map((value) => `attachment:${value}`)
  ];
}

function weakBusinessKeys(entities = {}) {
  return [
    ...["projectNames", "systems", "versions", "locations", "attachmentTitles"].flatMap((key) =>
      (entities[key] || []).map((value) => `${key}:${String(value).toLowerCase()}`)
    )
  ];
}

function participantGraphKey(email) {
  const sender = email.senderOrg || email.senderKey || "";
  const recipients = (email.recipients || [])
    .map((item) => (String(item).includes("@") ? organizationDomain(String(item).split("@").pop()) : item))
    .filter(Boolean)
    .sort()
    .slice(0, 8);
  return [sender, ...recipients].filter(Boolean).join("->");
}

function buildTransactionFingerprint(email) {
  return {
    participantGraph: participantGraphKey(email),
    businessEntities: email.businessEntities || {},
    strongKeys: strongBusinessKeys(email.businessEntities),
    weakKeys: weakBusinessKeys(email.businessEntities),
    attentionKeys: email.attention?.keys || [],
    actionCategory: email.actionCategory || "inform",
    timeBucket: String(email.sentAt || "").slice(0, 7),
    semanticTokens: uniqueStrings([...(email.subjectTokens || []), ...(email.bodyTokens || []).slice(0, 8)], 24),
    subjectShape: email.subjectNgrams || []
  };
}

function detectCadence(subject, body = "") {
  const text = `${subject}\n${body}`.toLowerCase();
  if (/每日|日报|\bdaily\b/.test(text)) {
    return "daily";
  }
  if (/每周|周报|\bweekly\b|\bweek\b/.test(text)) {
    return "weekly";
  }
  if (/每月|月度|月报|账单|\bmonthly\b|\bstatement\b/.test(text)) {
    return "monthly";
  }
  if (/年度|\bannual\b|\byearly\b/.test(text)) {
    return "annual";
  }
  return "irregular";
}

function detectCategory(tokens, subject, body = "") {
  const tokenSet = new Set(tokens);
  const text = `${subject}\n${body}`.toLowerCase();
  let best = { id: "general", score: 0, cadence: "irregular" };
  for (const definition of CATEGORY_DEFINITIONS) {
    const score = definition.tokens.reduce(
      (sum, token) => sum + (tokenSet.has(token) || text.includes(token.toLowerCase()) ? 1 : 0),
      0
    );
    if (score > best.score) {
      best = { id: definition.id, score, cadence: definition.cadence };
    }
  }
  return best.id;
}

function normalizeListId(value) {
  const raw = scalar(value)
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!raw) {
    return "";
  }
  const domain = raw.match(/[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || "";
  const name = raw.replace(domain, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return [name, organizationDomain(domain)].filter(Boolean).join("@");
}

function senderKey(sender) {
  if (!sender?.address && !sender?.domain) {
    return "";
  }
  const local = scalar(sender.local).toLowerCase().replace(/[._+].*$/, "");
  if (!local || GENERIC_LOCAL_PARTS.has(local)) {
    return sender.orgDomain || sender.domain || "";
  }
  return `${local}@${sender.orgDomain || sender.domain}`;
}

function titleCaseWords(value) {
  return scalar(value)
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^[A-Z0-9]{2,}$/.test(part)) {
        return part;
      }
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

function domainBrand(domain) {
  const normalized = organizationDomain(domain || "");
  if (!normalized) {
    return "";
  }
  if (SOURCE_LABEL_OVERRIDES.has(normalized)) {
    return SOURCE_LABEL_OVERRIDES.get(normalized);
  }
  const parts = normalized.split(".").filter(Boolean);
  const base =
    parts.length >= 3 && ["co", "com", "net", "org", "edu", "gov"].includes(parts[parts.length - 2])
      ? parts[parts.length - 3]
      : parts[0];
  if (SOURCE_BASE_LABEL_OVERRIDES.has(base)) {
    return SOURCE_BASE_LABEL_OVERRIDES.get(base);
  }
  return titleCaseWords(base);
}

function senderDisplayName(from) {
  const name = normalizeSpace(from?.name || "");
  if (!name || /^(?:no.?reply|noreply|notification|notifications|newsletter|support|team|admin|info|mail|service)$/i.test(name)) {
    return "";
  }
  return name.replace(/\s*via\s+.+$/i, "").trim();
}

function regexEscape(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeActorLabel(value) {
  return normalizeSpace(value)
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "")
    .trim();
}

function attentionSourceLabel(from, subject = "", body = "") {
  const domainLabel = domainBrand(from?.orgDomain || from?.domain || "");
  const name = senderDisplayName(from);
  if (!domainLabel && name) {
    return name;
  }
  if (!domainLabel) {
    return "未知来源";
  }
  if (name && !new RegExp(`^${regexEscape(domainLabel)}$`, "i").test(name)) {
    if (/patreon/i.test(domainLabel) && !/patreon/i.test(name)) {
      return domainLabel;
    }
    if (/^\p{Script=Han}{2,10}$/u.test(name) && !/团队|客服|通知|服务/.test(name)) {
      return name;
    }
  }
  return domainLabel;
}

function sourceTypeFor({ sourceLabel, senderOrg, subject, body, category }) {
  const sourceKey = scalar(sourceLabel).toLowerCase();
  if (SOURCE_TYPE_OVERRIDES.has(sourceKey)) {
    return SOURCE_TYPE_OVERRIDES.get(sourceKey);
  }
  const text = `${sourceLabel} ${senderOrg} ${subject} ${body} ${category}`;
  if (CREATOR_PLATFORM_PATTERNS.some((pattern) => pattern.test(text))) {
    return "creator-platform";
  }
  if (BANK_SOURCE_PATTERNS.some((pattern) => pattern.test(text))) {
    return "bank";
  }
  if (/shop|store|retail|flannels|amazon|taobao|天猫|商城|订单|购物/i.test(text)) {
    return "commerce";
  }
  if (/cloud|server|github|microsoft|google|apple|teamviewer|腾讯云|阿里云/i.test(text)) {
    return "service";
  }
  return "organization";
}

function extractCreatorActor({ sourceLabel, from, subject, body }) {
  const text = `${subject}\n${body}`;
  const patterns = [
    /^(.{2,48}?)\s+(?:刚刚)?(?:与订阅会员分享了|shared|posted|published|发布了|分享了)/i,
    /(?:creator|author|作者|创作者)\s*[:：]\s*([^\n\r,，。:：]{2,48})/i,
    /^([^:：|\-–—]{2,48})\s*[:：]\s*(?:new|最新|发布|分享)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = normalizeActorLabel(
      normalizeSpace(match?.[1] || "").replace(/^["'“”]+|["'“”]+$/g, "")
    );
    if (
      candidate &&
      candidate.length <= 48 &&
      !new RegExp(regexEscape(sourceLabel), "i").test(candidate) &&
      !/^(?:re|fw|fwd|new|your|you|通知|提醒|更新|newsletter)$/i.test(candidate)
    ) {
      return candidate;
    }
  }
  const name = senderDisplayName(from);
  const normalizedName = normalizeActorLabel(name);
  if (CREATOR_PLATFORM_PATTERNS.some((pattern) => pattern.test(sourceLabel)) && normalizedName && !/patreon|substack|pixiv/i.test(normalizedName)) {
    return normalizedName;
  }
  return "";
}

function behaviorForAttention({ category, actionCategory, sourceType, subject, body }) {
  const text = `${subject}\n${body}`.toLowerCase();
  if (sourceType === "creator-platform" || CREATOR_PLATFORM_PATTERNS.some((pattern) => pattern.test(text))) {
    return { id: "creator-publishing", label: "订阅及发布通知" };
  }
  if (category === "financial-statement" || /statement|bill|invoice|receipt|账单|结单|发票|收据/.test(text)) {
    return sourceType === "bank"
      ? { id: "bank-statement", label: "银行账单" }
      : { id: "billing", label: "账单" };
  }
  if (/order|purchase|receipt|dispatch|delivered|订单|购买|退款|发货|包裹|物流/.test(text) || actionCategory === "delivery") {
    return { id: "shopping-order", label: "订单及物流" };
  }
  if (category === "security-alert" || actionCategory === "risk") {
    return { id: "security-alert", label: "安全提醒" };
  }
  if (category === "marketing-series" || actionCategory === "marketing") {
    return { id: "promotion", label: "促销活动" };
  }
  if (category === "report-series" || actionCategory === "status-update") {
    return { id: "report", label: "报告及状态更新" };
  }
  if (category === "notification-digest") {
    return { id: "notification", label: "通知" };
  }
  if (category === "reminder" || actionCategory === "request") {
    return { id: "reminder", label: "提醒及待办" };
  }
  return { id: "notification", label: "通知" };
}

function attentionBehaviorLabel(behaviorId) {
  return {
    "bank-statement": "银行账单",
    billing: "账单",
    "shopping-order": "订单及物流",
    "security-alert": "安全提醒",
    "creator-publishing": "订阅及发布通知",
    promotion: "促销活动",
    report: "报告及状态更新",
    notification: "通知",
    reminder: "提醒及待办"
  }[behaviorId] || behaviorId || "";
}

function buildAttentionModel({ from, subject, body, category, actionCategory }) {
  const sourceLabel = attentionSourceLabel(from, subject, body);
  const senderOrg = from?.orgDomain || from?.domain || "";
  const sourceType = sourceTypeFor({ sourceLabel, senderOrg, subject, body, category });
  const actorLabel = ACTOR_AWARE_SOURCE_TYPES.has(sourceType)
    ? extractCreatorActor({ sourceLabel, from, subject, body })
    : "";
  const behavior = behaviorForAttention({ category, actionCategory, sourceType, subject, body });
  const sourceBehaviorTitle = `${sourceLabel} ${behavior.label}`.trim();
  const actorBehaviorTitle = actorLabel ? `${actorLabel} 的 ${sourceLabel} ${behavior.label}` : "";
  return {
    sourceLabel,
    sourceType,
    actorLabel,
    behaviorId: behavior.id,
    behaviorLabel: behavior.label,
    sourceBehaviorTitle,
    actorBehaviorTitle,
    title: actorBehaviorTitle || sourceBehaviorTitle || normalizeSubject(subject) || "未命名事务",
    keys: uniqueStrings(
      [
        `source:${sourceLabel.toLowerCase()}`,
        `sourceBehavior:${sourceLabel.toLowerCase()}::${behavior.id}`,
        actorLabel ? `actor:${sourceLabel.toLowerCase()}::${actorLabel.toLowerCase()}` : "",
        actorLabel ? `actorBehavior:${sourceLabel.toLowerCase()}::${actorLabel.toLowerCase()}::${behavior.id}` : "",
        `behavior:${behavior.id}`,
        `sourceType:${sourceType}`
      ],
      10
    )
  };
}

async function readFilePrefix(filePath, maxBytes = DEFAULT_MAX_READ_BYTES) {
  const handle = await fs.open(filePath, "r");
  try {
    const stats = await handle.stat();
    const byteLength = Math.min(stats.size, maxBytes);
    const buffer = Buffer.alloc(byteLength);
    await handle.read(buffer, 0, byteLength, 0);
    return {
      buffer,
      stats
    };
  } finally {
    await handle.close();
  }
}

function splitHeaderBody(buffer) {
  const raw = buffer.toString("utf8");
  const match = raw.match(/\r?\n\r?\n/);
  if (!match || match.index === undefined) {
    return {
      headerText: raw,
      bodyText: ""
    };
  }
  return {
    headerText: raw.slice(0, match.index),
    bodyText: raw.slice(match.index + match[0].length)
  };
}

async function parseEmlFile(filePath, rootPath, options = {}) {
  const { buffer, stats } = await readFilePrefix(filePath, options.maxReadBytes);
  const { headerText, bodyText } = splitHeaderBody(buffer);
  const rawText = buffer.toString("utf8");
  const headers = unfoldHeaders(headerText);
  const subject = normalizeSubject(header(headers, "subject") || path.basename(filePath));
  const from = parseAddress(header(headers, "from"));
  const to = parseAddressList(header(headers, "to"));
  const cc = parseAddressList(header(headers, "cc"));
  const decodedBody = cleanEmailBodyForKnowledge(stripHtml(stripQuotedPrintableNoise(bodyText))).slice(0, 12000);
  const sentAt = parseDate(header(headers, "date"), new Date(stats.mtimeMs).toISOString());
  const tokens = tokenize(`${subject}\n${decodedBody.slice(0, 2000)}`);
  const category = detectCategory(tokens, subject, decodedBody);
  const cadenceHint = detectCadence(subject, decodedBody);
  const cadence = cadenceHint !== "irregular" ? cadenceHint : categoryDefaultCadence(category);
  const listId = normalizeListId(header(headers, "list-id"));
  const sender = senderKey(from);
  const subjectTemplate = tokens.length > 0 ? tokens.slice(0, 10).join(" ") : charSignature(subject).slice(0, 80);
  const relativePath = path.relative(rootPath, filePath).replace(/\\/g, "/");
  const messageId = normalizeMessageId(header(headers, "message-id"));
  const recipients = [...to, ...cc].map((item) => item.address || item.raw).filter(Boolean).slice(0, 20);
  const entityBody = decodedBody.slice(0, 4000);
  const attachmentRefs = extractAttachmentRefs(
    rawText.slice(0, 96 * 1024),
    filePath,
    options.normalizedRefsByName
  );
  const businessEntities = extractBusinessEntities({
    subject,
    body: entityBody,
    from,
    recipients,
    attachmentRefs
  });
  const actionCategory = detectActionCategory(subject, entityBody, attachmentRefs);
  const attention = buildAttentionModel({
    from,
    subject,
    body: entityBody,
    category,
    actionCategory
  });
  const parsed = {
    id: stableId("mail", `${messageId || relativePath}:${stats.size}:${stats.mtimeMs}`),
    filePath,
    relativePath,
    byteSize: stats.size,
    mtimeMs: stats.mtimeMs,
    fileFingerprint: sha1(`${filePath}:${stats.size}:${stats.mtimeMs}`),
    messageId,
    inReplyTo: normalizeMessageId(header(headers, "in-reply-to")),
    references: parseReferenceIds(headerAll(headers, "references").join(" ")),
    subject,
    normalizedSubject: normalizedSubjectText(subject),
    subjectTemplate,
    subjectTokens: tokens,
    subjectNgrams: ngrams(subject),
    from,
    senderKey: sender,
    senderOrg: from.orgDomain || from.domain || "",
    recipients,
    listId,
    campaignSignals: [
      normalizeListId(header(headers, "feedback-id")),
      normalizeListId(header(headers, "x-campaign-id")),
      normalizeListId(header(headers, "x-mailer"))
    ].filter(Boolean),
    sentAt,
    category,
    cadence,
    actionCategory,
    attention,
    businessEntities,
    attachmentRefs,
    bodyPreview: decodedBody.slice(0, 600),
    bodyText: decodedBody.slice(0, MAX_MESSAGE_BODY_TEXT),
    bodyTextTruncated: decodedBody.length > MAX_MESSAGE_BODY_TEXT,
    bodyTokens: tokenize(entityBody).slice(0, 20)
  };
  parsed.transactionFingerprint = buildTransactionFingerprint(parsed);

  return parsed;
}

function categoryDefaultCadence(category) {
  return CATEGORY_DEFINITIONS.find((item) => item.id === category)?.cadence || "irregular";
}

function emptyLineage(email) {
  const lineageId = randomUUID();
  return {
    lineageId,
    title: email.subject || "未命名事务",
    senderOrg: email.senderOrg,
    senderKeys: {},
    listIds: {},
    campaignSignals: {},
    subjectTemplates: {},
    subjectTokens: {},
    subjectNgrams: {},
    bodyTokens: {},
    attentionTitles: {},
    attentionSourceBehaviorTitles: {},
    attentionActorBehaviorTitles: {},
    attentionKeys: {},
    attentionSources: {},
    attentionSourceTypes: {},
    attentionBehaviors: {},
    attentionActors: {},
    actionCategories: {},
    participantGraphs: {},
    strongBusinessKeys: {},
    weakBusinessKeys: {},
    businessEntities: {},
    attachmentTitles: {},
    attachmentHashes: {},
    categories: {},
    cadences: {},
    participants: {},
    firstSeenAt: email.sentAt,
    lastSeenAt: email.sentAt,
    occurrenceCount: 0,
    byteSize: 0,
    messages: [],
    sampleMessages: [],
    recentMessages: [],
    evidenceScores: []
  };
}

function addCount(mapObject, key, value = 1) {
  const normalized = scalar(key);
  if (!normalized) {
    return;
  }
  mapObject[normalized] = (mapObject[normalized] || 0) + value;
}

function topKeys(mapObject, limit = 8) {
  return Object.entries(mapObject || {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

function dominantKey(mapObject, fallback = "") {
  return topKeys(mapObject, 1)[0] || fallback;
}

function updateLineage(lineage, email, evidence = null) {
  lineage.occurrenceCount += 1;
  lineage.byteSize += email.byteSize || 0;
  lineage.firstSeenAt =
    !lineage.firstSeenAt || String(email.sentAt).localeCompare(lineage.firstSeenAt) < 0
      ? email.sentAt
      : lineage.firstSeenAt;
  lineage.lastSeenAt =
    !lineage.lastSeenAt || String(email.sentAt).localeCompare(lineage.lastSeenAt) > 0
      ? email.sentAt
      : lineage.lastSeenAt;
  const attention = email.attention || {};
  addCount(lineage.attentionTitles, attention.title);
  addCount(lineage.attentionSourceBehaviorTitles, attention.sourceBehaviorTitle);
  addCount(lineage.attentionActorBehaviorTitles, attention.actorBehaviorTitle);
  for (const key of attention.keys || []) {
  addCount(lineage.attentionKeys, key);
  }
  addCount(lineage.attentionSources, attention.sourceLabel);
  addCount(lineage.attentionSourceTypes, attention.sourceType);
  addCount(lineage.attentionBehaviors, attention.behaviorId);
  addCount(lineage.attentionActors, attention.actorLabel);
  lineage.title = dominantKey(lineage.attentionTitles, lineage.title || email.subject || "未命名事务");
  addCount(lineage.senderKeys, email.senderKey);
  addCount(lineage.listIds, email.listId);
  for (const signal of email.campaignSignals || []) {
    addCount(lineage.campaignSignals, signal);
  }
  addCount(lineage.subjectTemplates, email.subjectTemplate);
  for (const token of email.subjectTokens || []) {
    addCount(lineage.subjectTokens, token);
  }
  for (const token of email.subjectNgrams || []) {
    addCount(lineage.subjectNgrams, token);
  }
  for (const token of email.bodyTokens || []) {
    addCount(lineage.bodyTokens, token);
  }
  addCount(lineage.actionCategories, email.actionCategory);
  addCount(lineage.participantGraphs, email.transactionFingerprint?.participantGraph);
  for (const key of email.transactionFingerprint?.strongKeys || []) {
    addCount(lineage.strongBusinessKeys, key);
  }
  for (const key of email.transactionFingerprint?.weakKeys || []) {
    addCount(lineage.weakBusinessKeys, key);
  }
  for (const [entityType, values] of Object.entries(email.businessEntities || {})) {
    if (!lineage.businessEntities[entityType]) {
      lineage.businessEntities[entityType] = {};
    }
    for (const value of values || []) {
      addCount(lineage.businessEntities[entityType], String(value).toLowerCase());
    }
  }
  for (const attachment of email.attachmentRefs || []) {
    addCount(lineage.attachmentTitles, attachment.title);
    addCount(lineage.attachmentHashes, attachment.hash);
  }
  addCount(lineage.categories, email.category);
  addCount(lineage.cadences, email.cadence);
  for (const recipient of email.recipients || []) {
    addCount(lineage.participants, recipient);
  }
  const sample = {
    id: email.id,
    subject: email.subject,
    sentAt: email.sentAt,
    from: email.from?.address || email.from?.raw || "",
    filePath: email.relativePath,
    messageId: email.messageId,
    actionCategory: email.actionCategory,
    attention: email.attention,
    businessEntities: email.businessEntities,
    attachmentRefs: email.attachmentRefs,
    category: email.category,
    recipients: email.recipients || [],
    bodyText: email.bodyText || email.bodyPreview || "",
    bodyTextTruncated: Boolean(email.bodyTextTruncated)
  };
  lineage.messages.push(sample);
  if (lineage.sampleMessages.length < 12) {
    lineage.sampleMessages.push(sample);
  }
  lineage.recentMessages.push(sample);
  lineage.recentMessages = lineage.recentMessages
    .sort((left, right) => String(right.sentAt).localeCompare(String(left.sentAt)))
    .slice(0, 20);
  if (evidence) {
    lineage.evidenceScores.push(evidence);
    lineage.evidenceScores = lineage.evidenceScores.slice(-20);
  }
}

function lineageView(lineage) {
  const businessEntities = {};
  for (const [entityType, counts] of Object.entries(lineage.businessEntities || {})) {
    businessEntities[entityType] = topKeys(counts, 10);
  }
  return {
    lineageId: lineage.lineageId,
    title: lineage.title,
    senderOrg: lineage.senderOrg,
    senderKeys: topKeys(lineage.senderKeys, 6),
    listIds: topKeys(lineage.listIds, 6),
    subjectTemplates: topKeys(lineage.subjectTemplates, 6),
    subjectTokens: topKeys(lineage.subjectTokens, 14),
    subjectNgrams: topKeys(lineage.subjectNgrams, 40),
    bodyTokens: topKeys(lineage.bodyTokens, 16),
    attention: {
      title: dominantKey(lineage.attentionTitles, lineage.title),
      sourceBehaviorTitle: dominantKey(lineage.attentionSourceBehaviorTitles, ""),
      actorBehaviorTitle: dominantKey(lineage.attentionActorBehaviorTitles, ""),
      sourceLabel: dominantKey(lineage.attentionSources, ""),
      sourceType: dominantKey(lineage.attentionSourceTypes, ""),
      behaviorId: dominantKey(lineage.attentionBehaviors, ""),
      behaviorLabel: attentionBehaviorLabel(dominantKey(lineage.attentionBehaviors, "")),
      actorLabel: dominantKey(lineage.attentionActors, ""),
      keys: topKeys(lineage.attentionKeys, 16),
      titles: topKeys(lineage.attentionTitles, 8)
    },
    actionCategory: dominantKey(lineage.actionCategories, "inform"),
    participantGraphs: topKeys(lineage.participantGraphs, 10),
    strongBusinessKeys: topKeys(lineage.strongBusinessKeys, 24),
    weakBusinessKeys: topKeys(lineage.weakBusinessKeys, 24),
    businessEntities,
    attachmentTitles: topKeys(lineage.attachmentTitles, 12),
    attachmentHashes: topKeys(lineage.attachmentHashes, 12),
    category: dominantKey(lineage.categories, "general"),
    cadence: dominantKey(lineage.cadences, "irregular"),
    participantKeys: topKeys(lineage.participants, 12),
    firstSeenAt: lineage.firstSeenAt,
    lastSeenAt: lineage.lastSeenAt,
    occurrenceCount: lineage.occurrenceCount,
    byteSize: lineage.byteSize,
    messages: [...(lineage.messages || [])].sort((left, right) =>
      String(left.sentAt).localeCompare(String(right.sentAt))
    ),
    sampleMessages: lineage.sampleMessages,
    recentMessages: lineage.recentMessages,
    evidenceScores: lineage.evidenceScores
  };
}

function daysBetween(left, right) {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) {
    return 9999;
  }
  return Math.abs(Math.round((rightDate - leftDate) / 86400000));
}

function cadenceCompatible(left, right) {
  if (!left || !right || left === "irregular" || right === "irregular") {
    return false;
  }
  return left === right;
}

function timeCompatibility(email, lineage) {
  const gap = Math.min(daysBetween(email.sentAt, lineage.firstSeenAt), daysBetween(email.sentAt, lineage.lastSeenAt));
  const cadence = dominantKey(lineage.cadences, "irregular");
  if (cadence === "daily") {
    return gap <= 10 ? 1 : gap <= 45 ? 0.4 : 0.1;
  }
  if (cadence === "weekly") {
    return gap <= 45 ? 1 : gap <= 180 ? 0.55 : 0.2;
  }
  if (cadence === "monthly") {
    return gap <= 120 ? 1 : gap <= 540 ? 0.65 : 0.35;
  }
  if (cadence === "annual") {
    return gap <= 420 ? 1 : gap <= 900 ? 0.55 : 0.2;
  }
  return gap <= 90 ? 0.8 : gap <= 365 ? 0.4 : 0.15;
}

function categoryGroup(category) {
  return NEGATIVE_CATEGORY_GROUPS.findIndex((group) => group.has(category || ""));
}

function hasNegativeCategoryConflict(email, view) {
  const left = categoryGroup(email.category);
  const right = categoryGroup(view.category);
  return left >= 0 && right >= 0 && left !== right;
}

function hasStrongEntityConflict(email, view) {
  const currentStrong = email.transactionFingerprint?.strongKeys || [];
  const lineageStrong = view.strongBusinessKeys || [];
  if (currentStrong.length === 0 || lineageStrong.length === 0) {
    return false;
  }
  const currentBuckets = new Map();
  for (const key of currentStrong) {
    const [bucket, value] = String(key).split(":", 2);
    if (!currentBuckets.has(bucket)) {
      currentBuckets.set(bucket, new Set());
    }
    currentBuckets.get(bucket).add(value);
  }
  for (const [bucket, values] of currentBuckets.entries()) {
    const lineageValues = lineageStrong
      .filter((key) => String(key).startsWith(`${bucket}:`))
      .map((key) => String(key).split(":", 2)[1]);
    if (lineageValues.length > 0 && !lineageValues.some((value) => values.has(value))) {
      return true;
    }
  }
  return false;
}

function attentionKeyWithPrefix(keys, prefix) {
  return (keys || []).find((key) => String(key).startsWith(prefix)) || "";
}

function hasAttentionActorConflict(email, view) {
  const currentActor = scalar(email.attention?.actorLabel).toLowerCase();
  const currentSource = scalar(email.attention?.sourceLabel).toLowerCase();
  const currentBehavior = scalar(email.attention?.behaviorId);
  const currentSourceType = scalar(email.attention?.sourceType);
  const lineageActor = scalar(view.attention?.actorLabel).toLowerCase();
  const lineageSource = scalar(view.attention?.sourceLabel).toLowerCase();
  const lineageBehavior = scalar(view.attention?.behaviorId);
  const lineageSourceType = scalar(view.attention?.sourceType);
  const actorAware =
    ACTOR_AWARE_SOURCE_TYPES.has(currentSourceType) || ACTOR_AWARE_SOURCE_TYPES.has(lineageSourceType);
  if (
    actorAware &&
    currentSource &&
    lineageSource &&
    currentSource === lineageSource &&
    currentBehavior &&
    currentBehavior === lineageBehavior &&
    (currentActor || lineageActor) &&
    currentActor !== lineageActor
  ) {
    return true;
  }
  const actorKeys = (view.attention?.keys || [])
    .map((key) => String(key).toLowerCase())
    .filter((key) => key.startsWith(`actorbehavior:${currentSource}::`) && key.endsWith(`::${currentBehavior}`));
  if (currentActor && actorKeys.length > 0) {
    return !actorKeys.some((key) => key === `actorbehavior:${currentSource}::${currentActor}::${currentBehavior}`);
  }
  return Boolean(currentActor && lineageActor && currentActor !== lineageActor);
}

function hasAttentionBehaviorConflict(email, view) {
  const currentBehavior = scalar(email.attention?.behaviorId);
  const lineageBehavior = scalar(view.attention?.behaviorId);
  return Boolean(currentBehavior && lineageBehavior && currentBehavior !== lineageBehavior);
}

function scoreLineage(email, lineage) {
  const view = lineageView(lineage);
  const senderOrgExact = email.senderOrg && email.senderOrg === view.senderOrg;
  const senderKeyOverlap = email.senderKey && view.senderKeys.includes(email.senderKey);
  const listExact = email.listId && view.listIds.includes(email.listId);
  const campaignOverlap = jaccard(email.campaignSignals, topKeys(lineage.campaignSignals, 12));
  const templateExact = email.subjectTemplate && view.subjectTemplates.includes(email.subjectTemplate);
  const subjectTokenScore = jaccard(email.subjectTokens, view.subjectTokens);
  const ngramScore = jaccard(email.subjectNgrams, view.subjectNgrams);
  const bodyScore = jaccard(email.bodyTokens, view.bodyTokens);
  const categoryMatch = email.category && email.category === view.category;
  const cadenceMatch = cadenceCompatible(email.cadence, view.cadence);
  const participantScore = jaccard(email.recipients, view.participantKeys);
  const participantGraphScore = jaccard([email.transactionFingerprint?.participantGraph], view.participantGraphs);
  const strongEntityScore = jaccard(email.transactionFingerprint?.strongKeys, view.strongBusinessKeys);
  const weakEntityScore = jaccard(email.transactionFingerprint?.weakKeys, view.weakBusinessKeys);
  const entityValueScore = jaccard(entityValues(email.businessEntities), entityValues(view.businessEntities));
  const attentionScore = jaccard(email.attention?.keys || [], view.attention?.keys || []);
  const currentAttentionSource = scalar(email.attention?.sourceLabel).toLowerCase();
  const lineageAttentionSource = scalar(view.attention?.sourceLabel).toLowerCase();
  const currentAttentionBehavior = scalar(email.attention?.behaviorId);
  const lineageAttentionBehavior = scalar(view.attention?.behaviorId);
  const sourceBehaviorExact =
    currentAttentionSource &&
    lineageAttentionSource &&
    currentAttentionSource === lineageAttentionSource &&
    currentAttentionBehavior &&
    currentAttentionBehavior === lineageAttentionBehavior;
  const actorBehaviorExact =
    sourceBehaviorExact &&
    scalar(email.attention?.actorLabel) &&
    scalar(email.attention?.actorLabel).toLowerCase() === scalar(view.attention?.actorLabel).toLowerCase();
  const actorBoundaryRequired =
    ACTOR_AWARE_SOURCE_TYPES.has(scalar(email.attention?.sourceType)) &&
    Boolean(scalar(email.attention?.actorLabel) || scalar(view.attention?.actorLabel));
  const attentionScoreForMerge = actorBoundaryRequired && !actorBehaviorExact ? 0 : attentionScore;
  const sourceBehaviorExactForMerge = sourceBehaviorExact && (!actorBoundaryRequired || actorBehaviorExact);
  const behaviorMatch =
    attentionKeyWithPrefix(email.attention?.keys, "behavior:") &&
    view.attention?.keys?.includes(attentionKeyWithPrefix(email.attention?.keys, "behavior:"));
  const actionMatch = email.actionCategory && email.actionCategory === view.actionCategory;
  const timeScore = timeCompatibility(email, lineage);
  const negativeCategoryConflict = hasNegativeCategoryConflict(email, view);
  const strongEntityConflict = hasStrongEntityConflict(email, view);
  const attentionActorConflict = hasAttentionActorConflict(email, view);
  const attentionBehaviorConflict = hasAttentionBehaviorConflict(email, view);
  const lineageHasStrongEntities = (view.strongBusinessKeys || []).length > 0;
  const emailHasStrongEntities = (email.transactionFingerprint?.strongKeys || []).length > 0;
  const strongStage =
    strongEntityScore > 0
      ? "strong-entity"
      : listExact && senderOrgExact
        ? "list-sender"
        : "";
  const weakStage =
    actorBehaviorExact || sourceBehaviorExactForMerge || attentionScoreForMerge >= 0.28
      ? "attention-facet"
      : subjectTokenScore >= 0.32 || ngramScore >= 0.35 || weakEntityScore >= 0.22
      ? "weak-topic"
      : participantGraphScore >= 0.5 || participantScore >= 0.34
        ? "weak-participants"
        : "";
  let score =
    (strongEntityScore > 0 ? 0.52 : 0) +
    weakEntityScore * 0.22 +
    entityValueScore * 0.12 +
    attentionScoreForMerge * 0.34 +
    (actorBehaviorExact ? 0.32 : 0) +
    (sourceBehaviorExactForMerge ? 0.22 : 0) +
    (listExact ? 0.36 : 0) +
    (senderOrgExact ? 0.18 : 0) +
    (senderKeyOverlap ? 0.08 : 0) +
    (templateExact ? 0.28 : 0) +
    subjectTokenScore * 0.28 +
    ngramScore * 0.14 +
    bodyScore * 0.06 +
    campaignOverlap * 0.12 +
    (categoryMatch ? 0.08 : 0) +
    (actionMatch ? 0.08 : 0) +
    (cadenceMatch ? 0.08 : 0) +
    participantScore * 0.08 +
    participantGraphScore * 0.1 +
    timeScore * 0.05;

  if (negativeCategoryConflict && strongEntityScore === 0 && !actorBehaviorExact && !sourceBehaviorExactForMerge) {
    score = Math.min(score, 0.52);
  }

  if (strongEntityConflict) {
    score = Math.min(score, 0.34);
  }

  if (attentionActorConflict && strongEntityScore === 0) {
    score = Math.min(score, 0.5);
  }

  if (attentionBehaviorConflict && strongEntityScore === 0) {
    score = Math.min(score, 0.48);
  }

  if (lineageHasStrongEntities && !emailHasStrongEntities && weakEntityScore < 0.3) {
    score = Math.min(score, 0.6);
  }

  if (!senderOrgExact && !listExact && campaignOverlap < 0.4) {
    score = Math.min(score, strongEntityScore > 0 ? score : 0.58);
  }

  if ((participantScore >= 0.4 || participantGraphScore >= 0.5) && subjectTokenScore < 0.18 && weakEntityScore === 0 && strongEntityScore === 0) {
    score = Math.min(score, 0.55);
  }

  const reasons = [];
  if (strongEntityScore > 0) reasons.push("strong-business-entity");
  if (actorBehaviorExact) reasons.push("attention-actor-behavior-exact");
  if (sourceBehaviorExactForMerge) reasons.push("attention-source-behavior-exact");
  if (attentionScoreForMerge >= 0.3) reasons.push("attention-facet-overlap");
  if (weakEntityScore >= 0.2) reasons.push("weak-business-entity");
  if (listExact) reasons.push("list-id-exact");
  if (senderOrgExact) reasons.push("sender-org-exact");
  if (senderKeyOverlap) reasons.push("sender-key-overlap");
  if (templateExact) reasons.push("subject-template-exact");
  if (subjectTokenScore >= 0.3) reasons.push("subject-token-overlap");
  if (ngramScore >= 0.35) reasons.push("subject-shape-overlap");
  if (actionMatch) reasons.push("action-match");
  if (categoryMatch) reasons.push("category-match");
  if (cadenceMatch) reasons.push("cadence-match");
  if (participantScore >= 0.2) reasons.push("recipient-overlap");
  if (participantGraphScore >= 0.4) reasons.push("participant-graph-overlap");
  if (negativeCategoryConflict) reasons.push("negative-category-guard");
  if (strongEntityConflict) reasons.push("strong-entity-conflict");
  if (attentionActorConflict) reasons.push("attention-actor-conflict");
  if (attentionBehaviorConflict) reasons.push("attention-behavior-conflict");

  const accepted =
    !strongEntityConflict &&
    (!actorBoundaryRequired || actorBehaviorExact || strongEntityScore > 0) &&
    (!attentionActorConflict || actorBehaviorExact || strongEntityScore > 0) &&
    (!attentionBehaviorConflict || sourceBehaviorExact || strongEntityScore > 0) &&
    (!negativeCategoryConflict || strongEntityScore > 0 || actorBehaviorExact || sourceBehaviorExactForMerge) &&
    ((strongStage && score >= 0.56) ||
      (senderOrgExact && actorBehaviorExact && score >= 0.58) ||
      (senderOrgExact && sourceBehaviorExactForMerge && behaviorMatch && score >= 0.62) ||
      (senderOrgExact && templateExact && score >= 0.58) ||
      (senderOrgExact && weakStage && score >= 0.62) ||
      (senderOrgExact && categoryMatch && actionMatch && cadenceMatch && score >= 0.66) ||
      (timeScore >= 0.8 &&
        senderOrgExact &&
        weakEntityScore >= 0.18 &&
        subjectTokenScore >= 0.18 &&
        score >= 0.68) ||
      score >= 0.74);

  return {
    accepted,
    score: Number(Math.min(1, score).toFixed(4)),
    reasons,
    stage: strongStage || weakStage || "time-window",
    strongEntityScore: Number(strongEntityScore.toFixed(4)),
    weakEntityScore: Number(weakEntityScore.toFixed(4)),
    entityValueScore: Number(entityValueScore.toFixed(4)),
    attentionScore: Number(attentionScore.toFixed(4)),
    subjectTokenScore: Number(subjectTokenScore.toFixed(4)),
    ngramScore: Number(ngramScore.toFixed(4)),
    bodyScore: Number(bodyScore.toFixed(4)),
    participantScore: Number(participantScore.toFixed(4)),
    participantGraphScore: Number(participantGraphScore.toFixed(4)),
    timeScore: Number(timeScore.toFixed(4))
  };
}

function addCandidate(set, map, key) {
  if (!key) {
    return;
  }
  for (const lineageId of map.get(key) || []) {
    set.add(lineageId);
  }
}

function addIndex(map, key, lineageId) {
  if (!key) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  map.get(key).add(lineageId);
}

function removeIndex(map, key, lineageId) {
  if (!key || !map.has(key)) {
    return;
  }
  map.get(key).delete(lineageId);
  if (map.get(key).size === 0) {
    map.delete(key);
  }
}

function indexKeysForLineage(lineage) {
  const view = lineageView(lineage);
  const keys = [];
  keys.push(["senderOrg", view.senderOrg]);
  for (const listId of view.listIds) keys.push(["list", listId]);
  for (const senderKeyItem of view.senderKeys) keys.push(["senderKey", senderKeyItem]);
  for (const template of view.subjectTemplates) keys.push(["senderTemplate", `${view.senderOrg}::${template}`]);
  for (const token of view.subjectTokens.slice(0, 8)) keys.push(["senderToken", `${view.senderOrg}::${token}`]);
  for (const category of topKeys(lineage.categories, 2)) keys.push(["senderCategory", `${view.senderOrg}::${category}`]);
  for (const strongKey of view.strongBusinessKeys) keys.push(["strongBusiness", strongKey]);
  for (const weakKey of view.weakBusinessKeys.slice(0, 12)) keys.push(["senderWeakBusiness", `${view.senderOrg}::${weakKey}`]);
  for (const attentionKey of view.attention?.keys || []) {
    keys.push(["attention", attentionKey]);
    keys.push(["senderAttention", `${view.senderOrg}::${attentionKey}`]);
  }
  for (const action of topKeys(lineage.actionCategories, 2)) keys.push(["senderAction", `${view.senderOrg}::${action}`]);
  return keys;
}

function buildLineageIndexes(lineages) {
  const indexes = {
    senderOrg: new Map(),
    list: new Map(),
    senderKey: new Map(),
    senderTemplate: new Map(),
    senderToken: new Map(),
    senderCategory: new Map(),
    senderAction: new Map(),
    strongBusiness: new Map(),
    senderWeakBusiness: new Map(),
    attention: new Map(),
    senderAttention: new Map()
  };
  for (const lineage of lineages.values()) {
    for (const [bucket, key] of indexKeysForLineage(lineage)) {
      addIndex(indexes[bucket], key, lineage.lineageId);
    }
  }
  return indexes;
}

function candidateLineageIds(email, indexes) {
  const candidates = new Set();
  addCandidate(candidates, indexes.list, email.listId);
  addCandidate(candidates, indexes.senderKey, email.senderKey);
  addCandidate(candidates, indexes.senderTemplate, `${email.senderOrg}::${email.subjectTemplate}`);
  addCandidate(candidates, indexes.senderCategory, `${email.senderOrg}::${email.category}`);
  addCandidate(candidates, indexes.senderAction, `${email.senderOrg}::${email.actionCategory}`);
  for (const key of email.attention?.keys || []) {
    addCandidate(candidates, indexes.senderAttention, `${email.senderOrg}::${key}`);
    if (key.startsWith("actorBehavior:") || key.startsWith("sourceBehavior:")) {
      addCandidate(candidates, indexes.attention, key);
    }
  }
  for (const key of email.transactionFingerprint?.strongKeys || []) {
    addCandidate(candidates, indexes.strongBusiness, key);
  }
  for (const key of (email.transactionFingerprint?.weakKeys || []).slice(0, 12)) {
    addCandidate(candidates, indexes.senderWeakBusiness, `${email.senderOrg}::${key}`);
  }
  for (const token of email.subjectTokens.slice(0, 8)) {
    addCandidate(candidates, indexes.senderToken, `${email.senderOrg}::${token}`);
  }
  if (candidates.size < 20) {
    addCandidate(candidates, indexes.senderOrg, email.senderOrg);
  }
  return [...candidates].slice(0, 420);
}

function reindexLineage(indexes, lineage, beforeKeys = []) {
  for (const [bucket, key] of beforeKeys) {
    removeIndex(indexes[bucket], key, lineage.lineageId);
  }
  for (const [bucket, key] of indexKeysForLineage(lineage)) {
    addIndex(indexes[bucket], key, lineage.lineageId);
  }
}

function assignEmail(email, state) {
  const candidates = candidateLineageIds(email, state.indexes)
    .map((lineageId) => state.lineages.get(lineageId))
    .filter(Boolean);
  let best = null;
  for (const lineage of candidates) {
    const evidence = scoreLineage(email, lineage);
    if (!evidence.accepted) {
      continue;
    }
    if (!best || evidence.score > best.evidence.score) {
      best = { lineage, evidence };
    }
  }

  if (!best) {
    for (const lineage of candidates) {
      const view = lineageView(lineage);
      const evidence = scoreLineage(email, lineage);
      if (
        evidence.reasons.includes("attention-actor-conflict") ||
        evidence.reasons.includes("attention-behavior-conflict")
      ) {
        continue;
      }
      const sameStableList = email.listId && view.listIds.includes(email.listId);
      const sameOperationalSeries =
        email.senderOrg &&
        email.senderOrg === view.senderOrg &&
        email.category === view.category &&
        email.actionCategory === view.actionCategory &&
        !view.strongBusinessKeys.length &&
        evidence.timeScore >= 0.75;
      if (!(sameStableList || sameOperationalSeries) || evidence.score < 0.5) {
        continue;
      }
      if (!best || evidence.score > best.evidence.score) {
        best = {
          lineage,
          evidence: {
            ...evidence,
            accepted: true,
            reasons: [...new Set([...evidence.reasons, sameStableList ? "stable-list-fallback" : "operational-series-fallback"])]
          }
        };
      }
    }
  }

  if (!best) {
    const lineage = emptyLineage(email);
    updateLineage(lineage, email, {
      score: 1,
      reasons: ["new-lineage"],
      assignedAt: new Date().toISOString()
    });
    state.lineages.set(lineage.lineageId, lineage);
    reindexLineage(state.indexes, lineage);
    return {
      lineageId: lineage.lineageId,
      stage: "new",
      score: 1,
      reasons: ["new-lineage"]
    };
  }

  const beforeKeys = indexKeysForLineage(best.lineage);
  updateLineage(best.lineage, email, {
    ...best.evidence,
    assignedAt: new Date().toISOString()
  });
  reindexLineage(state.indexes, best.lineage, beforeKeys);
  return {
    lineageId: best.lineage.lineageId,
    stage: "matched",
    score: best.evidence.score,
    reasons: best.evidence.reasons
  };
}

function rebuildStateFromEmails(emails) {
  const state = {
    lineages: new Map(),
    indexes: buildLineageIndexes(new Map())
  };
  const assignments = [];
  const ordered = [...emails].sort((left, right) => {
    const timeOrder = String(left.sentAt || "").localeCompare(String(right.sentAt || ""));
    if (timeOrder !== 0) {
      return timeOrder;
    }
    return String(left.relativePath || left.filePath || "").localeCompare(String(right.relativePath || right.filePath || ""));
  });

  for (const email of ordered) {
    if (!email.transactionFingerprint) {
      email.transactionFingerprint = buildTransactionFingerprint(email);
    }
    const assignment = assignEmail(email, state);
    assignments.push({
      filePath: email.filePath,
      email,
      assignment
    });
  }
  return {
    state,
    assignments
  };
}

function loadParsedEmails(db) {
  return db
    .prepare("SELECT file_path, parsed_json FROM continuity_files ORDER BY root_path, relative_path")
    .all()
    .map((row) => {
      try {
        const email = JSON.parse(row.parsed_json);
        return {
          ...email,
          filePath: email.filePath || row.file_path
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getMetaValue(db, key) {
  return db.prepare("SELECT value FROM continuity_meta WHERE key = ?").get(key)?.value || "";
}

function setMetaValue(db, key, value) {
  db.prepare(
    "INSERT INTO continuity_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value || ""));
}

function shouldRunReview(db, stats, { rebuild, reviewEvery, reviewDaily, forceReview }) {
  if (forceReview || rebuild) {
    return true;
  }
  if (reviewEvery > 0 && stats.processedFiles >= reviewEvery) {
    return true;
  }
  if (!reviewDaily) {
    return false;
  }
  const today = new Date().toISOString().slice(0, 10);
  return getMetaValue(db, "last_review_date") !== today;
}

function applyReviewAssignments(db, assignments) {
  const updateFile = db.prepare(`
    UPDATE continuity_files
    SET lineage_id = ?, assignment_score = ?, assignment_reasons_json = ?, updated_at = ?
    WHERE file_path = ?
  `);
  const clearLineages = db.prepare("DELETE FROM continuity_lineages");
  const replaceLineage = replaceLineageStmt(db);
  const now = new Date().toISOString();
  const persist = db.transaction(() => {
    for (const { filePath, assignment } of assignments) {
      updateFile.run(
        assignment.lineageId,
        assignment.score,
        JSON.stringify(assignment.reasons),
        now,
        filePath
      );
    }
    clearLineages.run();
  });
  persist();
  return replaceLineage;
}

async function walkEmlFiles(rootPath, options = {}) {
  const files = [];
  const ignoreNames = new Set([".git", "node_modules", ".dart_tool", "DerivedData"]);
  async function visit(currentPath) {
    let entries;
    try {
      entries = await fs.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignoreNames.has(entry.name)) {
        continue;
      }
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".eml")) {
        files.push(entryPath);
        if (options.limit > 0 && files.length >= options.limit) {
          return;
        }
      }
    }
  }
  await visit(rootPath);
  return files.sort();
}

function initializeContinuityDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS continuity_files (
      file_path TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      mtime_ms REAL NOT NULL,
      byte_size INTEGER NOT NULL,
      file_fingerprint TEXT NOT NULL,
      message_id TEXT NOT NULL DEFAULT '',
      lineage_id TEXT NOT NULL,
      assignment_score REAL NOT NULL DEFAULT 0,
      assignment_reasons_json TEXT NOT NULL DEFAULT '[]',
      parsed_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS continuity_lineages (
      lineage_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      sender_org TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      cadence TEXT NOT NULL DEFAULT 'irregular',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 0,
      model_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS continuity_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_continuity_files_lineage ON continuity_files(lineage_id);
    CREATE INDEX IF NOT EXISTS idx_continuity_lineages_last_seen ON continuity_lineages(last_seen_at DESC);
  `);
}

function loadState(db) {
  const rows = db.prepare("SELECT model_json FROM continuity_lineages").all();
  const lineages = new Map();
  for (const row of rows) {
    try {
      const lineage = JSON.parse(row.model_json);
      if (lineage?.lineageId) {
        for (const key of [
          "attentionTitles",
          "attentionSourceBehaviorTitles",
          "attentionActorBehaviorTitles",
          "attentionKeys",
          "attentionSources",
          "attentionSourceTypes",
          "attentionBehaviors",
          "attentionActors"
        ]) {
          if (!lineage[key] || typeof lineage[key] !== "object" || Array.isArray(lineage[key])) {
            lineage[key] = {};
          }
        }
        if (!Array.isArray(lineage.messages)) {
          const byId = new Map();
          for (const message of [...(lineage.sampleMessages || []), ...(lineage.recentMessages || [])]) {
            const key = message.id || message.messageId || `${message.sentAt}:${message.subject}`;
            if (key && !byId.has(key)) {
              byId.set(key, message);
            }
          }
          lineage.messages = [...byId.values()];
        }
        lineages.set(lineage.lineageId, lineage);
      }
    } catch {
      // Ignore corrupt auxiliary rows; they will be replaced by later runs.
    }
  }
  return {
    lineages,
    indexes: buildLineageIndexes(lineages)
  };
}

function upsertFileStmt(db) {
  return db.prepare(`
    INSERT INTO continuity_files (
      file_path, root_path, relative_path, mtime_ms, byte_size, file_fingerprint,
      message_id, lineage_id, assignment_score, assignment_reasons_json, parsed_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      root_path = excluded.root_path,
      relative_path = excluded.relative_path,
      mtime_ms = excluded.mtime_ms,
      byte_size = excluded.byte_size,
      file_fingerprint = excluded.file_fingerprint,
      message_id = excluded.message_id,
      lineage_id = excluded.lineage_id,
      assignment_score = excluded.assignment_score,
      assignment_reasons_json = excluded.assignment_reasons_json,
      parsed_json = excluded.parsed_json,
      updated_at = excluded.updated_at
  `);
}

function replaceLineageStmt(db) {
  return db.prepare(`
    INSERT INTO continuity_lineages (
      lineage_id, title, sender_org, category, cadence, first_seen_at, last_seen_at,
      occurrence_count, model_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(lineage_id) DO UPDATE SET
      title = excluded.title,
      sender_org = excluded.sender_org,
      category = excluded.category,
      cadence = excluded.cadence,
      first_seen_at = excluded.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      occurrence_count = excluded.occurrence_count,
      model_json = excluded.model_json,
      updated_at = excluded.updated_at
  `);
}

function fileUnchanged(db, filePath, stats) {
  const row = db.prepare("SELECT mtime_ms, byte_size FROM continuity_files WHERE file_path = ?").get(filePath);
  return Boolean(
    row &&
      Math.abs(Number(row.mtime_ms) - Number(stats.mtimeMs)) < 1 &&
      Number(row.byte_size) === Number(stats.size)
  );
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function paragraph(text, spacingAfter = 100) {
  return new Paragraph({
    spacing: { after: spacingAfter },
    children: [new TextRun(String(text || ""))]
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({
    heading: level,
    spacing: { before: 180, after: 120 },
    children: [new TextRun(String(text || ""))]
  });
}

function tableFromRows(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (row) =>
        new TableRow({
          children: row.map((cell) => new TableCell({ children: [paragraph(cell, 40)] }))
        })
    )
  });
}

function bullet(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun(String(text || ""))]
  });
}

function codeLine(text) {
  return new Paragraph({
    spacing: { after: 10 },
    children: [
      new TextRun({
        text: String(text || " "),
        font: "Courier New",
        size: 18
      })
    ]
  });
}

function jsonBlock(value) {
  return JSON.stringify(value, null, 2).split("\n").map(codeLine);
}

function yamlScalar(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const text = String(value);
  if (!text) {
    return '""';
  }
  if (
    /^[\p{L}\p{N}_./:@+\- ]+$/u.test(text) &&
    !/^(?:true|false|null|yes|no|on|off)$/i.test(text) &&
    !/^\d/.test(text)
  ) {
    return text;
  }
  return JSON.stringify(text);
}

function yamlLines(value, indent = 0) {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${prefix}[]`];
    }
    return value.flatMap((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return [`${prefix}-`, ...yamlLines(item, indent + 2)];
      }
      return [`${prefix}- ${yamlScalar(item)}`];
    });
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return [`${prefix}{}`];
    }
    return entries.flatMap(([key, item]) => {
      if (Array.isArray(item)) {
        if (item.length === 0) {
          return [`${prefix}${key}: []`];
        }
        return [`${prefix}${key}:`, ...yamlLines(item, indent + 2)];
      }
      if (item && typeof item === "object") {
        return [`${prefix}${key}:`, ...yamlLines(item, indent + 2)];
      }
      return [`${prefix}${key}: ${yamlScalar(item)}`];
    });
  }
  return [`${prefix}${yamlScalar(value)}`];
}

function yamlBlock(value) {
  return yamlLines(value).map(codeLine);
}

async function writeDocx(filePath, children) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const document = new Document({
    sections: [{ children }]
  });
  await fs.writeFile(filePath, await Packer.toBuffer(document));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function transactionSummary(lineage) {
  const view = lineageView(lineage);
  return {
    lineageId: view.lineageId,
    title: view.attention?.title || view.title,
    senderOrg: view.senderOrg,
    attention: view.attention,
    category: view.category,
    cadence: view.cadence,
    occurrenceCount: view.occurrenceCount,
    firstSeenAt: view.firstSeenAt,
    lastSeenAt: view.lastSeenAt,
    subjectTokens: view.subjectTokens,
    subjectTemplates: view.subjectTemplates,
    listIds: view.listIds,
    actionCategory: view.actionCategory,
    actionCategories: topKeys(lineage.actionCategories, 8),
    participantGraphs: view.participantGraphs,
    strongBusinessKeys: view.strongBusinessKeys,
    weakBusinessKeys: view.weakBusinessKeys,
    businessEntities: view.businessEntities,
    attachmentTitles: view.attachmentTitles,
    attachmentHashes: view.attachmentHashes,
    sampleSubjects: view.sampleMessages.map((item) => item.subject).slice(0, 8),
    messages: view.messages,
    recentMessages: view.recentMessages
  };
}

function displayDateTime(value) {
  const text = scalar(value);
  return text ? text.replace("T", " ").replace(/\.\d{3}Z$/, " UTC").slice(0, 23) : "未知时间";
}

function readableValues(values, fallback = "无") {
  const list = uniqueStrings(values || [], 16);
  return list.length > 0 ? list.join("、") : fallback;
}

const ENTITY_LABELS = {
  projectNames: "项目",
  projectIds: "项目编号",
  ticketIds: "工单/需求编号",
  contractIds: "合同/协议编号",
  invoiceIds: "发票/账单编号",
  orderIds: "订单/采购编号",
  amounts: "金额",
  customers: "客户",
  suppliers: "供应商",
  organizations: "组织",
  systems: "系统/平台",
  locations: "地点",
  versions: "版本",
  attachmentTitles: "附件标题",
  attachmentHashes: "附件哈希"
};

const CATEGORY_LABELS = {
  "marketing-series": "营销/活动连续通知",
  "notification-digest": "通知摘要",
  "security-alert": "安全提醒",
  "financial-statement": "账单/结单",
  "report-series": "报告序列",
  reminder: "提醒",
  statement: "账单/结单",
  order: "订单/交易",
  delivery: "物流/交付",
  general: "一般事务"
};

const ACTION_LABELS = {
  inform: "通知",
  request: "请求",
  approval: "审批",
  payment: "付款/账务",
  delivery: "交付/物流",
  risk: "风险/异常",
  meeting: "会议",
  "status-update": "状态更新",
  marketing: "营销"
};

function categoryLabel(value) {
  return CATEGORY_LABELS[value] || value || "一般事务";
}

function actionLabel(value) {
  return ACTION_LABELS[value] || value || "通知";
}

function transactionIntentHints(item) {
  const text = `${item.category} ${item.actionCategories.join(" ")} ${item.subjectTokens.join(" ")}`.toLowerCase();
  const hints = [];
  if (/order|delivery|payment|invoice|statement|purchase|账单|订单|付款/.test(text)) {
    hints.push("可用于回答最近购买、订单、付款、发货、账单相关问题");
  }
  if (/security|alert|login|risk|安全|登录|风险/.test(text)) {
    hints.push("可用于回答账号安全、登录提醒、风险告警相关问题");
  }
  if (/meeting|status|report|weekly|monthly|会议|周报|月报|进展/.test(text)) {
    hints.push("可用于回答周期汇报、会议、项目进展相关问题");
  }
  if (/marketing|sale|offer|discount|newsletter|促销|优惠/.test(text)) {
    hints.push("主要是营销或订阅通知，默认不应和订单、账单、安全提醒合并理解");
  }
  return hints.length > 0 ? hints : ["可用于回答该事务在时间线、参与方、邮件内容和附件上的连续变化"];
}

function entityNarrativeChildren(item) {
  const children = [];
  const entries = Object.entries(item.businessEntities || {}).filter(([, values]) => (values || []).length > 0);
  if (entries.length === 0) {
    return [paragraph("未抽取到稳定业务实体。")];
  }
  for (const [key, values] of entries) {
    children.push(bullet(`${ENTITY_LABELS[key] || key}：${readableValues(values)}`));
  }
  return children;
}

function attachmentNarrativeChildren(item) {
  if ((item.attachmentTitles || []).length === 0 && (item.attachmentHashes || []).length === 0) {
    return [paragraph("未发现可稳定引用的 DOCX/PDF/PPT/XLS/文本附件或归一化文档引用。")];
  }
  return [
    paragraph(`附件/归一化文档标题：${readableValues(item.attachmentTitles)}`),
    paragraph(`附件/归一化文档哈希：${readableValues(item.attachmentHashes)}`)
  ];
}

function messageKnowledgeChildren(messages = []) {
  if (messages.length === 0) {
    return [paragraph("该事务没有可输出的邮件明细。")];
  }
  const children = [];
  for (const [index, message] of messages.entries()) {
    children.push(
      heading(`${index + 1}. ${displayDateTime(message.sentAt)}｜${message.subject}`, HeadingLevel.HEADING_3),
      paragraph(`发件人：${message.from || "未知"}。收件人：${readableValues(message.recipients, "未记录")}`),
      paragraph(`动作：${actionLabel(message.actionCategory)}。来源文件：${message.filePath || "未记录"}`)
    );
    const body = scalar(message.bodyText || message.bodyPreview);
    if (body) {
      const excerpt =
        body.length > MAX_HUMAN_MESSAGE_BODY_TEXT
          ? `${body.slice(0, MAX_HUMAN_MESSAGE_BODY_TEXT)}...`
          : body;
      children.push(paragraph(`正文整理：${excerpt}`));
    }
    const attachmentTitles = uniqueStrings((message.attachmentRefs || []).map((item) => item.title), 8);
    if (attachmentTitles.length > 0) {
      children.push(paragraph(`附件引用：${attachmentTitles.join("、")}`));
    }
  }
  return children;
}

function transactionOverviewPayload(item) {
  return {
    schemaVersion: "v0.0.1:transaction:transaction-overview-1",
    lineageId: item.lineageId,
    title: item.title,
    source: {
      senderOrg: item.senderOrg || "",
      listIds: item.listIds || [],
      sourceLabel: item.attention?.sourceLabel || "",
      sourceType: item.attention?.sourceType || ""
    },
    attentionMatrix: {
      title: item.attention?.title || item.title,
      sourceBehaviorTitle: item.attention?.sourceBehaviorTitle || "",
      actorBehaviorTitle: item.attention?.actorBehaviorTitle || "",
      sourceLabel: item.attention?.sourceLabel || "",
      actorLabel: item.attention?.actorLabel || "",
      behaviorId: item.attention?.behaviorId || "",
      behaviorLabel: item.attention?.behaviorLabel || "",
      keys: item.attention?.keys || []
    },
    classification: {
      category: item.category,
      categoryLabel: categoryLabel(item.category),
      cadence: item.cadence || "irregular",
      primaryAction: item.actionCategory,
      actionLabels: (item.actionCategories || []).map(actionLabel)
    },
    timeRange: {
      firstSeenAt: item.firstSeenAt,
      lastSeenAt: item.lastSeenAt
    },
    occurrence: {
      emailCount: item.occurrenceCount,
      messageCountInDocument: (item.messages || []).length
    },
    intentHints: transactionIntentHints(item),
    businessEntities: item.businessEntities || {},
    attachments: {
      titles: item.attachmentTitles || [],
      hashes: item.attachmentHashes || []
    }
  };
}

function transactionMachinePayload(item) {
  return {
    schemaVersion: "v0.0.1:knowledge:transaction-knowledge-2",
    overview: transactionOverviewPayload(item),
    transaction: {
      lineageId: item.lineageId,
      title: item.title,
      senderOrg: item.senderOrg,
      category: item.category,
      categoryLabel: categoryLabel(item.category),
      cadence: item.cadence,
      occurrenceCount: item.occurrenceCount,
      firstSeenAt: item.firstSeenAt,
      lastSeenAt: item.lastSeenAt,
      actionCategory: item.actionCategory,
      actionCategories: item.actionCategories,
      intentHints: transactionIntentHints(item)
    },
    businessEntities: item.businessEntities || {},
    attachments: {
      titles: item.attachmentTitles || [],
      hashes: item.attachmentHashes || []
    },
    messages: (item.messages || []).map((message, index) => ({
      sequence: index + 1,
      sentAt: message.sentAt,
      subject: message.subject,
      from: message.from,
      recipients: message.recipients || [],
      messageId: message.messageId,
      sourcePath: message.filePath,
      category: message.category,
      actionCategory: message.actionCategory,
      businessEntities: message.businessEntities || {},
      attachmentRefs: message.attachmentRefs || [],
      bodyText: message.bodyText || "",
      bodyTextTruncated: Boolean(message.bodyTextTruncated)
    })),
    continuityDiagnostics: {
      subjectTemplates: item.subjectTemplates || [],
      subjectTokens: item.subjectTokens || [],
      listIds: item.listIds || [],
      participantGraphs: item.participantGraphs || [],
      strongBusinessKeys: item.strongBusinessKeys || [],
      weakBusinessKeys: item.weakBusinessKeys || []
    }
  };
}

function transactionDocChildren(item, payload) {
  return [
    heading(item.title),
    heading("事务概览 YAML", HeadingLevel.HEADING_2),
    ...yamlBlock(transactionOverviewPayload(item)),
    heading("这个文档可支持的召回问题", HeadingLevel.HEADING_2),
    ...transactionIntentHints(item).map(bullet),
    heading("关键业务事实", HeadingLevel.HEADING_2),
    ...entityNarrativeChildren(item),
    heading("附件与归一化材料", HeadingLevel.HEADING_2),
    ...attachmentNarrativeChildren(item),
    heading("事务发展时间线与邮件内容", HeadingLevel.HEADING_2),
    ...messageKnowledgeChildren(item.messages || []),
    heading("附录 A：机器可读 JSON", HeadingLevel.HEADING_2),
    paragraph("以下 JSON 用于智能体、HTTP payload 或知识库解析；接续依据和算法特征只放在此附录中。"),
    ...jsonBlock(payload)
  ];
}

async function writeArtifacts({ outputPath, roots, lineages, stats, maxDocs = DEFAULT_MAX_DOCS }) {
  await fs.mkdir(outputPath, { recursive: true });
  const transactionDir = path.join(outputPath, "transactions");
  const transactionJsonDir = path.join(outputPath, "transactions-json");
  await fs.rm(transactionDir, { recursive: true, force: true });
  await fs.rm(transactionJsonDir, { recursive: true, force: true });
  await fs.mkdir(transactionDir, { recursive: true });
  await fs.mkdir(transactionJsonDir, { recursive: true });
  const summaries = [...lineages.values()]
    .map(transactionSummary)
    .sort((left, right) => {
      if (right.occurrenceCount !== left.occurrenceCount) {
        return right.occurrenceCount - left.occurrenceCount;
      }
      return String(right.lastSeenAt).localeCompare(String(left.lastSeenAt));
    });
  const recurring = summaries.filter((item) => item.occurrenceCount >= 2);
  const manifest = {
    schemaVersion: "v0.0.1:schema:definition-1",
    generatedAt: new Date().toISOString(),
    roots,
    outputPath,
    model: {
      type: "pure-algorithmic-continuity",
      features: [
        "business entity extraction for project names, ids, money, customers, suppliers, contracts, systems, locations and versions",
        "transaction fingerprint from participant graph, business entities, action category, time bucket and semantic subject tokens",
        "multi-stage scoring with strong business ids first, weak topic and participant graph second, time window fallback last",
        "negative sample guards for marketing, orders, statements and security alerts",
        "local lineage review that can split, merge and migrate historical assignments",
        "attachment filename/title/hash references fed back into transaction features",
        "sender organization and sender role",
        "List-ID / campaign headers",
        "normalized subject template without dates, counters or ids",
        "subject token and character-shingle similarity",
        "generic category and cadence hints",
        "recipient overlap and temporal compatibility"
      ],
      noExternalAgent: true
    },
    stats: {
      ...stats,
      transactionCount: summaries.length,
      recurringTransactionCount: recurring.length
    },
    files: {
      transactionsJson: "transactions.json",
      transactionsCsv: "transactions.csv",
      overviewDocx: "transaction-overview.docx",
      transactionDocDirectory: "transactions",
      transactionJsonDirectory: "transactions-json"
    }
  };
  await writeJson(path.join(outputPath, "manifest.json"), manifest);
  await writeJson(path.join(outputPath, "transactions.json"), summaries);
  const csvRows = [
    [
      "lineageId",
      "title",
      "senderOrg",
      "category",
      "cadence",
      "occurrenceCount",
      "firstSeenAt",
      "lastSeenAt",
      "subjectTokens",
      "listIds",
      "actionCategory",
      "strongBusinessKeys",
      "attachmentTitles"
    ],
    ...summaries.map((item) => [
      item.lineageId,
      item.title,
      item.senderOrg,
      item.category,
      item.cadence,
      item.occurrenceCount,
      item.firstSeenAt,
      item.lastSeenAt,
      item.subjectTokens.join(" "),
      item.listIds.join(" "),
      item.actionCategory,
      item.strongBusinessKeys.join(" "),
      item.attachmentTitles.join(" ")
    ])
  ];
  await fs.writeFile(
    path.join(outputPath, "transactions.csv"),
    csvRows.map((row) => row.map(csvEscape).join(",")).join("\n"),
    "utf8"
  );

  const overviewChildren = [
    heading("Pact 事务接续模型总览"),
    heading("运行摘要", HeadingLevel.HEADING_2),
    tableFromRows([
      ["扫描根目录", roots.join("\n")],
      ["扫描 EML 文件", String(stats.scannedFiles)],
      ["新增 / 更新解析", String(stats.processedFiles)],
      ["复用索引文件", String(stats.skippedUnchanged)],
      ["解析失败", String(stats.failedFiles)],
      ["事务总数", String(summaries.length)],
      ["连续事务数", String(recurring.length)]
    ]),
    heading("算法说明", HeadingLevel.HEADING_2),
    paragraph("本产物由纯算法模型生成，不调用外部智能体，不使用来源硬编码。每个事务 DOCX 的正文优先面向人类和知识库召回，算法接续依据放在附录 JSON 中。"),
    heading("高频连续事务", HeadingLevel.HEADING_2),
    tableFromRows([
      ["事务ID", "标题", "来源", "类别", "节奏", "数量", "时间范围"],
      ...recurring.slice(0, 40).map((item) => [
        item.lineageId,
        item.title,
        item.senderOrg,
        item.category,
        item.cadence,
        String(item.occurrenceCount),
        `${item.firstSeenAt.slice(0, 10)} - ${item.lastSeenAt.slice(0, 10)}`
      ])
    ])
  ];
  await writeDocx(path.join(outputPath, "transaction-overview.docx"), overviewChildren);

  const selected = recurring.slice(0, maxDocs);
  for (const [index, item] of selected.entries()) {
    const baseName = `${String(index + 1).padStart(3, "0")}-${slug(item.title, "transaction")}`;
    const payload = transactionMachinePayload(item);
    await writeJson(path.join(transactionJsonDir, `${baseName}.json`), payload);
    await writeDocx(path.join(transactionDir, `${baseName}.docx`), transactionDocChildren(item, payload));
  }

  return {
    manifest,
    summaries,
    generatedDocCount: selected.length + 1
  };
}

export async function buildTransactionContinuityModel({
  roots,
  outputPath = DEFAULT_OUTPUT_DIR,
  limit = 0,
  rebuild = false,
  maxReadBytes = DEFAULT_MAX_READ_BYTES,
  maxDocs = DEFAULT_MAX_DOCS,
  reviewEvery = DEFAULT_REVIEW_EVERY,
  reviewDaily = true,
  forceReview = false,
  normalizedManifestPaths = []
}) {
  const absoluteOutput = path.resolve(outputPath);
  await fs.mkdir(absoluteOutput, { recursive: true });
  const dbPath = path.join(absoluteOutput, "continuity-index.sqlite");
  const db = new Database(dbPath);
  initializeContinuityDb(db);
  if (rebuild) {
    db.exec("DELETE FROM continuity_files; DELETE FROM continuity_lineages; DELETE FROM continuity_meta;");
  }
  let state = loadState(db);
  const upsertFile = upsertFileStmt(db);
  const replaceLineage = replaceLineageStmt(db);
  const rootPaths = roots.map((item) => path.resolve(item));
  const normalizedRefsByName = await loadNormalizedAttachmentRefs(
    Array.isArray(normalizedManifestPaths) ? normalizedManifestPaths : [normalizedManifestPaths]
  );
  const deferAssignmentUntilReview = Boolean(rebuild || forceReview);
  const stats = {
    scannedFiles: 0,
    processedFiles: 0,
    skippedUnchanged: 0,
    failedFiles: 0,
    reviewExecuted: false,
    reviewInputCount: 0,
    reviewTransactionCount: 0,
    reviewMigratedFiles: 0,
    startedAt: new Date().toISOString(),
    finishedAt: ""
  };

  for (const rootPath of rootPaths) {
    const files = await walkEmlFiles(rootPath, { limit: limit > 0 ? Math.max(0, limit - stats.scannedFiles) : 0 });
    for (const filePath of files) {
      stats.scannedFiles += 1;
      let fileStats;
      try {
        fileStats = await fs.stat(filePath);
        if (!rebuild && fileUnchanged(db, filePath, fileStats)) {
          stats.skippedUnchanged += 1;
          continue;
        }
        const email = await parseEmlFile(filePath, rootPath, { maxReadBytes, normalizedRefsByName });
        const assignment = deferAssignmentUntilReview
          ? {
              lineageId: "",
              score: 0,
              reasons: ["pending-review"]
            }
          : assignEmail(email, state);
        upsertFile.run(
          filePath,
          rootPath,
          email.relativePath,
          email.mtimeMs,
          email.byteSize,
          email.fileFingerprint,
          email.messageId,
          assignment.lineageId,
          assignment.score,
          JSON.stringify(assignment.reasons),
          JSON.stringify(email),
          new Date().toISOString()
        );
        stats.processedFiles += 1;
      } catch (error) {
        stats.failedFiles += 1;
      }
      if (limit > 0 && stats.scannedFiles >= limit) {
        break;
      }
    }
    if (limit > 0 && stats.scannedFiles >= limit) {
      break;
    }
  }

  if (
    shouldRunReview(db, stats, {
      rebuild,
      reviewEvery: Math.max(0, Number(reviewEvery || 0)),
      reviewDaily,
      forceReview
    })
  ) {
    const parsedEmails = loadParsedEmails(db);
    const previousAssignments = new Map(
      db.prepare("SELECT file_path, lineage_id FROM continuity_files").all().map((row) => [
        row.file_path,
        row.lineage_id
      ])
    );
    const review = rebuildStateFromEmails(parsedEmails);
    const nextAssignments = new Map(
      review.assignments.map((item) => [item.filePath, item.assignment.lineageId])
    );
    stats.reviewExecuted = true;
    stats.reviewInputCount = parsedEmails.length;
    stats.reviewTransactionCount = review.state.lineages.size;
    stats.reviewMigratedFiles = [...nextAssignments.entries()].filter(
      ([filePath, lineageId]) => previousAssignments.get(filePath) !== lineageId
    ).length;
    applyReviewAssignments(db, review.assignments);
    state = review.state;
    setMetaValue(db, "last_review_date", new Date().toISOString().slice(0, 10));
    setMetaValue(db, "last_review_at", new Date().toISOString());
  }

  const replaceMany = db.transaction((lineages) => {
    const now = new Date().toISOString();
    for (const lineage of lineages) {
      const view = lineageView(lineage);
      replaceLineage.run(
        lineage.lineageId,
        view.title,
        view.senderOrg,
        view.category,
        view.cadence,
        view.firstSeenAt,
        view.lastSeenAt,
        view.occurrenceCount,
        JSON.stringify(lineage),
        now
      );
    }
  });
  replaceMany([...state.lineages.values()]);
  stats.finishedAt = new Date().toISOString();
  const artifacts = await writeArtifacts({
    outputPath: absoluteOutput,
    roots: rootPaths,
    lineages: state.lineages,
    stats,
    maxDocs
  });
  db.close();
  return {
    outputPath: absoluteOutput,
    dbPath,
    ...artifacts
  };
}

export const transactionContinuityDefaults = {
  outputPath: DEFAULT_OUTPUT_DIR,
  maxReadBytes: DEFAULT_MAX_READ_BYTES,
  maxDocs: DEFAULT_MAX_DOCS,
  reviewEvery: DEFAULT_REVIEW_EVERY
};
