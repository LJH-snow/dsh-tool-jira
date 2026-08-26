# dsh-tool-jira

[English](README.md) | [中文](README.zh.md)

A Cordis tool plugin that gives [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) Jira issue management capabilities. Agents can search JQL queries, inspect projects, create and update tickets, add comments, and move issues through workflow transitions.

It follows the official "everything is a plugin" architecture with `ctx.tools.register(defineTool(...))` and the [adding-a-tool](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md) contract.

## Install

Install directly from GitHub:

```sh
npm install github:LJH-snow/dsh-tool-jira
```

Or from a local checkout:

```sh
git clone https://github.com/LJH-snow/dsh-tool-jira
cd dsh-tool-jira
npm install && npm run build
npm install /path/to/dsh-tool-jira
```

Requires `@deepseek-ai/cordis` (^4.0.1) and `@deepseek-ai/dsh-tools` (^0.1.0-rc.6) as peer dependencies, provided by the host dsh runtime.

## Configuration

Load the plugin in a dsh composition config (`cordis.yml`):

```yaml
- name: 'github:LJH-snow/dsh-tool-jira'
  config:
    baseUrl: 'https://your-domain.atlassian.net'   # required
    email: 'user@example.com'                       # required for Cloud API token auth
    apiToken: 'xxx'                                 # Atlassian API token or PAT
    timeoutMs: 15000                                # optional, default 15000
```

Full example: [examples/cordis.yml](examples/cordis.yml).

> Security: the first version requires credentials for every tool because Jira instances are usually access-controlled and write operations can modify tickets. Use an API token or PAT with the minimum permissions needed, and never commit it.

## Tools

| Tool | Description | Credentials |
|---|---|---|
| `jira_search_issues` | Search issues with JQL, up to 100 results | yes |
| `jira_search_my_issues` | Search issues assigned to the authenticated user | yes |
| `jira_get_issue` | Get issue details including ADF description text | yes |
| `jira_create_issue` | Create an issue with summary, type, description, labels, priority, and assignee | yes |
| `jira_update_issue` | Update summary, description, labels, priority, or assignee | yes |
| `jira_add_issue_comment` | Add a comment to an issue | yes |
| `jira_list_issue_comments` | List issue comments, newest first | yes |
| `jira_list_transitions` | List workflow transitions available for an issue | yes |
| `jira_transition_issue` | Move an issue through a workflow transition | yes |
| `jira_list_projects` | List projects visible to the authenticated user | yes |
| `jira_get_project` | Get project details including description, lead, type, style, and archived state | yes |

### Behavior Contract

- Missing credentials return canonical business values: read tools return `{ authenticated: false, ... }`, write tools return `{ ok: false, reason }` or `{ created: false, reason }`.
- Missing issue/project maps to `{ found: false }`.
- Write validation failures (400, 404, 422) map to `{ ok: false, reason }` or `{ created: false, reason }`.
- Infrastructure errors such as invalid credentials (401), forbidden access (403), or rate limiting (429) throw.
- Every request forwards `exec.signal` and uses a configurable timeout (default 15 seconds).

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for the architecture and test coverage.

## License

[MIT](LICENSE)
