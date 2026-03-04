import * as net from 'net'
import { BrowserWindow } from 'electron'
import { getTelnetConnection, updateTelnetConnection } from './telnet-config'

// Telnet Session Interface
export interface TelnetSession {
  id: string
  connectionId: string
  socket: net.Socket | null
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  error?: string
  connectedAt?: number
  bytesReceived: number
  bytesSent: number
  outputSeq: number
  outputBuffer: { seq: number; data: Buffer }[]
  outputBufferSize: number
  reconnectAttempts: number
  reconnectTimer: NodeJS.Timeout | null
}

// Session storage
const telnetSessions = new Map<string, TelnetSession>()
let nextSessionId = 1

const MAX_OUTPUT_BUFFER_BYTES = 512 * 1024 // 512KB

// Broadcast to renderer
function broadcastToRenderer(channel: string, data: unknown): void {
  const wins = BrowserWindow.getAllWindows()
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

// Record output to session buffer
function recordOutput(session: TelnetSession, data: Buffer): void {
  session.outputSeq += 1
  const seq = session.outputSeq
  const chunk = Buffer.from(data)

  session.outputBuffer.push({ seq, data: chunk })
  session.outputBufferSize += chunk.length

  while (session.outputBufferSize > MAX_OUTPUT_BUFFER_BYTES && session.outputBuffer.length > 1) {
    const removed = session.outputBuffer.shift()
    if (!removed) break
    session.outputBufferSize -= removed.data.length
  }

  broadcastToRenderer('telnet:output', {
    sessionId: session.id,
    data: Array.from(chunk),
    seq,
  })
}

// Handle socket data
function handleData(session: TelnetSession, data: Buffer): void {
  session.bytesReceived += data.length
  recordOutput(session, data)
}

// Handle socket close
function handleClose(session: TelnetSession, hadError: boolean): void {
  const connection = getTelnetConnection(session.connectionId)

  // Check if reconnect is enabled
  if (
    connection?.reconnect &&
    session.reconnectAttempts < (connection.reconnectAttempts ?? 3) &&
    session.status === 'connected'
  ) {
    session.reconnectAttempts++
    session.status = 'connecting'

    broadcastToRenderer('telnet:status', {
      sessionId: session.id,
      connectionId: session.connectionId,
      status: 'connecting',
      error: `Connection lost. Reconnecting (${session.reconnectAttempts}/${connection.reconnectAttempts})...`,
    })

    const interval = connection.reconnectInterval ?? 3000
    session.reconnectTimer = setTimeout(() => {
      if (session.status === 'connecting') {
        connectToHost(session.connectionId, session.id).catch((err) => {
          console.error('[Telnet] Reconnect failed:', err)
        })
      }
    }, interval)
    return
  }

  session.status = 'disconnected'
  session.socket = null

  broadcastToRenderer('telnet:status', {
    sessionId: session.id,
    connectionId: session.connectionId,
    status: 'disconnected',
    error: hadError ? 'Connection closed due to error' : 'Connection closed',
  })
}

// Handle socket error
function handleError(session: TelnetSession, err: Error): void {
  session.status = 'error'
  session.error = err.message

  broadcastToRenderer('telnet:status', {
    sessionId: session.id,
    connectionId: session.connectionId,
    status: 'error',
    error: err.message,
  })
}

// Connect to telnet host
export async function connectToHost(
  connectionId: string,
  existingSessionId?: string
): Promise<{ sessionId: string; error?: string }> {
  const connection = getTelnetConnection(connectionId)
  if (!connection) {
    return { sessionId: '', error: 'Connection not found' }
  }

  const sessionId = existingSessionId || `telnet-${nextSessionId++}`

  let session = telnetSessions.get(sessionId)
  if (!session) {
    session = {
      id: sessionId,
      connectionId,
      socket: null,
      status: 'connecting',
      bytesReceived: 0,
      bytesSent: 0,
      outputSeq: 0,
      outputBuffer: [],
      outputBufferSize: 0,
      reconnectAttempts: 0,
      reconnectTimer: null,
    }
    telnetSessions.set(sessionId, session)
  } else {
    // Clean up existing socket
    if (session.socket) {
      session.socket.destroy()
      session.socket = null
    }
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer)
      session.reconnectTimer = null
    }
    session.status = 'connecting'
    session.bytesReceived = 0
    session.bytesSent = 0
    session.outputSeq = 0
    session.outputBuffer = []
    session.outputBufferSize = 0
    session.reconnectAttempts = 0
  }

  broadcastToRenderer('telnet:status', {
    sessionId,
    connectionId,
    status: 'connecting',
  })

  return new Promise((resolve) => {
    const socket = new net.Socket()
    session!.socket = socket

    let resolved = false
    const doResolve = (result: { sessionId: string; error?: string }) => {
      if (resolved) return
      resolved = true
      resolve(result)
    }

    const timeout = connection.timeout ?? 10000

    const connectTimer = setTimeout(() => {
      socket.destroy()
      session!.status = 'error'
      session!.error = 'Connection timeout'
      broadcastToRenderer('telnet:status', {
        sessionId,
        connectionId,
        status: 'error',
        error: 'Connection timeout',
      })
      doResolve({ sessionId, error: 'Connection timeout' })
    }, timeout)

    // Use 'connect' event instead of callback for reliability
    socket.on('connect', () => {
      clearTimeout(connectTimer)
      session!.status = 'connected'
      session!.connectedAt = Date.now()
      session!.reconnectAttempts = 0

      // Update last connected time
      updateTelnetConnection(connectionId, {
        lastConnectedAt: Date.now(),
        updatedAt: Date.now(),
      })

      broadcastToRenderer('telnet:status', {
        sessionId,
        connectionId,
        status: 'connected',
      })

      doResolve({ sessionId })
    })

    socket.on('data', (data: Buffer) => {
      handleData(session!, data)
    })

    socket.on('close', (hadError: boolean) => {
      handleClose(session!, hadError)
    })

    socket.on('error', (err: Error) => {
      clearTimeout(connectTimer)
      // Resolve the promise BEFORE handleError changes the status
      if (session!.status === 'connecting') {
        doResolve({ sessionId, error: err.message })
      }
      handleError(session!, err)
    })

    socket.on('timeout', () => {
      socket.destroy()
      session!.status = 'error'
      session!.error = 'Connection timeout'
      broadcastToRenderer('telnet:status', {
        sessionId,
        connectionId,
        status: 'error',
        error: 'Connection timeout',
      })
      doResolve({ sessionId, error: 'Connection timeout' })
    })

    // Start the connection
    socket.connect(connection.port, connection.host)
  })
}

// Disconnect session
export function disconnectSession(sessionId: string): { success: boolean; error?: string } {
  const session = telnetSessions.get(sessionId)
  if (!session) {
    return { success: false, error: 'Session not found' }
  }

  // Cancel any pending reconnect
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer)
    session.reconnectTimer = null
  }

  session.status = 'disconnected'

  if (session.socket) {
    session.socket.destroy()
    session.socket = null
  }

  broadcastToRenderer('telnet:status', {
    sessionId,
    connectionId: session.connectionId,
    status: 'disconnected',
  })

  telnetSessions.delete(sessionId)

  return { success: true }
}

// Send data to session
export function sendData(sessionId: string, data: string): { success: boolean; error?: string } {
  const session = telnetSessions.get(sessionId)
  if (!session || !session.socket || session.status !== 'connected') {
    return { success: false, error: 'Session not connected' }
  }

  try {
    const buffer = Buffer.from(data + '\r\n', 'utf8')
    session.socket.write(buffer)
    session.bytesSent += buffer.length

    return { success: true }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

// Get session info
export function getSession(sessionId: string): TelnetSession | undefined {
  return telnetSessions.get(sessionId)
}

// List all sessions
export function listSessions(): Array<{
  id: string
  connectionId: string
  status: string
  error?: string
  connectedAt?: number
  bytesReceived: number
  bytesSent: number
}> {
  const list: Array<{
    id: string
    connectionId: string
    status: string
    error?: string
    connectedAt?: number
    bytesReceived: number
    bytesSent: number
  }> = []

  for (const session of telnetSessions.values()) {
    list.push({
      id: session.id,
      connectionId: session.connectionId,
      status: session.status,
      error: session.error,
      connectedAt: session.connectedAt,
      bytesReceived: session.bytesReceived,
      bytesSent: session.bytesSent,
    })
  }

  return list
}

// Get output buffer
export function getOutputBuffer(
  sessionId: string,
  sinceSeq?: number
): { lastSeq: number; chunks: number[][] } | { error: string } {
  const session = telnetSessions.get(sessionId)
  if (!session) {
    return { error: 'Session not found' }
  }

  const since = sinceSeq ?? 0
  const chunks = session.outputBuffer
    .filter((entry) => entry.seq > since)
    .map((entry) => Array.from(entry.data))

  return {
    lastSeq: session.outputSeq,
    chunks,
  }
}

// Close all sessions (cleanup)
export function closeAllTelnetSessions(): void {
  for (const session of telnetSessions.values()) {
    if (session.reconnectTimer) {
      clearTimeout(session.reconnectTimer)
    }
    if (session.socket) {
      session.socket.destroy()
    }
  }
  telnetSessions.clear()
}
