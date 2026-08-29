/** Minimal Jira REST API v3 client with injected fetch for testability. */

export interface JiraClientOptions {
  baseUrl?: string
  email?: string
  apiToken?: string
  fetchImpl?: typeof fetch
  /** Request timeout in milliseconds. 0 disables the timeout. */
  timeoutMs?: number
}

export interface JiraIssueSummary {
  id: string
  key: string
  summary: string
  status: string
  issueType: string
  assignee: string | null
  priority: string | null
  labels: string[]
  createdAt: string
  updatedAt: string
  url: string
}

export interface JiraIssueDetail extends JiraIssueSummary {
  description: string
}

export interface JiraSearchResult {
  items: JiraIssueSummary[]
}

export interface JiraIssueWriteResult {
  created: boolean
  key?: string
  id?: string
  reason?: string
}

export interface JiraWriteResult {
  ok: boolean
  reason?: string
}

export interface JiraCommentItem {
  id: string
  author: string
  createdAt: string
  updatedAt: string
  body: string
  url: string
}

export interface JiraCommentListResult {
  total: number
  items: JiraCommentItem[]
}

export interface JiraCommentWriteResult {
  ok: boolean
  commentId?: string
  reason?: string
}

export interface JiraTransitionItem {
  id: string
  name: string
  to: string
}

export interface JiraTransitionListResult {
  transitions: JiraTransitionItem[]
}

export interface JiraTransitionWriteResult {
  ok: boolean
  reason?: string
}

export interface JiraProjectItem {
  id: string
  key: string
  name: string
  projectTypeKey: string
  style: string | null
  url: string
}

export interface JiraProjectDetail extends JiraProjectItem {
  description: string
  lead: string | null
  archived: boolean | null
}

export interface JiraIssueTypeItem {
  id: string
  name: string
  description: string
  subtask: boolean
  iconUrl: string
}

export interface JiraPriorityItem {
  id: string
  name: string
  description: string
  statusColor: string
  iconUrl: string
}

export interface JiraUserItem {
  accountId: string
  displayName: string
  emailAddress: string
  active: boolean
  accountType: string
  timeZone: string
  url: string
}

export class JiraError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function adfDescription(text: string) {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text }],
      },
    ],
  }
}

function adfText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  const node = value as { type?: string; text?: unknown; content?: unknown }
  if (typeof node.text === 'string') return node.text
  if (!Array.isArray(node.content)) return ''

  const blockTypes = new Set([
    'doc',
    'paragraph',
    'heading',
    'codeBlock',
    'blockquote',
    'listItem',
    'bulletList',
    'orderedList',
    'table',
    'tableRow',
    'tableCell',
    'tableHeader',
    'panel',
  ])
  const parts = node.content
    .map(child => adfText(child))
    .filter(Boolean)
  return parts.join(node.type && blockTypes.has(node.type) ? '\n' : '')
}

interface RawIssue {
  id: string
  key: string
  self: string
  fields: {
    summary?: string | null
    description?: unknown
    status?: { name?: string } | null
    issuetype?: { name?: string } | null
    assignee?: { displayName?: string } | null
    priority?: { name?: string } | null
    labels?: string[]
    created?: string | null
    updated?: string | null
  }
}

function displayName(value: { displayName?: string } | null | undefined): string | null {
  return value?.displayName ?? null
}

export class JiraClient {
  private readonly siteUrl: string
  private readonly email: string | undefined
  private readonly apiToken: string | undefined
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(options: JiraClientOptions = {}) {
    this.siteUrl = (options.baseUrl ?? 'https://your-domain.atlassian.net').replace(/\/$/, '')
    this.email = options.email
    this.apiToken = options.apiToken
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  hasCredentials(): boolean {
    return Boolean(this.email && this.apiToken)
  }

  private apiBase(): string {
    return `${this.siteUrl}/rest/api/3`
  }

  private issueUrl(key: string): string {
    return `${this.siteUrl}/browse/${encodeURIComponent(key)}`
  }

  private projectUrl(key: string): string {
    return `${this.siteUrl}/browse/${encodeURIComponent(key)}`
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
      'user-agent': 'dsh-tool-jira',
    }
    if (this.email && this.apiToken) {
      headers.authorization = `Basic ${Buffer.from(`${this.email}:${this.apiToken}`).toString('base64')}`
    }
    return headers
  }

  private combinedSignal(signal?: AbortSignal): AbortSignal | undefined {
    if (this.timeoutMs <= 0) return signal
    const timeout = AbortSignal.timeout(this.timeoutMs)
    return signal ? AbortSignal.any([signal, timeout]) : timeout
  }

  private async request<T>(path: string, options: { signal?: AbortSignal; method?: string; body?: unknown } = {}): Promise<T> {
    const init: RequestInit = {
      headers: this.headers(),
      method: options.method ?? 'GET',
      signal: this.combinedSignal(options.signal),
    }
    if (options.body !== undefined) init.body = JSON.stringify(options.body)
    const res = await this.fetchImpl(`${this.apiBase()}${path}`, init)
    if (!res.ok) {
      if (res.status === 401) throw new JiraError('Invalid or missing Jira credentials', 401)
      if (res.status === 403) throw new JiraError('Jira API access forbidden', 403)
      if (res.status === 429) throw new JiraError('Jira rate limit exceeded', 429)
      throw new JiraError(`Jira API error ${res.status}`, res.status)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  private mapIssue(raw: RawIssue): JiraIssueSummary {
    return {
      id: raw.id,
      key: raw.key,
      summary: raw.fields.summary ?? '',
      status: raw.fields.status?.name ?? '',
      issueType: raw.fields.issuetype?.name ?? '',
      assignee: displayName(raw.fields.assignee),
      priority: raw.fields.priority?.name ?? null,
      labels: raw.fields.labels ?? [],
      createdAt: raw.fields.created ?? '',
      updatedAt: raw.fields.updated ?? '',
      url: this.issueUrl(raw.key),
    }
  }

  async searchIssues(jql: string, options: { maxResults?: number; signal?: AbortSignal } = {}): Promise<JiraSearchResult> {
    const maxResults = options.maxResults === undefined ? 20 : Math.max(1, Math.min(options.maxResults, 100))
    const data = await this.request<{ issues: RawIssue[] }>('/search/jql', {
      method: 'POST',
      body: {
        jql,
        maxResults,
        fields: ['summary', 'status', 'issuetype', 'assignee', 'priority', 'labels', 'created', 'updated'],
      },
      signal: options.signal,
    })
    return { items: (data.issues ?? []).map(issue => this.mapIssue(issue)) }
  }

  async getIssue(key: string, signal?: AbortSignal): Promise<JiraIssueDetail> {
    const data = await this.request<RawIssue>(`/issue/${encodeURIComponent(key)}`, { signal })
    return {
      ...this.mapIssue(data),
      description: adfText(data.fields.description),
    }
  }

  async createIssue(input: {
    projectKey: string
    summary: string
    issueType: string
    description?: string
    labels?: string[]
    priority?: string
    assigneeAccountId?: string
    signal?: AbortSignal
  }): Promise<JiraIssueWriteResult> {
    try {
      const fields: Record<string, unknown> = {
        project: { key: input.projectKey },
        summary: input.summary,
        issuetype: { name: input.issueType },
        labels: input.labels ?? [],
      }
      if (input.description !== undefined) fields.description = adfDescription(input.description)
      if (input.priority !== undefined) fields.priority = { name: input.priority }
      if (input.assigneeAccountId !== undefined) fields.assignee = { accountId: input.assigneeAccountId }
      const data = await this.request<{ id: string; key: string }>('/issue', {
        method: 'POST',
        body: { fields },
        signal: input.signal,
      })
      return { created: true, id: data.id, key: data.key }
    } catch (error) {
      if (error instanceof JiraError && (error.status === 400 || error.status === 404 || error.status === 422)) {
        return { created: false, reason: 'Could not create the Jira issue (project, issue type, field value, or permission invalid).' }
      }
      throw error
    }
  }

  async updateIssue(key: string, input: {
    summary?: string
    description?: string
    labels?: string[]
    priority?: string
    assigneeAccountId?: string
    signal?: AbortSignal
  }): Promise<JiraWriteResult> {
    try {
      const fields: Record<string, unknown> = {}
      if (input.summary !== undefined) fields.summary = input.summary
      if (input.description !== undefined) fields.description = adfDescription(input.description)
      if (input.labels !== undefined) fields.labels = input.labels
      if (input.priority !== undefined) fields.priority = { name: input.priority }
      if (input.assigneeAccountId !== undefined) fields.assignee = { accountId: input.assigneeAccountId }
      await this.request<unknown>(`/issue/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: { fields },
        signal: input.signal,
      })
      return { ok: true }
    } catch (error) {
      if (error instanceof JiraError && (error.status === 400 || error.status === 404 || error.status === 422)) {
        return { ok: false, reason: 'Could not update the Jira issue (not found, field value invalid, or permission denied).' }
      }
      throw error
    }
  }

  async addIssueComment(key: string, body: string, signal?: AbortSignal): Promise<JiraCommentWriteResult> {
    try {
      const data = await this.request<{ id: string }>(`/issue/${encodeURIComponent(key)}/comment`, {
        method: 'POST',
        body: { body: adfDescription(body) },
        signal,
      })
      return { ok: true, commentId: data.id }
    } catch (error) {
      if (error instanceof JiraError && (error.status === 400 || error.status === 404 || error.status === 422)) {
        return { ok: false, reason: 'Could not add the Jira comment (issue not found or comment invalid).' }
      }
      throw error
    }
  }

  async listIssueComments(key: string, options: { maxResults?: number; signal?: AbortSignal } = {}): Promise<JiraCommentListResult> {
    const maxResults = options.maxResults === undefined ? 20 : Math.max(1, Math.min(options.maxResults, 100))
    const data = await this.request<{
      total: number
      comments: Array<{
        id: string
        author: { displayName?: string }
        created: string
        updated: string
        body: string
        self: string
      }>
    }>(`/issue/${encodeURIComponent(key)}/comment?maxResults=${maxResults}`, { signal: options.signal })
    return {
      total: data.total,
      items: (data.comments ?? []).map(comment => ({
        id: comment.id,
        author: comment.author?.displayName ?? '',
        createdAt: comment.created,
        updatedAt: comment.updated,
        body: adfText(comment.body),
        url: comment.self,
      })).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    }
  }

  async listTransitions(key: string, signal?: AbortSignal): Promise<JiraTransitionListResult> {
    const data = await this.request<{
      transitions: Array<{ id: string; name: string; to: { name?: string } }>
    }>(`/issue/${encodeURIComponent(key)}/transitions`, { signal })
    return {
      transitions: (data.transitions ?? []).map(transition => ({
        id: transition.id,
        name: transition.name,
        to: transition.to?.name ?? '',
      })),
    }
  }

  async transitionIssue(key: string, transitionId: string, signal?: AbortSignal): Promise<JiraTransitionWriteResult> {
    try {
      await this.request<unknown>(`/issue/${encodeURIComponent(key)}/transitions`, {
        method: 'POST',
        body: { transition: { id: transitionId } },
        signal,
      })
      return { ok: true }
    } catch (error) {
      if (error instanceof JiraError && (error.status === 400 || error.status === 404 || error.status === 422)) {
        return { ok: false, reason: 'Could not transition the Jira issue (issue not found or transition invalid).' }
      }
      throw error
    }
  }

  async listProjects(options: { maxResults?: number; signal?: AbortSignal } = {}): Promise<JiraProjectItem[]> {
    const maxResults = options.maxResults === undefined ? 50 : Math.max(1, Math.min(options.maxResults, 100))
    const data = await this.request<{
      values: Array<{
        id: string
        key: string
        name: string
        projectTypeKey?: string
        style?: string | null
      }>
    }>(`/project/search?maxResults=${maxResults}`, { signal: options.signal })
    return (data.values ?? []).map(project => ({
      id: project.id,
      key: project.key,
      name: project.name,
      projectTypeKey: project.projectTypeKey ?? '',
      style: project.style ?? null,
      url: this.projectUrl(project.key),
    }))
  }

  async getProject(key: string, signal?: AbortSignal): Promise<JiraProjectDetail> {
    const data = await this.request<{
      id: string
      key: string
      name: string
      description?: string | null
      projectTypeKey?: string
      style?: string | null
      lead?: { displayName?: string } | null
      archived?: boolean | null
    }>(`/project/${encodeURIComponent(key)}`, { signal })
    return {
      id: data.id,
      key: data.key,
      name: data.name,
      description: data.description ?? '',
      projectTypeKey: data.projectTypeKey ?? '',
      style: data.style ?? null,
      lead: data.lead?.displayName ?? null,
      archived: data.archived ?? null,
      url: this.projectUrl(data.key),
    }
  }

  private mapUser(value: {
    accountId?: string
    displayName?: string
    emailAddress?: string
    active?: boolean
    accountType?: string
    timeZone?: string
    self?: string
  }): JiraUserItem {
    return {
      accountId: value.accountId ?? '',
      displayName: value.displayName ?? '',
      emailAddress: value.emailAddress ?? '',
      active: value.active ?? false,
      accountType: value.accountType ?? '',
      timeZone: value.timeZone ?? '',
      url: value.self ?? '',
    }
  }

  async listIssueTypes(signal?: AbortSignal): Promise<JiraIssueTypeItem[]> {
    const data = await this.request<Array<{
      id: string
      name?: string
      description?: string
      subtask?: boolean
      iconUrl?: string
    }>>('/issuetype', { signal })
    return data.map(item => ({
      id: item.id,
      name: item.name ?? '',
      description: item.description ?? '',
      subtask: item.subtask ?? false,
      iconUrl: item.iconUrl ?? '',
    }))
  }

  async listPriorities(signal?: AbortSignal): Promise<JiraPriorityItem[]> {
    const data = await this.request<Array<{
      id: string
      name?: string
      description?: string
      statusColor?: string
      iconUrl?: string
    }>>('/priority', { signal })
    return data.map(item => ({
      id: item.id,
      name: item.name ?? '',
      description: item.description ?? '',
      statusColor: item.statusColor ?? '',
      iconUrl: item.iconUrl ?? '',
    }))
  }

  async searchUsers(query: string = '', options: { maxResults?: number; signal?: AbortSignal } = {}): Promise<JiraUserItem[]> {
    const maxResults = options.maxResults === undefined ? 50 : Math.max(1, Math.min(options.maxResults, 100))
    const params = new URLSearchParams()
    if (query) params.set('query', query)
    params.set('maxResults', String(maxResults))
    const data = await this.request<Array<{
      accountId?: string
      displayName?: string
      emailAddress?: string
      active?: boolean
      accountType?: string
      timeZone?: string
      self?: string
    }>>(`/user/search?${params.toString()}`, { signal: options.signal })
    return data.map(user => this.mapUser(user))
  }

  async getUser(accountId: string, signal?: AbortSignal): Promise<JiraUserItem> {
    const data = await this.request<{
      accountId?: string
      displayName?: string
      emailAddress?: string
      active?: boolean
      accountType?: string
      timeZone?: string
      self?: string
    }>(`/user?accountId=${encodeURIComponent(accountId)}`, { signal })
    return this.mapUser(data)
  }
}
