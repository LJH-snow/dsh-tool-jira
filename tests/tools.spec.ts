import { describe, expect, it, vi } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { JiraClient } from '../src/client.ts'
import { createTools } from '../src/index.ts'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function exec(): ToolRunContext {
  return { signal: new AbortController().signal } as unknown as ToolRunContext
}

function tools() {
  return Object.fromEntries(createTools(new JiraClient({ fetchImpl: globalThis.fetch })).map(tool => [tool.name, tool]))
}

describe('tool definitions', () => {
  it('registers the planned Jira tool set', () => {
    expect(Object.keys(tools()).sort()).toEqual([
      'jira_add_issue_comment',
      'jira_create_issue',
      'jira_get_issue',
      'jira_get_project',
      'jira_list_issue_comments',
      'jira_list_projects',
      'jira_list_transitions',
      'jira_search_issues',
      'jira_search_my_issues',
      'jira_transition_issue',
      'jira_update_issue',
    ])
  })

  it('read tools return authenticated:false without credentials', async () => {
    const client = new JiraClient({ fetchImpl: vi.fn() })
    const map = Object.fromEntries(createTools(client).map(tool => [tool.name, tool]))

    expect(await map.jira_search_issues.execute({ jql: 'project = ABC' }, exec())).toEqual({ authenticated: false, items: [] })
    expect(await map.jira_search_my_issues.execute({}, exec())).toEqual({ authenticated: false, items: [] })
    expect(await map.jira_get_issue.execute({ key: 'ABC-1' }, exec())).toEqual({ authenticated: false, found: false })
    expect(await map.jira_list_issue_comments.execute({ key: 'ABC-1' }, exec())).toEqual({ authenticated: false, total: 0, items: [] })
    expect(await map.jira_list_transitions.execute({ key: 'ABC-1' }, exec())).toEqual({ authenticated: false, transitions: [] })
    expect(await map.jira_list_projects.execute({}, exec())).toEqual({ authenticated: false, items: [] })
    expect(await map.jira_get_project.execute({ key: 'ABC' }, exec())).toEqual({ authenticated: false, found: false })
  })

  it('write tools return a clear credentials reason without credentials', async () => {
    const client = new JiraClient({ fetchImpl: vi.fn() })
    const map = Object.fromEntries(createTools(client).map(tool => [tool.name, tool]))

    expect(await map.jira_create_issue.execute({ projectKey: 'ABC', summary: 'x', issueType: 'Task' }, exec())).toEqual({
      created: false,
      reason: expect.stringContaining('credentials'),
    })
    const update = await map.jira_update_issue.execute({ key: 'ABC-1', summary: 'x' }, exec())
    expect(update).toEqual({ ok: false, reason: expect.stringContaining('credentials') })
    const comment = await map.jira_add_issue_comment.execute({ key: 'ABC-1', body: 'x' }, exec())
    expect(comment).toEqual({ ok: false, reason: expect.stringContaining('credentials') })
    const transition = await map.jira_transition_issue.execute({ key: 'ABC-1', transitionId: '11' }, exec())
    expect(transition).toEqual({ ok: false, reason: expect.stringContaining('credentials') })
  })

  it('jira_update_issue requires at least one field', async () => {
    const client = new JiraClient({ email: 'a@example.com', apiToken: 't', fetchImpl: vi.fn() })
    const tool = createTools(client).find(t => t.name === 'jira_update_issue')!
    const result = await tool.execute({ key: 'ABC-1' }, exec())
    expect(result).toMatchObject({ ok: false })
    expect(String(result.reason)).toContain('at least one field')
  })

  it('jira_search_issues executes with credentials and clamps the limit', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      issues: [{
        id: '1',
        key: 'ABC-1',
        self: 'https://acme.atlassian.net/rest/api/3/issue/ABC-1',
        fields: { summary: 'S', status: { name: 'Open' }, issuetype: { name: 'Task' }, assignee: null, priority: null, labels: [], created: '2026-08-01T00:00:00Z', updated: '2026-08-01T00:00:00Z' },
      }],
    }))
    const client = new JiraClient({ email: 'a@example.com', apiToken: 't', fetchImpl })
    const tool = createTools(client).find(t => t.name === 'jira_search_issues')!
    const result = await tool.execute({ jql: 'project = ABC', limit: 500 }, exec())
    expect(result).toMatchObject({ authenticated: true, items: [{ key: 'ABC-1' }] })
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({ maxResults: 100 })
  })

  it('jira_get_issue maps 404 to found:false', async () => {
    const client = new JiraClient({ email: 'a@example.com', apiToken: 't', fetchImpl: vi.fn(async () => jsonResponse(404, {})) })
    const tool = createTools(client).find(t => t.name === 'jira_get_issue')!
    const result = await tool.execute({ key: 'ABC-999' }, exec())
    expect(result).toEqual({ authenticated: true, found: false })
  })

  it('jira_create_issue maps 422 to created:false', async () => {
    const client = new JiraClient({ email: 'a@example.com', apiToken: 't', fetchImpl: vi.fn(async () => jsonResponse(422, {})) })
    const tool = createTools(client).find(t => t.name === 'jira_create_issue')!
    const result = await tool.execute({ projectKey: 'ABC', summary: 'x', issueType: 'Task' }, exec())
    expect(result).toMatchObject({ created: false })
  })

  it('renders a readable issue summary from the canonical result value', async () => {
    const client = new JiraClient({ fetchImpl: vi.fn() })
    const tool = createTools(client).find(t => t.name === 'jira_search_issues')!
    const blocks = await (tool.output as { render: (a: unknown, value: any) => unknown }).render({}, {
      authenticated: true,
      items: [{ key: 'ABC-1', summary: 'Fix login', status: 'Open', url: 'https://acme.atlassian.net/browse/ABC-1' }],
    })
    expect(JSON.stringify(blocks)).toContain('ABC-1: Fix login [Open]')
  })

  it('jira_get_issue cards reflect read and missing states', () => {
    const client = new JiraClient({ fetchImpl: vi.fn() })
    const tool = createTools(client).find(t => t.name === 'jira_get_issue') as any
    expect(tool.presentCall({ key: 'ABC-1' })).toMatchObject({ card: 'generic', kind: 'read', title: 'Jira issue ABC-1' })
    expect(tool.presentResult({ key: 'ABC-1' }, { authenticated: true, found: true, key: 'ABC-1', summary: 'S', status: 'Open' })).toMatchObject({ card: 'generic', title: 'ABC-1: S' })
    expect(tool.presentResult({ key: 'ABC-1' }, { authenticated: true, found: false })).toMatchObject({ title: 'Issue not found' })
    expect(tool.presentResult({ key: 'ABC-1' }, { authenticated: false })).toMatchObject({ title: 'Requires Jira credentials' })
  })

  it('jira_create_issue cards reflect success and failure results', () => {
    const client = new JiraClient({ fetchImpl: vi.fn() })
    const tool = createTools(client).find(t => t.name === 'jira_create_issue') as any
    const args = { projectKey: 'ABC', summary: 'S', issueType: 'Task' }
    expect(tool.presentCall(args)).toMatchObject({ card: 'generic', kind: 'edit', title: 'Create Jira issue in ABC' })
    expect(tool.presentResult(args, { created: true, key: 'ABC-2' })).toMatchObject({ title: 'Jira issue ABC-2 created' })
    expect(tool.presentResult(args, { created: false, reason: 'nope' })).toMatchObject({ title: 'Create issue failed' })
  })
})
