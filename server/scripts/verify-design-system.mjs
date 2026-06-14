#!/usr/bin/env node
/**
 * Design System Verification Gate
 *
 * Validates that the appearance preset design system is maintained:
 * 1. No hardcoded colors in component CSS (outside tokens/themes)
 * 2. No forbidden visual patterns (blur, radial-gradient, glassmorphism)
 * 3. All component CSS references use var(--*) tokens
 * 4. Appearance preset config files are valid and the active preset is usable
 *
 * Run: npm run server:verify:design-system
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const stylesDir = path.join(repoRoot, "server-web/styles");
const appearancePresetsCssPath = path.join(stylesDir, "themes/appearance-presets.css");
const appearancePresetsDir = path.join(repoRoot, "server-web/appearance-presets");
const appearancePresetFacadePath = path.join(repoRoot, "server-web/composables/console-shell-preference-effects.ts");

const EXEMPT_DIRS = ["themes"];
const EXEMPT_FILES = ["tokens.css", "reset.css"];

// Forbidden patterns in component CSS
const FORBIDDEN_PATTERNS = [
  { pattern: /backdrop-filter\s*:/g, name: "backdrop-filter (blur effects)" },
  { pattern: /radial-gradient\(/g, name: "radial-gradient (decorative glows)" },
];

// Detect hardcoded colors (hex not in var(), rgba with non-black/white channels)
const HARDCODED_HEX = /#[0-9a-fA-F]{6}\b/g;
const HARDCODED_RGBA_COLOR = /rgba\(\s*(?!0\s*,\s*0\s*,\s*0)(?!255\s*,\s*255\s*,\s*255)\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}/g;

const REQUIRED_CONFIG_TOKENS = [
  "bg-base",
  "bg-surface",
  "bg-subtle",
  "text-primary",
  "text-muted",
  "text-on-brand",
  "brand",
  "brand-strong",
  "brand-subtle",
  "success",
  "warning",
  "danger",
];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const CONFIG_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

// Lines that are allowed to have hex (inside var definitions or comments)
function isTokenDefinition(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("--") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("//");
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16) / 255,
    g: Number.parseInt(value.slice(2, 4), 16) / 255,
    b: Number.parseInt(value.slice(4, 6), 16) / 255,
  };
}

function channelToLinear(channel) {
  return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

function contrastRatio(background, foreground) {
  const first = relativeLuminance(background);
  const second = relativeLuminance(foreground);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function validatePresetConfig(config, sourceLabel) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [`${sourceLabel}: config must be a JSON object`];
  }
  if (config.schemaVersion !== "v0.0.1:schema:definition-1") errors.push(`${sourceLabel}: schemaVersion must be v0.0.1:schema:definition-1`);
  if (typeof config.id !== "string" || !CONFIG_ID.test(config.id)) {
    errors.push(`${sourceLabel}: id must be kebab-case and 2-64 characters`);
  }
  if (!config.label || typeof config.label.en !== "string" || typeof config.label["zh-CN"] !== "string") {
    errors.push(`${sourceLabel}: label.en and label.zh-CN are required`);
  }
  if (!["system", "light", "dark"].includes(config.mode)) {
    errors.push(`${sourceLabel}: mode must be system, light, or dark`);
  }
  if (config.mode === "system") {
    if (typeof config.lightPresetId !== "string" || typeof config.darkPresetId !== "string") {
      errors.push(`${sourceLabel}: system presets require lightPresetId and darkPresetId`);
    }
  } else {
    if (!config.tokens || typeof config.tokens !== "object" || Array.isArray(config.tokens)) {
      errors.push(`${sourceLabel}: fixed presets require tokens`);
    } else {
      for (const token of REQUIRED_CONFIG_TOKENS) {
        if (typeof config.tokens[token] !== "string" || !HEX_COLOR.test(config.tokens[token])) {
          errors.push(`${sourceLabel}: tokens.${token} must be a 6-digit hex color`);
        }
      }
    }
  }
  return errors;
}

async function readPresetConfigs(violations) {
  const configs = [];
  const entries = await fs.readdir(appearancePresetsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const filePath = path.join(appearancePresetsDir, entry.name);
    const rel = path.relative(repoRoot, filePath);
    try {
      const config = JSON.parse(await fs.readFile(filePath, "utf8"));
      for (const error of validatePresetConfig(config, rel)) {
        violations.push({ file: rel, line: 1, rule: "Invalid appearance preset config", snippet: error });
      }
      configs.push(config);
    } catch (error) {
      violations.push({ file: rel, line: 1, rule: "Invalid appearance preset JSON", snippet: error.message });
    }
  }
  if (process.env.PACT_VERIFY_APPEARANCE_PRESET_FILE) {
    const filePath = path.resolve(repoRoot, process.env.PACT_VERIFY_APPEARANCE_PRESET_FILE);
    const rel = path.relative(repoRoot, filePath);
    try {
      const config = JSON.parse(await fs.readFile(filePath, "utf8"));
      for (const error of validatePresetConfig(config, rel)) {
        violations.push({ file: rel, line: 1, rule: "Invalid external appearance preset config", snippet: error });
      }
      configs.push(config);
    } catch (error) {
      violations.push({ file: rel, line: 1, rule: "Invalid external appearance preset JSON", snippet: error.message });
    }
  }
  return configs;
}

function findConfig(configs, id) {
  return configs.find((config) => config.id === id);
}

function activeFixedConfigs(configs, id, violations) {
  const selected = findConfig(configs, id);
  if (!selected) {
    violations.push({ file: "server-web/appearance-presets", line: 1, rule: "Missing active appearance preset", snippet: id });
    return [];
  }
  if (selected.mode === "system") {
    return [selected.lightPresetId, selected.darkPresetId].flatMap((targetId) => activeFixedConfigs(configs, targetId, violations));
  }
  return [selected];
}

async function collectCssFiles(dir) {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXEMPT_DIRS.includes(entry.name)) continue;
      results.push(...(await collectCssFiles(fullPath)));
    } else if (entry.name.endsWith(".css") && !EXEMPT_FILES.includes(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

async function run() {
  const cssFiles = await collectCssFiles(stylesDir);
  const violations = [];
  let totalFiles = 0;
  let cleanFiles = 0;

  const appearancePresetFacade = await fs.readFile(appearancePresetFacadePath, "utf8");
  const appearancePresetsCss = await fs.readFile(appearancePresetsCssPath, "utf8");
  const appearancePresetConfigs = await readPresetConfigs(violations);
  const activePresetId = process.env.PACT_VERIFY_APPEARANCE_PRESET_ID || "default-system";
  for (const config of activeFixedConfigs(appearancePresetConfigs, activePresetId, violations)) {
    const ratio = contrastRatio(config.tokens.brand, config.tokens["text-on-brand"]);
    if (ratio < 4.5) {
      violations.push({
        file: path.relative(repoRoot, path.join(appearancePresetsDir, `${config.id}.json`)),
        line: 1,
        rule: `Insufficient primary button contrast for active preset ${config.id}`,
        snippet: `${config.tokens.brand} / ${config.tokens["text-on-brand"]} = ${ratio.toFixed(2)}:1`,
      });
    }
  }
  if (!appearancePresetsCss.includes("--el-color-primary: var(--brand);")) {
    violations.push({
      file: path.relative(repoRoot, appearancePresetsCssPath),
      line: 1,
      rule: "Missing Element Plus appearance preset mapping",
      snippet: "--el-color-primary: var(--brand);",
    });
  }

  for (const legacyMapping of [
    { pattern: /value\s*===\s*"system"[\s\S]*?return\s+"default-system"/, snippet: 'system -> default-system' },
    { pattern: /value\s*===\s*"light"[\s\S]*?return\s+DEFAULT_LIGHT_APPEARANCE_PRESET_ID/, snippet: 'light -> default light preset' },
    { pattern: /value\s*===\s*"dark"[\s\S]*?return\s+DEFAULT_DARK_APPEARANCE_PRESET_ID/, snippet: 'dark -> default dark preset' },
  ]) {
    if (!legacyMapping.pattern.test(appearancePresetFacade)) {
      violations.push({
        file: path.relative(repoRoot, appearancePresetFacadePath),
        line: 1,
        rule: "Missing legacy pact-theme migration",
        snippet: legacyMapping.snippet,
      });
    }
  }
  if (!appearancePresetFacade.includes('const APPEARANCE_PRESET_KEY = "pact-appearance-preset";')) {
    violations.push({
      file: path.relative(repoRoot, appearancePresetFacadePath),
      line: 1,
      rule: "Missing localStorage appearance preset key",
      snippet: 'pact-appearance-preset',
    });
  }

  for (const filePath of cssFiles) {
    totalFiles++;
    const content = await fs.readFile(filePath, "utf8");
    const lines = content.split("\n");
    const rel = path.relative(repoRoot, filePath);
    let fileClean = true;

    // Check forbidden patterns
    for (const { pattern, name } of FORBIDDEN_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const lineNum = content.substring(0, match.index).split("\n").length;
        violations.push({ file: rel, line: lineNum, rule: `Forbidden: ${name}`, snippet: lines[lineNum - 1]?.trim() });
        fileClean = false;
      }
    }

    // Check hardcoded hex colors in property values (not in variable declarations)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isTokenDefinition(line)) continue;
      // Skip lines that are inside @media or :root blocks defining variables
      if (line.includes("var(--")) continue;

      const hexMatches = line.match(HARDCODED_HEX);
      if (hexMatches) {
        // Allow #fff / #000 patterns and text-on-brand #fffdf8
        const nonTrivial = hexMatches.filter(h => !["#ffffff", "#000000", "#fffdf8"].includes(h.toLowerCase()));
        if (nonTrivial.length > 0) {
          violations.push({ file: rel, line: i + 1, rule: "Hardcoded hex color", snippet: line.trim() });
          fileClean = false;
        }
      }

      // Check colored rgba (skip pure black/white transparency)
      HARDCODED_RGBA_COLOR.lastIndex = 0;
      if (HARDCODED_RGBA_COLOR.test(line) && !line.includes("var(--")) {
        violations.push({ file: rel, line: i + 1, rule: "Hardcoded rgba color", snippet: line.trim() });
        fileClean = false;
      }
    }

    if (fileClean) cleanFiles++;
  }

  // Report
  if (violations.length === 0) {
    console.log(`design-system gate: PASS (${cleanFiles}/${totalFiles} files clean)`);
    process.exit(0);
  } else {
    console.error(`design-system gate: FAIL (${violations.length} violations in ${totalFiles - cleanFiles} files)\n`);
    for (const v of violations.slice(0, 30)) {
      console.error(`  ${v.file}:${v.line} — ${v.rule}`);
      if (v.snippet) console.error(`    > ${v.snippet.substring(0, 100)}`);
    }
    if (violations.length > 30) {
      console.error(`  ... and ${violations.length - 30} more`);
    }
    process.exit(1);
  }
}

run();
