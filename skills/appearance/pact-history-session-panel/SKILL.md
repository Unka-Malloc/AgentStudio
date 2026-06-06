---
name: pact-history-session-panel
description: Use when implementing or reviewing Pact collapsible history/session lists with selectable records and delete actions, such as 信息流历史记录 or 智能体检索历史会话.
metadata:
  short-description: Pact history session panel
---

# Pact History Session Panel

Use this skill when a page needs a reusable “历史会话 / 历史记录” component. Do not rebuild history lists with one-off `<details>` and delete buttons.

## Purpose

The component standardizes collapsible history UI so future agents do not independently invent spacing, delete affordances, active states, scroll behavior, or summary headers.

## Data Contract

Map business objects into simple item records before passing them to the component:

```ts
type HistorySessionPanelItem = {
  id: string;
  title: string;
  meta?: string;
  preview?: string;
  active?: boolean;
  disabled?: boolean;
  deleteLabel?: string;
};
```

The component should emit:

- `select(id)` when the main row is clicked.
- `delete(id)` when the trash button is clicked.

The component must not know about business types such as `InfoFeedRunState` or `AgentExploreSession`.

## Visual Contract

- Root is a collapsible `details` panel.
- Header uses `summary` with a small triangle indicator.
- Closed state has a subtle light-blue surface so users can recognize it is clickable.
- Open state shows a scrollable list with max height around three visible rows plus overflow.
- Each row is a white card with:
  - title
  - meta line
  - optional preview line
  - delete button in the top-right corner
- Active row uses brand-blue border and light-blue background.
- Delete button uses a trash icon; hover is red and contained inside the button.
- Text must truncate with ellipsis and not reflow the row height.

## Interaction Rules

- Click row: select/open that history item.
- Click trash: delete that history item; it must not select the row.
- Disabled rows can show loading/wait state and must not emit actions.
- The component may be collapsed by default unless the page has a reason to keep it open.

## Vue Shape

```vue
<HistorySessionPanel
  title="历史会话"
  :subtitle="`${items.length} 条，滚动查看`"
  :items="items"
  @select="openHistoryItem"
  @delete="deleteHistoryItem"
/>
```

## Migration Rule

Replace repeated history list markup with this component when the UI is a selectable/deletable history list. Do not use it for browser-like tab strips, tool traces, audit tables, or logs.
