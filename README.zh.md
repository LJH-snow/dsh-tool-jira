# dsh-tool-jira

[English](README.md) | 中文

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）提供 Jira Issue 管理能力的 Cordis 工具插件。Agent 可以通过自然语言执行 JQL 搜索、查看项目、创建和更新工单、添加评论，以及推进工作流状态。

插件遵循官方「一切皆插件」架构，通过 `ctx.tools.register(defineTool(...))` 注册模型可见工具，并符合 [adding-a-tool](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md) 契约。

## 安装

直接从 GitHub 安装：

```sh
npm install github:LJH-snow/dsh-tool-jira
```

或从本地目录安装：

```sh
git clone https://github.com/LJH-snow/dsh-tool-jira
cd dsh-tool-jira
npm install && npm run build
npm install /path/to/dsh-tool-jira
```

需要 `@deepseek-ai/cordis`（^4.0.1）与 `@deepseek-ai/dsh-tools`（^0.1.0-rc.6）作为 peer 依赖，由宿主 dsh 运行时提供。

## 配置

在 dsh 的组合配置（`cordis.yml`）中加载插件：

```yaml
- name: 'github:LJH-snow/dsh-tool-jira'
  config:
    baseUrl: 'https://your-domain.atlassian.net'   # 必填
    email: 'user@example.com'                       # Cloud API Token 认证必填
    apiToken: 'xxx'                                 # Atlassian API Token 或 PAT
    timeoutMs: 15000                                # 可选，默认 15000
```

完整示例见 [examples/cordis.yml](examples/cordis.yml)。

> 安全说明：第一版所有工具都需要凭据，因为 Jira 实例通常有访问控制，而且部分操作会修改工单。请使用最小权限的 API Token 或 PAT，不要把凭据写入版本库。

## 提供的工具

| 工具 | 说明 | 需要凭据 |
|---|---|---|
| `jira_search_issues` | 使用 JQL 搜索工单，最多 100 条 | 是 |
| `jira_search_my_issues` | 搜索分配给当前认证用户的工单 | 是 |
| `jira_get_issue` | 查看工单详情，ADF 描述会转为可读文本 | 是 |
| `jira_create_issue` | 创建工单：摘要、类型、描述、标签、优先级、经办人 | 是 |
| `jira_update_issue` | 更新摘要、描述、标签、优先级或经办人 | 是 |
| `jira_add_issue_comment` | 给工单添加评论 | 是 |
| `jira_list_issue_comments` | 查看工单评论，新的在前 | 是 |
| `jira_list_transitions` | 查看工单可用的工作流流转 | 是 |
| `jira_transition_issue` | 推进工单工作流状态 | 是 |
| `jira_list_projects` | 列出当前用户可见的项目 | 是 |
| `jira_get_project` | 查看项目详情：描述、负责人、类型、样式、归档状态 | 是 |

### 行为约定

- 未配置凭据时返回明确业务值：读工具返回 `{ authenticated: false, ... }`，写工具返回 `{ ok: false, reason }` 或 `{ created: false, reason }`。
- 工单或项目不存在映射为 `{ found: false }`。
- 写操作校验失败（400、404、422）映射为 `{ ok: false, reason }` 或 `{ created: false, reason }`。
- 凭据无效（401）、访问禁止（403）、限流（429）等基础设施错误直接抛出。
- 每个请求都透传 `exec.signal`，并使用可配置超时（默认 15 秒）。

## 开发

```sh
npm install
npm run typecheck
npm test
npm run build
```

架构与测试计划见 [DEVELOPMENT.md](DEVELOPMENT.md)。

## License

[MIT](LICENSE)
