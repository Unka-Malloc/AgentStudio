# server/protocols/pubsub

本目录实现服务端向下游发布内容的统一发布-订阅协议。

## 模型

服务端是上游发布者，下游客户端、控制台和工具调用方是订阅者。上游不要求下游轮询每一个资源接口，而是把可观察内容发布成 topic event。

事件格式：

```json
{
  "schemaVersion": "v0.0.1:schema:definition-1",
  "offset": 1,
  "id": "uuid",
  "topic": "jobs.job",
  "type": "jobs.job.updated",
  "publisher": "server",
  "publishedAt": "iso-8601",
  "payload": {}
}
```

订阅接口：

```http
GET /api/events?cursor=0&topic=jobs.job&timeoutMs=10000&includeSnapshot=1
accept: application/json
```

响应：

```json
{
  "cursor": 0,
  "nextCursor": 3,
  "topics": ["jobs.job"],
  "events": [],
  "snapshots": []
}
```

`cursor` 是全局事件 offset。下游处理完响应后，用 `nextCursor` 继续订阅。

客户端恢复要求：

- 下游必须把 `nextCursor` 持久化到本地状态，而不是只保存在内存中。
- 服务端不可达时，下游保持本地缓存和最后游标不变；服务端恢复后继续用该游标订阅。
- `client-cli` 的 `server.events.sync` 会把 `/api/events` 结果写入客户端本地事件日志，用于 GUI 恢复、审计和离线展示。

## Retained Snapshot

每个 topic 默认保留最后一次发布事件。新订阅者可以使用 `includeSnapshot=1` 获取当前 retained event，不需要先访问一组独立 GET 接口拼出初始状态。

## 当前 Topic

- `server.lifecycle`
- `system.interfaces`
- `system.console_state`
- `discovery.config`
- `discovery.clients`
- `runtime.mounts`
- `settings.current`
- `email_rules.current`
- `expert_vocabulary.current`
- `uploads.session`
- `jobs.job`
- `jobs.deleted`
- `storage.summary`
- `knowledge.changes`
- `knowledge.review_items`
- `tool_management.grants`
- `agent_sync.config`
- `agent.sync.*`

## 实现

- `event-bus.mjs`：持久事件日志、retained snapshot 和长轮询订阅。
- 事件数据写入服务端 `userDataPath/protocol-events/`，不写入源码目录。
