import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallView, ToolResultView, ToolResult } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { JiraClient, JiraError } from './client.js'

export const name = 'dsh-tool-jira'
export const inject = ['tools']

export interface JiraPluginConfig {
  /** Jira site root, e.g. https://acme.atlassian.net. Do not include /rest/api/3. */
  baseUrl?: string
  /** Atlassian Cloud user email or self-managed username. */
  email?: string
  /** Atlassian API token or self-managed PAT. */
  apiToken?: string
  /** Request timeout in milliseconds. */
  timeoutMs?: number
}

export function apply(ctx: Context, config: JiraPluginConfig = {}) {
  const client = new JiraClient({
    baseUrl: config.baseUrl,
    email: config.email,
    apiToken: config.apiToken,
    timeoutMs: config.timeoutMs,
  })
  for (const tool of createTools(client)) {
    ctx.tools.register(tool)
  }
}

/** Build the tool definitions for a client. Exported so tests can drive execute/render directly. */
export function createTools(client: JiraClient) {
  return [
    defineTool({
      name: 'jira_search_issues',
      description: 'Search Jira issues with JQL. Useful for finding tickets by project, status, assignee, priority, labels, or summary text.',
      parameters: {
        jql: { type: 'string', required: true, description: 'Jira Query Language expression, e.g. project = ABC AND status = Open ORDER BY updated DESC' },
        limit: { type: 'integer', description: 'Maximum results, 1-100 (default 20)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            authenticated: { type: 'boolean', description: 'Whether Jira credentials were configured' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  key: { type: 'string' },
                  summary: { type: 'string' },
                  status: { type: 'string' },
                  issueType: { type: 'string' },
                  assignee: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  priority: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  labels: { type: 'array', items: { type: 'string' } },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                  url: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          if (value.authenticated === false) return [{ type: 'text', text: 'Searching Jira issues requires Jira credentials.' }]
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No Jira issues found.' }]
          return [{ type: 'text', text: items.map((item: { key?: string; summary?: string; status?: string; url?: string }) =>
            `${item.key}: ${item.summary} [${item.status}] ${item.url ?? ''}`,
          ).join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: 'Search Jira issues', kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { authenticated?: boolean; items?: Array<{ key: string; summary: string; status: string }> }
        if (v.authenticated === false) return { card: 'generic', title: 'Requires Jira credentials' }
        const items = v.items ?? []
        if (items.length === 0) return { card: 'generic', title: 'No issues' }
        return {
          card: 'generic',
          title: `${items.length} issue(s)`,
          content: [{ type: 'text', text: items.map(i => `${i.key} ${i.summary} [${i.status}]`).join('\n') }],
        }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) {
          return { authenticated: false, items: [] }
        }
        const limit = args.limit === undefined ? 20 : Math.max(1, Math.min(args.limit, 100))
        const result = await client.searchIssues(args.jql, { maxResults: limit, signal: exec.signal })
        return { authenticated: true, items: result.items }
      },
    }),

    defineTool({
      name: 'jira_search_my_issues',
      description: 'Search Jira issues assigned to the authenticated user, newest updates first.',
      parameters: {
        limit: { type: 'integer', description: 'Maximum results, 1-100 (default 20)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            authenticated: { type: 'boolean' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  key: { type: 'string' },
                  summary: { type: 'string' },
                  status: { type: 'string' },
                  issueType: { type: 'string' },
                  assignee: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  priority: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  labels: { type: 'array', items: { type: 'string' } },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                  url: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          if (value.authenticated === false) return [{ type: 'text', text: 'Loading assigned issues requires Jira credentials.' }]
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No issues assigned to you.' }]
          return [{ type: 'text', text: items.map((item: { key?: string; summary?: string; status?: string; url?: string }) =>
            `${item.key}: ${item.summary} [${item.status}] ${item.url ?? ''}`,
          ).join('\n') }]
        },
      },
      presentCall(): ToolCallView {
        return { card: 'generic', title: 'My Jira issues', kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { authenticated?: boolean; items?: Array<{ key: string; summary: string; status: string }> }
        if (v.authenticated === false) return { card: 'generic', title: 'Requires Jira credentials' }
        const items = v.items ?? []
        if (items.length === 0) return { card: 'generic', title: 'No assigned issues' }
        return { card: 'generic', title: `${items.length} assigned issue(s)`, content: [{ type: 'text', text: items.map(i => `${i.key} ${i.summary} [${i.status}]`).join('\n') }] }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) {
          return { authenticated: false, items: [] }
        }
        const limit = args.limit === undefined ? 20 : Math.max(1, Math.min(args.limit, 100))
        const result = await client.searchIssues('assignee = currentUser() ORDER BY updated DESC', { maxResults: limit, signal: exec.signal })
        return { authenticated: true, items: result.items }
      },
    }),

    defineTool({
      name: 'jira_get_issue',
      description: 'Get one Jira issue by key, including summary, status, assignee, priority, labels, and description.',
      parameters: {
        key: { type: 'string', required: true, description: 'Jira issue key, e.g. ABC-123' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            authenticated: { type: 'boolean' },
            found: { type: 'boolean' },
            id: { type: 'string' },
            key: { type: 'string' },
            summary: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string' },
            issueType: { type: 'string' },
            assignee: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            priority: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            labels: { type: 'array', items: { type: 'string' } },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
            url: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value.authenticated === false) return [{ type: 'text', text: 'Reading a Jira issue requires Jira credentials.' }]
          if (!value.found) return [{ type: 'text', text: 'Jira issue not found.' }]
          const lines = [
            `${value.key}: ${value.summary}`,
            `status: ${value.status ?? ''}`,
            `type: ${value.issueType ?? ''}`,
            `assignee: ${value.assignee ?? 'unassigned'}`,
            `priority: ${value.priority ?? 'none'}`,
            `labels: ${(value.labels ?? []).join(', ') || 'none'}`,
            value.description ? `description:\n${value.description}` : '',
            value.url ?? '',
          ].filter(Boolean)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Jira issue ${args.key}`, kind: 'read' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { authenticated?: boolean; found?: boolean; key?: string; summary?: string; status?: string }
        if (v.authenticated === false) return { card: 'generic', title: 'Requires Jira credentials' }
        if (!v.found) return { card: 'generic', title: 'Issue not found' }
        return { card: 'generic', title: `${v.key}: ${v.summary}`, content: [{ type: 'text', text: v.status ?? '' }] }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) {
          return { authenticated: false, found: false }
        }
        try {
          const info = await client.getIssue(args.key, exec.signal)
          return { authenticated: true, found: true, ...info }
        } catch (error) {
          if (error instanceof JiraError && error.status === 404) {
            return { authenticated: true, found: false }
          }
          throw error
        }
      },
    }),

    defineTool({
      name: 'jira_create_issue',
      description: 'Create a Jira issue in a project. WRITE operation: requires Jira credentials.',
      parameters: {
        projectKey: { type: 'string', required: true, description: 'Jira project key, e.g. ABC' },
        summary: { type: 'string', required: true, description: 'Issue summary' },
        issueType: { type: 'string', required: true, description: 'Issue type name, e.g. Task, Bug, Story' },
        description: { type: 'string', description: 'Plain-text issue description' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Labels to add' },
        priority: { type: 'string', description: 'Priority name, e.g. High' },
        assigneeAccountId: { type: 'string', description: 'Assignee Atlassian account id' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            created: { type: 'boolean' },
            id: { type: 'string' },
            key: { type: 'string' },
            reason: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value.created) return [{ type: 'text', text: `Created Jira issue ${value.key}.` }]
          return [{ type: 'text', text: `Could not create the Jira issue: ${value.reason}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Create Jira issue in ${args.projectKey}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { created?: boolean; key?: string; reason?: string }
        if (v.created) return { card: 'generic', title: `Jira issue ${v.key} created` }
        return { card: 'generic', title: 'Create issue failed', content: [{ type: 'text', text: v.reason ?? 'Unknown' }] }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) {
          return { created: false, reason: 'Creating a Jira issue requires Jira credentials. Configure email and apiToken.' }
        }
        return client.createIssue({
          projectKey: args.projectKey,
          summary: args.summary,
          issueType: args.issueType,
          description: args.description,
          labels: args.labels,
          priority: args.priority,
          assigneeAccountId: args.assigneeAccountId,
          signal: exec.signal,
        })
      },
    }),

    defineTool({
      name: 'jira_update_issue',
      description: 'Update a Jira issue summary, description, labels, priority, or assignee. WRITE operation: requires Jira credentials. Provide at least one field.',
      parameters: {
        key: { type: 'string', required: true, description: 'Jira issue key, e.g. ABC-123' },
        summary: { type: 'string', description: 'New summary' },
        description: { type: 'string', description: 'New plain-text description' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Replacement labels' },
        priority: { type: 'string', description: 'Replacement priority name' },
        assigneeAccountId: { type: 'string', description: 'Replacement assignee account id' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            reason: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value.ok) return [{ type: 'text', text: `Updated Jira issue ${_args.key}.` }]
          return [{ type: 'text', text: `Could not update ${_args.key}: ${value.reason}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Update Jira issue ${args.key}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { ok?: boolean; reason?: string }
        if (v.ok) return { card: 'generic', title: `Issue ${_args.key} updated` }
        return { card: 'generic', title: 'Update issue failed', content: [{ type: 'text', text: v.reason ?? 'Unknown' }] }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) {
          return { ok: false, reason: 'Updating a Jira issue requires Jira credentials. Configure email and apiToken.' }
        }
        if (args.summary === undefined && args.description === undefined && args.labels === undefined && args.priority === undefined && args.assigneeAccountId === undefined) {
          return { ok: false, reason: 'Provide at least one field to update (summary, description, labels, priority, or assigneeAccountId).' }
        }
        return client.updateIssue(args.key, {
          summary: args.summary,
          description: args.description,
          labels: args.labels,
          priority: args.priority,
          assigneeAccountId: args.assigneeAccountId,
          signal: exec.signal,
        })
      },
    }),

    defineTool({
      name: 'jira_add_issue_comment',
      description: 'Add a comment to a Jira issue. WRITE operation: requires Jira credentials.',
      parameters: {
        key: { type: 'string', required: true, description: 'Jira issue key, e.g. ABC-123' },
        body: { type: 'string', required: true, description: 'Comment text' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            commentId: { type: 'string' },
            reason: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value.ok) return [{ type: 'text', text: `Comment #${value.commentId} added to ${_args.key}.` }]
          return [{ type: 'text', text: `Could not add the comment: ${value.reason}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Comment on ${args.key}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { ok?: boolean; commentId?: string; reason?: string }
        if (v.ok) return { card: 'generic', title: `Comment ${v.commentId} added` }
        return { card: 'generic', title: 'Add comment failed', content: [{ type: 'text', text: v.reason ?? 'Unknown' }] }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) {
          return { ok: false, reason: 'Adding a Jira comment requires Jira credentials. Configure email and apiToken.' }
        }
        return client.addIssueComment(args.key, args.body, exec.signal)
      },
    }),

    defineTool({
      name: 'jira_list_issue_comments',
      description: 'List comments on a Jira issue, newest first.',
      parameters: {
        key: { type: 'string', required: true, description: 'Jira issue key, e.g. ABC-123' },
        limit: { type: 'integer', description: 'Maximum comments, 1-100 (default 20)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            authenticated: { type: 'boolean' },
            total: { type: 'integer' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  author: { type: 'string' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                  body: { type: 'string' },
                  url: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          if (value.authenticated === false) return [{ type: 'text', text: 'Listing Jira comments requires Jira credentials.' }]
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No comments on this issue.' }]
          return [{ type: 'text', text: items.map((item: { author?: string; createdAt?: string; body?: string }) =>
            `${item.author ?? ''} (${item.createdAt ?? ''}): ${item.body ?? ''}`,
          ).join('\n\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Comments on ${args.key}`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { authenticated?: boolean; total?: number; items?: unknown[] }
        if (v.authenticated === false) return { card: 'generic', title: 'Requires Jira credentials' }
        return { card: 'generic', title: `${v.items?.length ?? 0} comment(s) of ${v.total ?? 0}` }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) {
          return { authenticated: false, total: 0, items: [] }
        }
        const limit = args.limit === undefined ? 20 : Math.max(1, Math.min(args.limit, 100))
        const result = await client.listIssueComments(args.key, { maxResults: limit, signal: exec.signal })
        return { authenticated: true, ...result }
      },
    }),

    defineTool({
      name: 'jira_list_transitions',
      description: 'List workflow transitions available for a Jira issue, e.g. In Progress, Done.',
      parameters: {
        key: { type: 'string', required: true, description: 'Jira issue key, e.g. ABC-123' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            authenticated: { type: 'boolean' },
            transitions: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  to: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          if (value.authenticated === false) return [{ type: 'text', text: 'Listing Jira transitions requires Jira credentials.' }]
          const transitions = value.transitions ?? []
          if (transitions.length === 0) return [{ type: 'text', text: 'No transitions available for this issue.' }]
          return [{ type: 'text', text: transitions.map((item: { id?: string; name?: string; to?: string }) =>
            `${item.name ?? ''} (id ${item.id ?? ''}) -> ${item.to ?? ''}`,
          ).join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Transitions for ${args.key}`, kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { authenticated?: boolean; transitions?: unknown[] }
        if (v.authenticated === false) return { card: 'generic', title: 'Requires Jira credentials' }
        return { card: 'generic', title: `${v.transitions?.length ?? 0} transition(s)` }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) {
          return { authenticated: false, transitions: [] }
        }
        const result = await client.listTransitions(args.key, exec.signal)
        return { authenticated: true, transitions: result.transitions }
      },
    }),

    defineTool({
      name: 'jira_transition_issue',
      description: 'Move a Jira issue through a workflow transition, for example to In Progress or Done. WRITE operation: requires Jira credentials.',
      parameters: {
        key: { type: 'string', required: true, description: 'Jira issue key, e.g. ABC-123' },
        transitionId: { type: 'string', required: true, description: 'Transition id from jira_list_transitions' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            reason: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value.ok) return [{ type: 'text', text: `Issue ${_args.key} transitioned.` }]
          return [{ type: 'text', text: `Could not transition ${_args.key}: ${value.reason}` }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Transition ${args.key}`, kind: 'edit' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { ok?: boolean; reason?: string }
        if (v.ok) return { card: 'generic', title: `Issue ${_args.key} transitioned` }
        return { card: 'generic', title: 'Transition failed', content: [{ type: 'text', text: v.reason ?? 'Unknown' }] }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) {
          return { ok: false, reason: 'Transitioning a Jira issue requires Jira credentials. Configure email and apiToken.' }
        }
        return client.transitionIssue(args.key, args.transitionId, exec.signal)
      },
    }),

    defineTool({
      name: 'jira_list_projects',
      description: 'List Jira projects visible to the authenticated user.',
      parameters: {
        limit: { type: 'integer', description: 'Maximum projects, 1-100 (default 50)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            authenticated: { type: 'boolean' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string' },
                  key: { type: 'string' },
                  name: { type: 'string' },
                  projectTypeKey: { type: 'string' },
                  style: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  url: { type: 'string' },
                },
              },
            },
          },
        },
        render: (_args, value) => {
          if (value.authenticated === false) return [{ type: 'text', text: 'Listing Jira projects requires Jira credentials.' }]
          const items = value.items ?? []
          if (items.length === 0) return [{ type: 'text', text: 'No projects visible.' }]
          return [{ type: 'text', text: items.map((item: { key?: string; name?: string; url?: string }) =>
            `${item.key}: ${item.name} ${item.url ?? ''}`,
          ).join('\n') }]
        },
      },
      presentCall(): ToolCallView {
        return { card: 'generic', title: 'Jira projects', kind: 'search' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { authenticated?: boolean; items?: Array<{ key: string; name: string }> }
        if (v.authenticated === false) return { card: 'generic', title: 'Requires Jira credentials' }
        const items = v.items ?? []
        if (items.length === 0) return { card: 'generic', title: 'No projects' }
        return { card: 'generic', title: `${items.length} project(s)`, content: [{ type: 'text', text: items.map(i => `${i.key}: ${i.name}`).join('\n') }] }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) {
          return { authenticated: false, items: [] }
        }
        const limit = args.limit === undefined ? 50 : Math.max(1, Math.min(args.limit, 100))
        const items = await client.listProjects({ maxResults: limit, signal: exec.signal })
        return { authenticated: true, items }
      },
    }),

    defineTool({
      name: 'jira_get_project',
      description: 'Get a Jira project by key, including description, lead, type, style, and archived state.',
      parameters: {
        key: { type: 'string', required: true, description: 'Jira project key, e.g. ABC' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            authenticated: { type: 'boolean' },
            found: { type: 'boolean' },
            id: { type: 'string' },
            key: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            projectTypeKey: { type: 'string' },
            style: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            lead: { oneOf: [{ type: 'string' }, { type: 'null' }] },
            archived: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
            url: { type: 'string' },
          },
        },
        render: (_args, value) => {
          if (value.authenticated === false) return [{ type: 'text', text: 'Reading a Jira project requires Jira credentials.' }]
          if (!value.found) return [{ type: 'text', text: 'Jira project not found.' }]
          const lines = [
            `${value.key}: ${value.name}`,
            `type: ${value.projectTypeKey ?? ''}`,
            `lead: ${value.lead ?? 'none'}`,
            `archived: ${value.archived === null ? 'unknown' : value.archived ? 'yes' : 'no'}`,
            value.description ? `description:\n${value.description}` : '',
            value.url ?? '',
          ].filter(Boolean)
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      presentCall(args): ToolCallView {
        return { card: 'generic', title: `Jira project ${args.key}`, kind: 'read' }
      },
      presentResult(_args, result): ToolResultView | undefined {
        const v = result as unknown as { authenticated?: boolean; found?: boolean; key?: string; name?: string }
        if (v.authenticated === false) return { card: 'generic', title: 'Requires Jira credentials' }
        if (!v.found) return { card: 'generic', title: 'Project not found' }
        return { card: 'generic', title: `${v.key}: ${v.name}` }
      },
      async execute(args, exec) {
        if (!client.hasCredentials()) {
          return { authenticated: false, found: false }
        }
        try {
          const info = await client.getProject(args.key, exec.signal)
          return { authenticated: true, found: true, ...info }
        } catch (error) {
          if (error instanceof JiraError && error.status === 404) {
            return { authenticated: true, found: false }
          }
          throw error
        }
      },
    }),
  ]
}
