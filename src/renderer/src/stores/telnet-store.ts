import { create } from 'zustand'
import { ipcClient } from '../lib/ipc/ipc-client'
import { IPC } from '../lib/ipc/channels'

// ── Types ──

export interface TelnetConnection {
  id: string
  name: string
  host: string
  port: number
  username: string | null
  password: string | null
  reconnect: boolean
  reconnectAttempts: number
  reconnectInterval: number
  timeout: number
  sortOrder: number
  lastConnectedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface TelnetSession {
  id: string
  connectionId: string
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
  connectedAt?: number
  bytesReceived: number
  bytesSent: number
}

export interface TelnetTab {
  id: string
  sessionId: string | null
  connectionId: string
  connectionName: string
  title: string
  status?: 'connecting' | 'connected' | 'error'
  error?: string
}

// ── Row Types (from IPC) ──

interface TelnetConnectionRow {
  id: string
  name: string
  host: string
  port: number
  username: string | null
  password: string | null
  reconnect: boolean
  reconnect_attempts: number
  reconnect_interval: number
  timeout: number
  sort_order: number
  last_connected_at: number | null
  created_at: number
  updated_at: number
}

function rowToConnection(row: TelnetConnectionRow): TelnetConnection {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    password: row.password,
    reconnect: row.reconnect,
    reconnectAttempts: row.reconnect_attempts,
    reconnectInterval: row.reconnect_interval,
    timeout: row.timeout,
    sortOrder: row.sort_order,
    lastConnectedAt: row.last_connected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ── Store ──

interface TelnetStore {
  connections: TelnetConnection[]
  sessions: Record<string, TelnetSession>
  activeTabId: string | null
  selectedConnectionId: string | null
  _loaded: boolean

  // Tab management
  openTabs: TelnetTab[]
  activeTabId2: string | null

  // Data loading
  loadAll: () => Promise<void>

  // Connection CRUD
  createConnection: (data: {
    name: string
    host: string
    port?: number
    username?: string
    password?: string
    reconnect?: boolean
    reconnectAttempts?: number
    reconnectInterval?: number
    timeout?: number
  }) => Promise<string>
  updateConnection: (
    id: string,
    data: {
      name?: string
      host?: string
      port?: number
      username?: string | null
      password?: string | null
      reconnect?: boolean
      reconnectAttempts?: number
      reconnectInterval?: number
      timeout?: number
    }
  ) => Promise<void>
  deleteConnection: (id: string) => Promise<void>
  testConnection: (id: string) => Promise<{ success: boolean; error?: string }>

  // Terminal sessions
  connect: (connectionId: string) => Promise<string | null>
  disconnect: (sessionId: string) => Promise<void>
  setActiveTab: (tabId: string | null) => void
  setSelectedConnection: (connectionId: string | null) => void
  updateSessionStatus: (
    sessionId: string,
    status: TelnetSession['status'],
    error?: string
  ) => void
  removeSession: (sessionId: string) => void

  // Tab management
  openTab: (tab: TelnetTab) => void
  closeTab: (tabId: string) => void
}

export const useTelnetStore = create<TelnetStore>()((set, get) => ({
  connections: [],
  sessions: {},
  activeTabId: null,
  selectedConnectionId: null,
  _loaded: false,

  openTabs: [],
  activeTabId2: null,

  loadAll: async () => {
    try {
      const [connRows, sessionRows] = await Promise.all([
        ipcClient.invoke(IPC.TELNET_CONNECTION_LIST) as Promise<
          TelnetConnectionRow[] | { error: string }
        >,
        ipcClient.invoke(IPC.TELNET_SESSION_LIST) as Promise<
          { id: string; connectionId: string; status: string; error?: string }[] | { error: string }
        >,
      ])

      const connections = Array.isArray(connRows)
        ? connRows.map(rowToConnection)
        : []

      const sessions = Array.isArray(sessionRows)
        ? sessionRows.reduce<Record<string, TelnetSession>>((acc, row) => {
            acc[row.id] = {
              id: row.id,
              connectionId: row.connectionId,
              status: row.status as TelnetSession['status'],
              error: row.error,
              bytesReceived: 0,
              bytesSent: 0,
            }
            return acc
          }, {})
        : {}

      set({ connections, sessions, _loaded: true })
    } catch (err) {
      console.error('[TelnetStore] Failed to load:', err)
      set({ _loaded: true })
    }
  },

  // ── Connection CRUD ──

  createConnection: async (data) => {
    const id = `telnet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const maxOrder = Math.max(0, ...get().connections.map((c) => c.sortOrder))
    await ipcClient.invoke(IPC.TELNET_CONNECTION_CREATE, {
      id,
      name: data.name,
      host: data.host,
      port: data.port ?? 23,
      username: data.username,
      password: data.password,
      reconnect: data.reconnect ?? true,
      reconnectAttempts: data.reconnectAttempts ?? 3,
      reconnectInterval: data.reconnectInterval ?? 3000,
      timeout: data.timeout ?? 10000,
      sortOrder: maxOrder + 1,
    })
    const now = Date.now()
    set((s) => ({
      connections: [
        ...s.connections,
        {
          id,
          name: data.name,
          host: data.host,
          port: data.port ?? 23,
          username: data.username ?? null,
          password: data.password ?? null,
          reconnect: data.reconnect ?? true,
          reconnectAttempts: data.reconnectAttempts ?? 3,
          reconnectInterval: data.reconnectInterval ?? 3000,
          timeout: data.timeout ?? 10000,
          sortOrder: maxOrder + 1,
          lastConnectedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
    }))
    return id
  },

  updateConnection: async (id, data) => {
    await ipcClient.invoke(IPC.TELNET_CONNECTION_UPDATE, { id, ...data })
    set((s) => ({
      connections: s.connections.map((c) => {
        if (c.id !== id) return c
        return { ...c, ...data, updatedAt: Date.now() }
      }),
    }))
  },

  deleteConnection: async (id) => {
    await ipcClient.invoke(IPC.TELNET_CONNECTION_DELETE, { id })
    set((s) => ({
      connections: s.connections.filter((c) => c.id !== id),
      selectedConnectionId:
        s.selectedConnectionId === id ? null : s.selectedConnectionId,
    }))
  },

  testConnection: async (id) => {
    const result = (await ipcClient.invoke(IPC.TELNET_CONNECTION_TEST, {
      id,
    })) as { success: boolean; error?: string }
    return result
  },

  // ── Terminal sessions ──

  connect: async (connectionId) => {
    const result = (await ipcClient.invoke(IPC.TELNET_CONNECT, {
      connectionId,
    })) as { sessionId?: string; error?: string }

    if (result.error || !result.sessionId) {
      return null
    }

    const session: TelnetSession = {
      id: result.sessionId,
      connectionId,
      status: 'connecting',
      bytesReceived: 0,
      bytesSent: 0,
    }

    set((s) => ({
      sessions: { ...s.sessions, [result.sessionId!]: session },
      connections: s.connections.map((c) =>
        c.id === connectionId ? { ...c, lastConnectedAt: Date.now() } : c
      ),
    }))

    return result.sessionId
  },

  disconnect: async (sessionId) => {
    await ipcClient.invoke(IPC.TELNET_DISCONNECT, { sessionId })
    set((s) => {
      const updated = { ...s.sessions }
      delete updated[sessionId]
      const remainingTabs = s.openTabs.filter((t) => t.sessionId !== sessionId)
      return {
        sessions: updated,
        openTabs: remainingTabs,
        activeTabId2:
          s.activeTabId2 &&
          s.openTabs.find((t) => t.id === s.activeTabId2)?.sessionId === sessionId
            ? null
            : s.activeTabId2,
      }
    })
  },

  setActiveTab: (tabId) => set({ activeTabId2: tabId }),

  setSelectedConnection: (connectionId) =>
    set({ selectedConnectionId: connectionId }),

  updateSessionStatus: (sessionId, status, error) => {
    set((s) => {
      const existing = s.sessions[sessionId]
      if (!existing) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...existing, status, error },
        },
      }
    })
  },

  removeSession: (sessionId) => {
    set((s) => {
      const updated = { ...s.sessions }
      delete updated[sessionId]
      return { sessions: updated }
    })
  },

  // ── Tab management ──

  openTab: (tab) => {
    set((s) => {
      const exists = s.openTabs.find((t) => t.id === tab.id)
      if (exists) return { activeTabId2: tab.id }
      return {
        openTabs: [...s.openTabs, tab],
        activeTabId2: tab.id,
      }
    })
  },

  closeTab: (tabId) => {
    set((s) => {
      const idx = s.openTabs.findIndex((t) => t.id === tabId)
      const remaining = s.openTabs.filter((t) => t.id !== tabId)
      const wasActive = s.activeTabId2 === tabId

      return {
        openTabs: remaining,
        activeTabId2: wasActive
          ? remaining[Math.min(idx, remaining.length - 1)]?.id ?? null
          : s.activeTabId2,
      }
    })
  },
}))
