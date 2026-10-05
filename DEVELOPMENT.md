# dsh-tool-jira 开发文档

## 1. 项目概览

| 项 | 内容 |
|---|---|
| 项目名 | `dsh-tool-jira` |
| 定位 | DeepSeek Harness 的独立 Jira 工具插件 |
| 版本 | v0.3.1 |
| 架构 | Cordis 插件 + `ctx.tools.register(defineTool(...))` |
| API | Jira Cloud/Data Center REST API v3 |
| 认证 | Basic Auth，`base64(email:apiToken)` |

### 1.1 目录

```text
src/client.ts      Jira REST 客户端：fetch 注入、超时、认证、错误映射
src/index.ts       15 个 defineTool 定义与插件 apply
tests/client.spec.ts  客户端契约测试
tests/tools.spec.ts   工具注册、认证保护、业务失败值、UI 呈现测试
examples/cordis.yml   dsh 组合配置示例
.github/workflows/ci.yml  Node 22/24 CI
```

## 2. 技术决策

### 2.1 范围控制

v0.2 定位为「Jira Issue 管理闭环 + 工单元数据查询」：搜索、读详情、创建、更新、评论、流转、项目/问题类型/优先级/用户查询，共 15 个工具。后续版本再扩展附件、Sprint/Board、链接和工单模板，避免新插件一开始就膨胀成 80+ 工具。

### 2.2 认证与安全

- 所有工具都要求 `email` + `apiToken`/PAT，因为 Jira 项目和写操作通常有权限边界。
- 未配置凭据时返回业务值，不抛出异常：读工具 `{ authenticated: false, ... }`，写工具 `{ created: false, reason }` 或 `{ ok: false, reason }`。
- `401` 表示凭据无效，`403` 表示无权限，`429` 表示限流；这三类基础设施错误抛出 `JiraError`。
- 写操作校验失败 `400`/`404`/`422` 映射为业务失败值。

### 2.3 Jira API 细节

- 默认站点 `https://your-domain.atlassian.net`，通过 `baseUrl` 覆盖，自动去掉尾部斜杠。
- 搜索使用 `POST /rest/api/3/search/jql`，`maxResults` 钳制在 1-100。
- 工单元数据使用 `GET /rest/api/3/issuetype`、`GET /rest/api/3/priority`、`GET /rest/api/3/user/search` 和 `GET /rest/api/3/user?accountId=...`。
- Issue 查询、评论读取会收到 Atlassian Document Format（ADF）。客户端把 ADF 转换为纯文本，供工具输出和渲染使用。
- 创建/更新描述的 `description` 字段发送 ADF 文档对象；添加评论的 `body` 也发送 ADF 文档对象。
- 工作流流转使用 `transition.id`，调用前先由 `jira_list_transitions` 获取。

### 2.4 错误映射

| 场景 | 返回/行为 |
|---|---|
| 未配置凭据（读） | `{ authenticated: false, ... }` |
| 未配置凭据（写） | `{ created: false, reason }` 或 `{ ok: false, reason }` |
| Issue/Project/User 404 | `{ found: false }` |
| 写操作 400/404/422 | `{ created: false, reason }` 或 `{ ok: false, reason }` |
| 401/403/429 | 抛 `JiraError` |

## 3. 测试

```sh
npm install
npm run typecheck
npm test
npm run build
```

当前测试覆盖：

- Basic Auth header 与 REST v3 路径。
- 搜索请求 body、结果映射、`maxResults` 钳制。
- ADF 描述和评论正文转换。
- 创建、更新、评论、流转、项目、问题类型、优先级、用户的请求体与业务失败映射。
- 15 个工具注册、无凭据保护、执行结果、render 纯函数与 present 卡片。

## 4. 后续方向

- Issue 审核场景：评审人/观察者解析。
- `jira_add_issue_link` / `jira_list_issue_links`：关联工单。
- `jira_list_boards` / `jira_list_sprints`：项目规划场景。
- 附件上传与下载元信息。

开发新能力时保持同一个客户端的错误映射和 ADF 转换约定，避免模型看到的返回结构分裂。

## endpoint 安全校验

`baseUrl` 默认行为不变（仅去尾斜杠），每次请求前额外做字面量链路本地校验：`169.254.0.0/16`、`fe80::/10`，以及 `::/96`、`::ffff:0:0/96`、`64:ff9b::/96` 中内嵌的 IPv4 形式。默认模式**不做 DNS 解析**，因此域名端点行为与之前完全一致。

设置 `enforcePublicEndpoint: true` 后启用完整策略：`baseUrl` 规范化为 origin + 路径前缀（禁止 credentials/query/fragment），并对解析结果做 fail-closed 校验。

两个模式的地址清单共享同一份 `src/url-security.ts`——该文件由 `.verify/gen-url-security-b.mjs` 从 A 类模板加 B 类策略层生成，网段清单与 A 类逐行一致（18 个 IPv4 + 16 个 IPv6，对齐 IANA 注册表），不得单独修改。`lookupImpl` 仅作测试注入点，不进入插件配置接口。

自建部署（内网 GitLab / GitHub Enterprise / Jira DC / 自托管 Sentry）默认不受影响，这是本插件不默认开启公网限制的原因。
