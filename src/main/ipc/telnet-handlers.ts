import { ipcMain, BrowserWindow } from 'electron'
import {
  startTelnetConfigWatcher,
  onTelnetConfigChange,
  listTelnetConnections,
  getTelnetConnection,
  createTelnetConnection,
  updateTelnetConnection,
  deleteTelnetConnection,
  type TelnetConnection,
} from '../telnet/telnet-config'
import {
  connectToHost,
  disconnectSession,
  sendData,
  listSessions,
  getOutputBuffer,
  closeAllTelnetSessions,
} from '../telnet/telnet-session'

// Helper to broadcast to renderer
function broadcastToRenderer(channel: string, data: unknown): void {
  const wins = BrowserWindow.getAllWindows()
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

let telnetConfigWatcherAttached = false

function ensureTelnetConfigWatcher(): void {
  if (telnetConfigWatcherAttached) return
  telnetConfigWatcherAttached = true
  startTelnetConfigWatcher()
  onTelnetConfigChange(() => {
    broadcastToRenderer('telnet:config:changed', {})
  })
}

// Convert to row format (snake_case for DB compatibility)
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

function toConnectionRow(conn: TelnetConnection): TelnetConnectionRow {
  return {
    id: conn.id,
    name: conn.name,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password: conn.password,
    reconnect: conn.reconnect,
    reconnect_attempts: conn.reconnectAttempts,
    reconnect_interval: conn.reconnectInterval,
    timeout: conn.timeout,
    sort_order: conn.sortOrder,
    last_connected_at: conn.lastConnectedAt,
    created_at: conn.createdAt,
    updated_at: conn.updatedAt,
  }
}

export function registerTelnetHandlers(): void {
  ensureTelnetConfigWatcher()

  // ── Connection CRUD ──

  ipcMain.handle('telnet:connection:list', async () => {
    try {
      return listTelnetConnections().map(toConnectionRow)
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(
    'telnet:connection:create',
    async (
      _event,
      args: {
        id: string
        name: string
        host: string
        port?: number
        username?: string
        password?: string
        reconnect?: boolean
        reconnectAttempts?: number
        reconnectInterval?: number
        timeout?: number
        sortOrder?: number
      }
    ) => {
      try {
        const now = Date.now()
        const connection: TelnetConnection = {
          id: args.id,
          name: args.name,
          host: args.host,
          port: args.port ?? 23,
          username: args.username ?? null,
          password: args.password ?? null,
          reconnect: args.reconnect ?? true,
          reconnectAttempts: args.reconnectAttempts ?? 3,
          reconnectInterval: args.reconnectInterval ?? 3000,
          timeout: args.timeout ?? 10000,
          sortOrder: args.sortOrder ?? 0,
          lastConnectedAt: null,
          createdAt: now,
          updatedAt: now,
        }
        createTelnetConnection(connection)
        return { success: true }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  ipcMain.handle(
    'telnet:connection:update',
    async (
      _event,
      args: {
        id: string
        name?: string
        host?: string
        port?: number
        username?: string | null
        password?: string | null
        reconnect?: boolean
        reconnectAttempts?: number
        reconnectInterval?: number
        timeout?: number
        sortOrder?: number
      }
    ) => {
      try {
        const patch: Partial<Omit<TelnetConnection, 'id'>> = { updatedAt: Date.now() }
        if (args.name !== undefined) patch.name = args.name
        if (args.host !== undefined) patch.host = args.host
        if (args.port !== undefined) patch.port = args.port
        if (args.username !== undefined) patch.username = args.username
        if (args.password !== undefined) patch.password = args.password
        if (args.reconnect !== undefined) patch.reconnect = args.reconnect
        if (args.reconnectAttempts !== undefined) patch.reconnectAttempts = args.reconnectAttempts
        if (args.reconnectInterval !== undefined) patch.reconnectInterval = args.reconnectInterval
        if (args.timeout !== undefined) patch.timeout = args.timeout
        if (args.sortOrder !== undefined) patch.sortOrder = args.sortOrder

        updateTelnetConnection(args.id, patch)
        return { success: true }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  ipcMain.handle('telnet:connection:delete', async (_event, args: { id: string }) => {
    try {
      // Disconnect any active sessions for this connection
      const sessions = listSessions()
      for (const session of sessions) {
        if (session.connectionId === args.id) {
          disconnectSession(session.id)
        }
      }
      deleteTelnetConnection(args.id)
      return { success: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── Test Connection ──

  ipcMain.handle('telnet:connection:test', async (_event, args: { id: string }) => {
    try {
      const connection = getTelnetConnection(args.id)
      if (!connection) return { success: false, error: 'Connection not found' }

      return new Promise((resolve) => {
        const net = require('net')
        const socket = new net.Socket()
        let resolved = false
        const doResolve = (result: { success: boolean; error?: string }) => {
          if (resolved) return
          resolved = true
          socket.destroy()
          resolve(result)
        }

        const timeout = setTimeout(() => {
          doResolve({ success: false, error: 'Connection timeout' })
        }, connection.timeout ?? 10000)

        socket.on('connect', () => {
          clearTimeout(timeout)
          doResolve({ success: true })
        })

        socket.on('error', (err: Error) => {
          clearTimeout(timeout)
          doResolve({ success: false, error: err.message })
        })

        socket.on('close', () => {
          clearTimeout(timeout)
          if (!resolved) {
            doResolve({ success: false, error: 'Connection closed' })
          }
        })

        socket.connect(connection.port, connection.host)
      })
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── Connect ──

  ipcMain.handle('telnet:connect', async (_event, args: { connectionId: string }) => {
    try {
      const result = await connectToHost(args.connectionId)
      return result
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── Disconnect ──

  ipcMain.handle('telnet:disconnect', async (_event, args: { sessionId: string }) => {
    try {
      return disconnectSession(args.sessionId)
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── Send Data ──

  ipcMain.on('telnet:data', (_event, args: { sessionId: string; data: string }) => {
    const result = sendData(args.sessionId, args.data)
    if (!result.success) {
      broadcastToRenderer('telnet:status', {
        sessionId: args.sessionId,
        status: 'error',
        error: result.error,
      })
    }
  })

  // ── List Sessions ──

  ipcMain.handle('telnet:session:list', async () => {
    try {
      return listSessions()
    } catch (err) {
      return { error: String(err) }
    }
  })

  // ── Output Buffer ──

  ipcMain.handle(
    'telnet:output:buffer',
    async (_event, args: { sessionId: string; sinceSeq?: number }) => {
      try {
        return getOutputBuffer(args.sessionId, args.sinceSeq)
      } catch (err) {
        return { error: String(err) }
      }
    }
  )
}

// Cleanup function
export function unregisterTelnetHandlers(): void {
  closeAllTelnetSessions()
}
