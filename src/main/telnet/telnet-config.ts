import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

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

export interface TelnetConfigData {
  connections: TelnetConnection[]
}

type TelnetConfigListener = (data: TelnetConfigData) => void

const CONFIG_PATH = path.join(os.homedir(), '.open-cowork.json')
const EMPTY_CONFIG: TelnetConfigData = { connections: [] }

let cachedConfig: TelnetConfigData = EMPTY_CONFIG
let lastSerialized = JSON.stringify(EMPTY_CONFIG)
let lastGoodConfig: TelnetConfigData = EMPTY_CONFIG
let watcherStarted = false
let reloadTimer: NodeJS.Timeout | null = null
const listeners = new Set<TelnetConfigListener>()

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function toString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function normalizeConnection(raw: unknown): TelnetConnection | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  const id = toString(value.id)
  const name = toString(value.name)
  const host = toString(value.host)
  if (!id || !name || !host) return null
  const createdAt = toNumber(value.createdAt, Date.now())
  const updatedAt = toNumber(value.updatedAt, createdAt)

  return {
    id,
    name,
    host,
    port: toNumber(value.port, 23),
    username: toString(value.username),
    password: toString(value.password),
    reconnect: value.reconnect === true,
    reconnectAttempts: toNumber(value.reconnectAttempts, 3),
    reconnectInterval: toNumber(value.reconnectInterval, 3000),
    timeout: toNumber(value.timeout, 10000),
    sortOrder: toNumber(value.sortOrder, 0),
    lastConnectedAt: typeof value.lastConnectedAt === 'number' ? value.lastConnectedAt : null,
    createdAt,
    updatedAt,
  }
}

function normalizeConfig(raw: unknown): TelnetConfigData {
  const telnet =
    raw && typeof raw === 'object' && 'telnet' in raw
      ? (raw as { telnet?: { connections?: unknown[] } }).telnet
      : undefined

  const connectionsRaw = Array.isArray(telnet?.connections) ? telnet?.connections ?? [] : []

  const connections: TelnetConnection[] = []
  const connectionIds = new Set<string>()
  for (const item of connectionsRaw) {
    const connection = normalizeConnection(item)
    if (!connection || connectionIds.has(connection.id)) continue
    connectionIds.add(connection.id)
    connections.push(connection)
  }

  return { connections }
}

function readRawConfig(): Record<string, unknown> {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {}
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    if (!raw.trim()) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, unknown>
  } catch (err) {
    console.error('[Telnet Config] Failed to read:', err)
    return {}
  }
}

function readConfigFromDisk(): TelnetConfigData {
  if (!fs.existsSync(CONFIG_PATH)) {
    lastGoodConfig = EMPTY_CONFIG
    return EMPTY_CONFIG
  }
  try {
    const raw = readRawConfig()
    const normalized = normalizeConfig(raw)
    lastGoodConfig = normalized
    return normalized
  } catch (err) {
    console.error('[Telnet Config] Failed to parse:', err)
    return lastGoodConfig
  }
}

function writeConfigToDisk(data: TelnetConfigData): void {
  const raw = readRawConfig()
  const next = { ...raw, telnet: { connections: data.connections } }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf-8')
}

function setCache(next: TelnetConfigData, notify: boolean): void {
  const serialized = JSON.stringify(next)
  cachedConfig = next
  if (serialized === lastSerialized) return
  lastSerialized = serialized
  if (!notify) return
  listeners.forEach((listener) => listener(next))
}

function scheduleReload(): void {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    const next = readConfigFromDisk()
    setCache(next, true)
  }, 200)
}

export function startTelnetConfigWatcher(): void {
  if (watcherStarted) return
  watcherStarted = true
  fs.watchFile(CONFIG_PATH, { interval: 1000 }, () => {
    scheduleReload()
  })
}

export function onTelnetConfigChange(listener: TelnetConfigListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getTelnetConfigPath(): string {
  return CONFIG_PATH
}

export function getTelnetConfigSnapshot(): TelnetConfigData {
  if (lastSerialized === JSON.stringify(EMPTY_CONFIG) && cachedConfig === EMPTY_CONFIG) {
    const next = readConfigFromDisk()
    setCache(next, false)
  }
  return cachedConfig
}

export function listTelnetConnections(): TelnetConnection[] {
  return getTelnetConfigSnapshot().connections
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

export function getTelnetConnection(id: string): TelnetConnection | undefined {
  return getTelnetConfigSnapshot().connections.find((c) => c.id === id)
}

export function createTelnetConnection(connection: TelnetConnection): void {
  updateTelnetConfig((current) => {
    const connections = current.connections.filter((c) => c.id !== connection.id)
    connections.push(connection)
    return { ...current, connections }
  })
}

export function updateTelnetConnection(
  id: string,
  patch: Partial<Omit<TelnetConnection, 'id'>>
): void {
  updateTelnetConfig((current) => ({
    ...current,
    connections: current.connections.map((conn) => {
      if (conn.id !== id) return conn
      return {
        ...conn,
        ...patch,
        updatedAt: patch.updatedAt ?? conn.updatedAt,
      }
    }),
  }))
}

export function deleteTelnetConnection(id: string): void {
  updateTelnetConfig((current) => ({
    ...current,
    connections: current.connections.filter((conn) => conn.id !== id),
  }))
}

function updateTelnetConfig(updater: (current: TelnetConfigData) => TelnetConfigData): void {
  const current = readConfigFromDisk()
  const next = updater(current)
  writeConfigToDisk(next)
  setCache(next, true)
}
