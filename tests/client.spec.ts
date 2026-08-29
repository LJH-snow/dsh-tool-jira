import { describe, expect, it, vi } from 'vitest'
import { JiraClient, JiraError } from '../src/client.ts'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const issueFixture = {
  id: '10100',
  key: 'ABC-1',
  self: 'https://acme.atlassian.net/rest/api/3/issue/ABC-1',
  fields: {
    summary: 'Fix login',
    description: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Describe the failure.' }] }],
    },
    status: { name: 'Open' },
    issuetype: { name: 'Bug' },
    assignee: { displayName: 'Alice' },
    priority: { name: 'High' },
    labels: ['bug'],
    created: '2026-08-01T00:00:00Z',
    updated: '2026-08-02T00:00:00Z',
  },
}

describe('JiraClient', () => {
  it('uses Basic auth with base64(email:apiToken) and the v3 API path', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { issues: [] }))
    const client = new JiraClient({
      baseUrl: 'https://acme.atlassian.net',
      email: 'alice@example.com',
      apiToken: 'secret-token',
      fetchImpl,
    })

    await client.searchIssues('project = ABC', { maxResults: 5 })

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const expectedAuth = `Basic ${Buffer.from('alice@example.com:secret-token').toString('base64')}`
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/search/jql')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ authorization: expectedAuth })
    expect(JSON.parse(String(init.body))).toMatchObject({ jql: 'project = ABC', maxResults: 5 })
  })

  it('normalizes a baseUrl with a trailing slash', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { issues: [] }))
    const client = new JiraClient({ baseUrl: 'https://jira.example.com/', fetchImpl })
    await client.searchIssues('project = X')
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('https://jira.example.com/rest/api/3/search/jql')
  })

  it('searchIssues maps issue fields and clamps maxResults', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { issues: [issueFixture] }))
    const client = new JiraClient({ baseUrl: 'https://acme.atlassian.net', fetchImpl })
    const result = await client.searchIssues('project = ABC', { maxResults: 999 })

    expect(result.items[0]).toMatchObject({
      id: '10100',
      key: 'ABC-1',
      summary: 'Fix login',
      status: 'Open',
      issueType: 'Bug',
      assignee: 'Alice',
      priority: 'High',
      labels: ['bug'],
      url: 'https://acme.atlassian.net/browse/ABC-1',
    })
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({ maxResults: 100 })
  })

  it('getIssue converts an ADF description to readable plain text', async () => {
    const client = new JiraClient({ fetchImpl: vi.fn(async () => jsonResponse(200, issueFixture)) })
    const issue = await client.getIssue('ABC-1')
    expect(issue.description).toBe('Describe the failure.')
  })

  it('getIssue throws JiraError 404 for a missing issue', async () => {
    const client = new JiraClient({ fetchImpl: vi.fn(async () => jsonResponse(404, {})) })
    await expect(client.getIssue('ABC-999')).rejects.toMatchObject({ status: 404 })
  })

  it('createIssue sends an ADF description and returns created metadata', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { id: '102', key: 'ABC-2' }))
    const client = new JiraClient({ email: 'a@example.com', apiToken: 't', fetchImpl })
    const result = await client.createIssue({
      projectKey: 'ABC',
      summary: 'New bug',
      issueType: 'Bug',
      description: 'Details here',
      labels: ['bug'],
      priority: 'High',
    })

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.fields).toMatchObject({
      project: { key: 'ABC' },
      summary: 'New bug',
      issuetype: { name: 'Bug' },
      labels: ['bug'],
      priority: { name: 'High' },
    })
    expect(body.fields.description).toEqual({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Details here' }] }],
    })
    expect(result).toEqual({ created: true, id: '102', key: 'ABC-2' })
  })

  it('createIssue maps validation errors to a business failure value', async () => {
    const client = new JiraClient({ email: 'a@example.com', apiToken: 't', fetchImpl: vi.fn(async () => jsonResponse(400, {})) })
    const result = await client.createIssue({ projectKey: 'ABC', summary: 'x', issueType: 'Task' })
    expect(result.created).toBe(false)
    expect(String(result.reason)).toContain('project')
  })

  it('updateIssue sends only provided fields and handles 204', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))
    const client = new JiraClient({ email: 'a@example.com', apiToken: 't', fetchImpl })
    const result = await client.updateIssue('ABC-1', { summary: 'Renamed', labels: ['urgent'] })
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('PUT')
    expect(JSON.parse(String(init.body))).toEqual({ fields: { summary: 'Renamed', labels: ['urgent'] } })
    expect(result).toEqual({ ok: true })

    const missing = new JiraClient({ email: 'a@example.com', apiToken: 't', fetchImpl: vi.fn(async () => jsonResponse(404, {})) })
    expect((await missing.updateIssue('ABC-1', { summary: 'x' })).ok).toBe(false)
  })

  it('addIssueComment sends ADF comment body and maps 404', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(201, { id: '99' }))
    const client = new JiraClient({ email: 'a@example.com', apiToken: 't', fetchImpl })
    const result = await client.addIssueComment('ABC-1', 'Looks good')
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      body: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Looks good' }] }],
      },
    })
    expect(result).toEqual({ ok: true, commentId: '99' })

    const missing = new JiraClient({ email: 'a@example.com', apiToken: 't', fetchImpl: vi.fn(async () => jsonResponse(404, {})) })
    expect((await missing.addIssueComment('ABC-1', 'x')).ok).toBe(false)
  })

  it('listIssueComments converts ADF bodies and sorts newest first', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      total: 2,
      comments: [
        {
          id: '1',
          author: { displayName: 'Alice' },
          created: '2026-08-01T00:00:00Z',
          updated: '2026-08-01T00:00:00Z',
          body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old' }] }] },
          self: 'https://acme.atlassian.net/rest/api/3/issue/ABC-1/comment/1',
        },
        {
          id: '2',
          author: { displayName: 'Bob' },
          created: '2026-08-02T00:00:00Z',
          updated: '2026-08-02T00:00:00Z',
          body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New' }] }] },
          self: 'https://acme.atlassian.net/rest/api/3/issue/ABC-1/comment/2',
        },
      ],
    }))
    const client = new JiraClient({ fetchImpl })
    const result = await client.listIssueComments('ABC-1')
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/issue/ABC-1/comment?maxResults=20')
    expect(result.items.map(item => item.id)).toEqual(['2', '1'])
    expect(result.items[0].body).toBe('New')
  })

  it('listTransitions and transitionIssue use the transition endpoint', async () => {
    const transitionFetch = vi.fn(async () => jsonResponse(200, {
      transitions: [{ id: '11', name: 'In Progress', to: { name: 'In Progress' } }],
    }))
    const client = new JiraClient({ fetchImpl: transitionFetch })
    const transitions = await client.listTransitions('ABC-1')
    expect(transitions.transitions[0]).toEqual({ id: '11', name: 'In Progress', to: 'In Progress' })

    const postFetch = vi.fn(async () => jsonResponse(204))
    const writer = new JiraClient({ email: 'a@example.com', apiToken: 't', fetchImpl: postFetch })
    const transitionResult = await writer.transitionIssue('ABC-1', '11')
    const [, init] = postFetch.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ transition: { id: '11' } })
    expect(transitionResult).toEqual({ ok: true })
  })

  it('listProjects maps visible projects and honors maxResults', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      values: [{ id: '1', key: 'ABC', name: 'Acme', projectTypeKey: 'software', style: 'next-gen' }],
    }))
    const client = new JiraClient({ baseUrl: 'https://acme.atlassian.net', fetchImpl })
    const projects = await client.listProjects({ maxResults: 3 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toContain('/project/search?maxResults=3')
    expect(projects[0]).toMatchObject({ key: 'ABC', name: 'Acme', url: 'https://acme.atlassian.net/browse/ABC' })
  })

  it('getProject maps description, lead, and archived state', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      id: '1',
      key: 'ABC',
      name: 'Acme',
      description: 'Main product',
      projectTypeKey: 'software',
      style: 'next-gen',
      lead: { displayName: 'Alice' },
      archived: false,
    }))
    const client = new JiraClient({ fetchImpl })
    const project = await client.getProject('ABC')
    expect(project).toMatchObject({
      key: 'ABC',
      description: 'Main product',
      lead: 'Alice',
      archived: false,
    })
  })

  it('listIssueTypes maps issue type metadata', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [{
      id: '10000',
      name: 'Bug',
      description: 'A problem which impairs quality or function.',
      subtask: false,
      iconUrl: 'https://acme.atlassian.net/icon/bug.svg',
    }]))
    const client = new JiraClient({ baseUrl: 'https://acme.atlassian.net', fetchImpl })
    const items = await client.listIssueTypes()
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/issuetype')
    expect(items[0]).toEqual({
      id: '10000',
      name: 'Bug',
      description: 'A problem which impairs quality or function.',
      subtask: false,
      iconUrl: 'https://acme.atlassian.net/icon/bug.svg',
    })
  })

  it('listPriorities maps priority metadata', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [{
      id: '2',
      name: 'High',
      description: 'High priority.',
      statusColor: '#f15c75',
      iconUrl: 'https://acme.atlassian.net/icon/high.svg',
    }]))
    const client = new JiraClient({ baseUrl: 'https://acme.atlassian.net', fetchImpl })
    const items = await client.listPriorities()
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/priority')
    expect(items[0]).toEqual({
      id: '2',
      name: 'High',
      description: 'High priority.',
      statusColor: '#f15c75',
      iconUrl: 'https://acme.atlassian.net/icon/high.svg',
    })
  })

  it('searchUsers builds query params and maps user fields', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, [{
      accountId: '712020:alice',
      displayName: 'Alice Wang',
      emailAddress: 'alice@example.com',
      active: true,
      accountType: 'atlassian',
      timeZone: 'Asia/Shanghai',
      self: 'https://acme.atlassian.net/rest/api/3/user?accountId=712020%3Aalice',
    }]))
    const client = new JiraClient({ baseUrl: 'https://acme.atlassian.net', fetchImpl })
    const users = await client.searchUsers('Ali', { maxResults: 3 })
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/user/search?query=Ali&maxResults=3')
    expect(users[0]).toMatchObject({
      accountId: '712020:alice',
      displayName: 'Alice Wang',
      emailAddress: 'alice@example.com',
      active: true,
      timeZone: 'Asia/Shanghai',
    })
  })

  it('getUser maps account details and throws 404 for a missing user', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {
      accountId: '712020:alice',
      displayName: 'Alice Wang',
      emailAddress: 'alice@example.com',
      active: true,
      accountType: 'atlassian',
      timeZone: 'Asia/Shanghai',
      self: 'https://acme.atlassian.net/rest/api/3/user?accountId=712020%3Aalice',
    }))
    const client = new JiraClient({ baseUrl: 'https://acme.atlassian.net', fetchImpl })
    const user = await client.getUser('712020:alice')
    const [url] = fetchImpl.mock.calls[0] as [string]
    expect(url).toBe('https://acme.atlassian.net/rest/api/3/user?accountId=712020%3Aalice')
    expect(user).toMatchObject({ accountId: '712020:alice', displayName: 'Alice Wang' })

    const missing = new JiraClient({ fetchImpl: vi.fn(async () => jsonResponse(404, {})) })
    await expect(missing.getUser('missing')).rejects.toMatchObject({ status: 404 })
  })

  it('hasCredentials reflects configured credentials', () => {
    expect(new JiraClient().hasCredentials()).toBe(false)
    expect(new JiraClient({ email: 'a@example.com', apiToken: 't' }).hasCredentials()).toBe(true)
  })

  it('maps 401 and 429 to typed infrastructure errors', async () => {
    const unauthClient = new JiraClient({ email: 'a@example.com', apiToken: 'bad', fetchImpl: vi.fn(async () => jsonResponse(401, {})) })
    await expect(unauthClient.searchIssues('x')).rejects.toThrow(JiraError)
    const limitedClient = new JiraClient({ email: 'a@example.com', apiToken: 't', fetchImpl: vi.fn(async () => jsonResponse(429, {})) })
    await expect(limitedClient.searchIssues('x')).rejects.toMatchObject({ status: 429 })
  })
})
