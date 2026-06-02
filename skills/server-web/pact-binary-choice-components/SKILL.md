---
name: pact-binary-choice-components
description: Use when implementing or reviewing Pact UI controls for boolean choices, including BinaryCheckbox for independent boolean options and Binary Toggle for two-state capsule switches.
metadata:
  short-description: Pact binary choice UI components
---

# Pact Binary Choice Components

Use this skill when a Pact page needs a reusable boolean control instead of ad hoc checkbox markup.

## Component Choice

- Use `BinaryCheckbox` for independent boolean options such as “仅关键词”, “启用学习”, “返回解释”.
- Use `Binary Toggle` for a capsule-shaped two-state switch where the user chooses between two visible states, such as “规则 / 智能体” or “本地 / 服务端”.
- Do not call a rectangular checkbox-style control a Toggle. Toggle means pill/capsule two-state control in this design language.

## BinaryCheckbox Rules

- Outer container is a rectangular button-like control with content-width sizing.
- Visual style should stay close to Pact inline directory options such as “自动监听变化 / 包含子目录 / 自动下载”: compact, readable, and not dominated by a filled container.
- Width and height should both wrap the content. Do not set a fixed height or `min-height`; use vertical padding around the icon and label.
- Minimum width must naturally be at least: text width + one-character spacer + icon width + container padding.
- The container owns padding. Inner icon and label do not add padding.
- Place a fixed spacer element between icon and text; use `width: 1em`.
- Prefer a light outer border and transparent background. Put the strong checked state on the small square icon, not the whole container.
- Default outer border should be transparent to avoid visual clutter; reserve the same border width so layout does not shift. Show a light blue outer border only on hover/focus.
- On hover/focus, the whole container may shift to a very light blue surface, but the effect must stay inside the border. Do not use an outside glow/shadow.
- Unchecked default text should be black. Hover/focus temporarily turns the label blue. Checked state keeps the label blue until the user clicks again to uncheck, then it returns to black.
- Props should stay minimal: `modelValue`, `label`, optional `disabled`.
- Events should be standard Vue bindings: `update:modelValue` and optional `change`.
- Use accessible state: `role="checkbox"` plus `aria-checked`.
- Keep visual state deterministic: checked shows the check icon; unchecked reserves the same icon space.

## Required Visual Contract

Use these values unless the local design system already defines equivalent tokens:

- Icon square: `16px × 16px`, `flex: 0 0 16px`, 4px radius.
- Check glyph: 12px SVG path, invisible when unchecked, visible when checked.
- Spacer: an actual element with `width: 1em`; do not replace with child padding.
- Container: `inline-flex`, `width: fit-content`, `min-width: max-content`, `padding: 7px 10px`, `border: 1px solid transparent`, `border-radius: 8px`, `background: transparent`.
- Text: black in unchecked default, brand blue when checked or hovered.
- Hover/focus: border `rgba(37, 99, 235, 0.32)`, background `#eff6ff`, optional inset-only color overlay. No outer shadow.
- Checked icon: brand-blue square with white check mark.

State behavior:

| State | Container | Text | Icon |
| --- | --- | --- | --- |
| unchecked | transparent border/background | black | empty square |
| unchecked hover | light-blue border/background inside bounds | blue | empty square |
| checked | transparent outer border/background | blue | blue square + white check |
| checked hover | light-blue border/background inside bounds | blue | blue square + white check |

## Binary Toggle Rules

- Use a capsule body, not a rectangle.
- It represents one value selected from two states, not an independent checkbox.
- Both states should be visible or semantically obvious.
- The active state should be visually filled or highlighted; inactive state remains readable.
- API should accept labels and a bound value/action, not hard-coded option text.

## Why This Exists

This avoids one-off checkbox styling in debug/configuration pages. The same semantic control can be reused by humans and future agents without guessing spacing, naming, accessibility, or visual behavior.

## Migration Rule

Replace plain, independent `<input type="checkbox">` controls with `BinaryCheckbox` when they represent a simple boolean option. Do not replace capsule toggles or rich row controls that have their own two-state visual system.

Vue example:

```vue
<BinaryCheckbox
  v-model="form.learningEnabled"
  label="启用学习"
/>
```

Minimal implementation shape:

```vue
<button
  class="binary-checkbox"
  type="button"
  role="checkbox"
  :aria-checked="modelValue"
  :data-checked="modelValue"
  @click="emit('update:modelValue', !modelValue)"
>
  <span class="binary-checkbox-icon" aria-hidden="true">...</span>
  <span class="binary-checkbox-spacer" aria-hidden="true"></span>
  <span class="binary-checkbox-label">{{ label }}</span>
</button>
```
