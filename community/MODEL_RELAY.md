# 社区中转模型

管理页面：`https://nstrans.221129.xyz/dashboard/relay`。客户端只显示“社区中转模型”，
不接收型号清单、不提交型号。服务器按请求用途选择上游模型，管理员在网页管理平台、密钥和模型。
客户端原有的自有阿里百炼 Key / 自定义模型与本机翻译仍独立保留。

## 配置

迁移 `0010_community_model_relay.sql` 保留已有用户额度、分配记录和历史用量，
重命名相关表为 `model_relay_*`，清除旧千问密钥与选型并关闭服务。
管理员需重新填写 Google AI Studio Key，设置路由、点数、并发后启用。
旧 `/api/v1/qwen*`、`/api/admin/qwen/*` 接口已移除，不再转发千问套餐。
现有发布包没有新接口，需要重新构建客户端；本次未发布安装包。

迁移 `0011_relay_credentials.sql` 将已配置的 Google Key 和 Gemini 模型纳入统一管理，保留启用状态、路由和点数。
支持 Google Gemini、阿里百炼（北京普通 API，非 Token Plan）、DeepSeek。先添加命名密钥，
再选择平台、密钥、官方目录中的模型；均可编辑和删除，使用中的密钥禁止删除。
添加模型支持在目录中输入关键词过滤、多选并一次保存；相同平台和密钥下的重复型号会跳过，编辑仍针对单个条目。
阿里百炼密钥需要业务空间 ID。目录只代表平台目录，不保证账号开通或有余额。

官方模型目录：

- [Google](https://ai.google.dev/api/models)：`GET /v1beta/models`，支持分页；目前明确开放 2.5 Flash、Flash-Lite、Pro 的视觉和搜索路由，其他条目保守按翻译处理。
- [阿里百炼](https://help.aliyun.com/zh/model-studio/list-models)：`GET /api/v1/models`，解析 TG/VU 和 web-search 元数据，过滤非文本生成模型。
- [DeepSeek](https://api-docs.deepseek.com/api/list-models/)：`GET /models`，按 input_modalities 判断图片支持；未提供托管搜索，仅翻译或视觉。

目录由 Worker 使用所选密钥获取，模型与能力缓存到数据库，保存配置时再次校验，不允许伪造搜索或视觉能力。
模型删除后其用途路由清空；可单独关闭某用途。Gemini 默认用途参考：

| 用途 | 默认模型 | 默认社区点数 |
| --- | --- | --- |
| translation 普通翻译 | gemini-2.5-flash-lite | 1 |
| search 术语联网搜索 | gemini-2.5-flash | 2 |
| vision 局部截图识别 | gemini-2.5-flash | 2 |

管理员可按用途切换模型，不向客户端暴露选择器。调用 Google 原生 `generateContent`，
每个用途支持最多 5 个有序模型，网页拖拽或上下箭头排序，`routes` 的值为模型条目 ID 数组；旧字符串自动按单项队列兼容。
HTTP 错误、连接/读取中断、空输出或无效响应按顺序切换，每个模型最多尝试一次，只有该用途支持的模型会参与。
多模型单次上游最长 30 秒，整个调用预算 110 秒；单模型保留较长等待（110 秒）。内容安全拒绝停止，不换模型绕过。
有效的“无搜索结果”回答不属于连接故障，不会因此再次调用。不会无限重试、轮换账号规避额度。
一次请求按队列首个可用模型的对应用途点数预扣一次，故障转移不叠加，成功后只结算一次。
全部明确失败退款；任何未确认结果的已发送请求导致最终失败时保留一次点数待核查。
用量 `attempts_json` 保存模型、状态、固定故障代码、耗时及已知用量，不保存提示词、截图、回答和密钥；可在网页展开用量记录查看。
搜索使用 `google_search`，截图使用 `inlineData`；默认关闭思考，限制输出 4096 Token。
配额按 Google 项目共享，不是每用户独立。Google 免费层的内容可能被用于改进产品，
客户端服务选择处已提示；不要提交敏感信息。服务能力/地区及实际免费额度以 Google 控制台为准。
参考：[生成文本](https://ai.google.dev/gemini-api/docs/text-generation)、
[搜索](https://ai.google.dev/gemini-api/docs/google-search)、
[价格](https://ai.google.dev/gemini-api/docs/pricing)、[条款](https://ai.google.dev/gemini-api/terms)。

## API

客户端使用现有社区账号密钥，不需要 Google Key。

```bash
curl https://nstrans.221129.xyz/api/v1/relay/catalog \
  -H "Authorization: Bearer $NST_CLIENT_KEY"
curl https://nstrans.221129.xyz/api/v1/relay \
  -H "Authorization: Bearer $NST_CLIENT_KEY" -H 'Content-Type: application/json' \
  -d '{"purpose":"translation","prompt":"将ゼルダ翻译为简体中文，只输出译名"}'
```

目录返回 `enabled`、`costs`（各用途点数）、`quota`，不返回具体模型。
POST 字段：`purpose` 必须为 translation/search/vision，`prompt` 最多 24000 字符；
vision 必须提供 `imageDataUrl`（PNG/JPEG/WebP base64，约 2MB），其他用途禁止图片。
可提供 `requestId` UUID。同 ID 重复请求返回 409，不重复扣费。
禁止提交 `model` 或 `enableSearch`，服务器不能被客户端强制指定上游。
返回 `content`、`cost`、`quota`、`usage`，搜索还返回 `grounding` 来源链接和 Google 搜索建议，
调用方应按 Google 要求显示搜索建议与来源，不能仅保留词典结果而隐藏归因。
不支持任意工具、任意上游地址、任意图片 URL 或流式透传。

管理员接口 `/api/admin/relay/{config,credentials,discover,users,usage,grants}` 使用管理员会话及同源检查。
配置 GET/PATCH：`enabled`、`routes`、`models`、`maxConcurrency`；模型包含平台、实际型号、密钥 ID、能力及各用途点数。
密钥 GET/POST/PATCH/DELETE：`id`、`name`、`platform`、`workspace`、`apiKey`（编辑留空保持）；GET 不返回密钥或密文。
目录 POST：`{keyId}`，返回该平台的候选模型及能力。不提供用户自定义上游地址。
用户 GET（q/page）、用量 GET（userId/page）、额度 POST（userIds/amount/note，每批最多 100 用户）。
额度调整默认 10 点；amount 可为 -1000000 至 1000000 的非零整数，负数扣减至多到零。
传入 `action:"clear"` 清空剩余点数，保留累计正向分配、消耗和调整审计；可单个或批量操作。
扣减、清空遇到处理中请求返回 409，整批回滚，避免随后退款恢复已清空的额度。
额度是项目内部固定调用点数，与上游 Token 或费用无换算关系。新账号首次创建赠送 30 点，
原生注册和 GitHub 首次登录均覆盖；重复登录、账号绑定不重复赠送。迁移不会给已有账号补发。
赠送由数据库触发器与用户创建在同一事务中完成，并记录在 model_relay_signup_grants。

## 额度与安全

每次按用途预扣一次，成功结算；HTTP 非 2xx 退款。超时、网络中断、无有效回答等
可能已产生上游用量，标记 `uncertain` 保留点数，由管理员核查。大于 5 分钟未完成请求定时回收为待核查。
每用户最多同时两次，全站并发 1–8。上游 429 不会无限重试或切换型号绕过配额。
用量只记录用户、真实服务器型号、用途、点数、Token、耗时、状态；不保存原文、截图、回答或搜索建议。
Google Key 用 AES-GCM 存储，通过 CLIENT_ACCESS_SECRET 派生独立用途密钥，不返回网页或客户端。
上游凭据仅在 `x-goog-api-key` 请求头，不放入 URL，重定向禁止跟随，不转发原始上游错误体。
轮换 CLIENT_ACCESS_SECRET 后须重新配置 Key。

测试包括迁移保留额度、旧接口移除、客户端隐藏型号、服务端用途路由、截图/搜索映射、
Token 统计、密钥保护、配额/并发/重复请求、失败退款及中断恢复。
