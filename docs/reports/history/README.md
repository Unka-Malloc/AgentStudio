# History Reports Archive

本目录只保存历史审计、阶段计划、临时进度、生产 readiness run 输出和旧任务总结。这里的文档不再作为当前架构、协议、权限、客户端支持目标或生产状态的事实源。

当前事实源按下面顺序读取：

1. `docs/Architecture.md`
2. `docs/PROTOCOLS.md`
3. `docs/WORKSPACE-ASSET-GOVERNANCE.md`
4. `docs/KNOWLEDGE-GOVERNANCE.md`
5. `docs/PRODUCTION-CAPABILITY-GAP.md`
6. `docs/IMPLEMENTATION-DECISION-REGISTER.md`
7. `docs/reports/ORDERED-IMPLEMENTATION-TASKS-2026-06-03.md`
8. `docs/reports/SECURITY-HARDENING-BACKLOG-2026-06-03.md`

2026-06-03 已归档的决策过程文档：

- `HISTORY-SYNTHESIS-DECISION-QUEUE-2026-06-03.md`
- `OPEN-DECISION-CHECKLIST-2026-06-03.md`
- `P1-DECISION-EXPLANATION-2026-06-03.md`
- `P2-DECISION-EXPLANATION-2026-06-03.md`
- `REMAINING-DECISION-EXPLANATION-2026-06-03.md`

归档规则：

- 不重写历史正文，避免破坏当时的审计证据和上下文。
- 如果历史正文与当前核心文档冲突，以核心文档和决策登记为准。
- 旧 MCP 工具名、旧 Workspace API 路径、旧客户端支持目标、旧 readiness 结论和旧 checklist 完成度，只能作为当时状态参考，不能直接复用到新实现或新文档。
- 新增实现前，应先查核心文档和当前 verifier，而不是从本目录复制旧口径。
