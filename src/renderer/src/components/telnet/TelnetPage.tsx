import { useEffect, useCallback, useRef, useState } from 'react'
import {
  X,
  Plus,
  ArrowLeft,
  Loader2,
  Network
} from 'lucide-react'
import { useTelnetStore, type TelnetTab } from '@renderer/stores/telnet-store'
import { Button } from '@renderer/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter
} from '@renderer/components/ui/sheet'
import { Input } from '@renderer/components/ui/input'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { cn } from '@renderer/lib/utils'
import { toast } from 'sonner'
import { TelnetConnectionList } from './TelnetConnectionList'
import { TelnetTerminal } from './TelnetTerminal'

// Label component inline (since @renderer/components/ui/label doesn't exist)
const Label = ({ children, className, htmlFor }: { children?: React.ReactNode; className?: string; htmlFor?: string }) => (
  <label className={className} htmlFor={htmlFor}>{children}</label>
)

export function TelnetPage(): React.JSX.Element {
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingConnection, setEditingConnection] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    port: '23',
    username: '',
    password: '',
    reconnect: true,
    reconnectAttempts: '3',
    reconnectInterval: '3000',
    timeout: '10000'
  })

  const openTabs = useTelnetStore((s) => s.openTabs)
  const activeTabId = useTelnetStore((s) => s.activeTabId2)
  const sessions = useTelnetStore((s) => s.sessions)
  const loadAll = useTelnetStore((s) => s.loadAll)
  const _loaded = useTelnetStore((s) => s._loaded)

  // Track which tabs have been mounted
  const mountedTabsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!_loaded) void loadAll()
  }, [_loaded, loadAll])

  // Listen for Telnet status events
  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on(
      'telnet:status',
      (
        _event: unknown,
        data: { sessionId: string; connectionId: string; status: string; error?: string }
      ) => {
        const store = useTelnetStore.getState()
        if (data.status === 'disconnected') {
          store.removeSession(data.sessionId)
        } else {
          store.updateSessionStatus(
            data.sessionId,
            data.status as 'connecting' | 'connected' | 'disconnected' | 'error',
            data.error
          )
        }
      }
    )
    return () => {
      cleanup()
    }
  }, [])

  const handleConnect = useCallback(
    async (connectionId: string) => {
      const store = useTelnetStore.getState()
      const conn = store.connections.find((c) => c.id === connectionId)
      if (!conn) return

      // If a terminal tab is already open, just focus it
      const existingTab = store.openTabs.find((tab) => tab.connectionId === connectionId)
      if (existingTab) {
        store.setActiveTab(existingTab.id)
        return
      }

      // If already connected, reuse the existing session
      const existingSession = Object.values(store.sessions).find(
        (session) => session.connectionId === connectionId && session.status === 'connected'
      )
      if (existingSession) {
        const tabId = `tab-${existingSession.id}`
        store.openTab({
          id: tabId,
          sessionId: existingSession.id,
          connectionId,
          connectionName: conn.name,
          title: conn.name
        })
        return
      }

      const pendingTabId = `pending-${connectionId}-${Date.now()}`
      store.openTab({
        id: pendingTabId,
        sessionId: null,
        connectionId,
        connectionName: conn.name,
        title: conn.name,
        status: 'connecting'
      })

      const sessionId = await store.connect(connectionId)
      if (!sessionId) {
        store.closeTab(pendingTabId)
        toast.error('连接失败')
        return
      }

      const stillOpen = useTelnetStore.getState().openTabs.find((tab) => tab.id === pendingTabId)
      if (!stillOpen) {
        await store.disconnect(sessionId)
        return
      }

      const resolvedTabId = `tab-${sessionId}`
      const tab: TelnetTab = {
        id: resolvedTabId,
        sessionId,
        connectionId,
        connectionName: conn.name,
        title: conn.name
      }
      store.openTab(tab)
      store.closeTab(pendingTabId)
    },
    []
  )

  const handleCloseTab = useCallback((tabId: string) => {
    mountedTabsRef.current.delete(tabId)
    const store = useTelnetStore.getState()
    const tab = store.openTabs.find((t) => t.id === tabId)
    if (tab?.sessionId) {
      store.disconnect(tab.sessionId)
    }
    store.closeTab(tabId)
  }, [])

  const handleBackToList = useCallback(() => {
    useTelnetStore.getState().setActiveTab(null)
  }, [])

  const handleSaveConnection = useCallback(async () => {
    const store = useTelnetStore.getState()
    if (editingConnection) {
      await store.updateConnection(editingConnection, {
        name: formData.name,
        host: formData.host,
        port: parseInt(formData.port, 10),
        username: formData.username || null,
        password: formData.password || null,
        reconnect: formData.reconnect,
        reconnectAttempts: parseInt(formData.reconnectAttempts, 10),
        reconnectInterval: parseInt(formData.reconnectInterval, 10),
        timeout: parseInt(formData.timeout, 10)
      })
      toast.success('连接已更新')
    } else {
      await store.createConnection({
        name: formData.name,
        host: formData.host,
        port: parseInt(formData.port, 10),
        username: formData.username || undefined,
        password: formData.password || undefined,
        reconnect: formData.reconnect,
        reconnectAttempts: parseInt(formData.reconnectAttempts, 10),
        reconnectInterval: parseInt(formData.reconnectInterval, 10),
        timeout: parseInt(formData.timeout, 10)
      })
      toast.success('连接已创建')
    }
    setShowAddDialog(false)
    setEditingConnection(null)
    setFormData({
      name: '',
      host: '',
      port: '23',
      username: '',
      password: '',
      reconnect: true,
      reconnectAttempts: '3',
      reconnectInterval: '3000',
      timeout: '10000'
    })
  }, [formData, editingConnection])

  const handleEditConnection = useCallback((connectionId: string) => {
    const store = useTelnetStore.getState()
    const conn = store.connections.find((c) => c.id === connectionId)
    if (!conn) return

    setFormData({
      name: conn.name,
      host: conn.host,
      port: String(conn.port),
      username: conn.username || '',
      password: conn.password || '',
      reconnect: conn.reconnect,
      reconnectAttempts: String(conn.reconnectAttempts),
      reconnectInterval: String(conn.reconnectInterval),
      timeout: String(conn.timeout)
    })
    setEditingConnection(connectionId)
    setShowAddDialog(true)
  }, [])

  const handleDeleteConnection = useCallback(async (connectionId: string) => {
    const store = useTelnetStore.getState()
    await store.deleteConnection(connectionId)
    toast.success('连接已删除')
  }, [])

  const handleTestConnection = useCallback(async (connectionId: string) => {
    const store = useTelnetStore.getState()
    const result = await store.testConnection(connectionId)
    if (result.success) {
      toast.success('连接成功')
    } else {
      toast.error(`连接失败: ${result.error}`)
    }
  }, [])

  const activeTab = openTabs.find((t) => t.id === activeTabId)
  const activeSession =
    activeTab?.sessionId ? sessions[activeTab.sessionId] : null
  const showTerminalView = openTabs.length > 0 && activeTabId

  // Track mounted tabs
  for (const tab of openTabs) {
    mountedTabsRef.current.add(tab.id)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        {showTerminalView ? (
          <button
            onClick={handleBackToList}
            className="rounded-md p-1 text-muted-foreground/50 hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <ArrowLeft className="size-4" />
          </button>
        ) : (
          <div className="w-6" />
        )}
        <Network className="size-4 text-primary" />
        <span className="text-sm font-medium">Telnet</span>

        {!showTerminalView && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-7"
            onClick={() => {
              setEditingConnection(null)
              setFormData({
                name: '',
                host: '',
                port: '23',
                username: '',
                password: '',
                reconnect: true,
                reconnectAttempts: '3',
                reconnectInterval: '3000',
                timeout: '10000'
              })
              setShowAddDialog(true)
            }}
          >
            <Plus className="mr-1 size-3" />
            新建
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {!showTerminalView ? (
          // Connection List View
          <TelnetConnectionList
            onConnect={handleConnect}
            onEdit={handleEditConnection}
            onDelete={handleDeleteConnection}
            onTest={handleTestConnection}
          />
        ) : (
          // Terminal View
          <div className="flex h-full flex-col">
            {/* Tab Bar */}
            <div className="flex shrink-0 items-center gap-1 border-b bg-muted/30 px-2 py-1 overflow-x-auto">
              {openTabs.map((tab) => {
                const isActive = tab.id === activeTabId
                const session = tab.sessionId ? sessions[tab.sessionId] : null
                const status = session?.status ?? tab.status

                return (
                  <div
                    key={tab.id}
                    className={cn(
                      'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors',
                      isActive ? 'bg-background shadow-sm' : 'hover:bg-muted/50'
                    )}
                  >
                    <button
                      onClick={() => useTelnetStore.getState().setActiveTab(tab.id)}
                      className={cn(
                        'flex items-center gap-1.5 max-w-[120px]',
                        status === 'connecting' && 'text-yellow-500',
                        status === 'connected' && 'text-green-500',
                        status === 'error' && 'text-red-500'
                      )}
                    >
                      {status === 'connecting' && <Loader2 className="size-3 animate-spin" />}
                      {status === 'connected' && <div className="size-2 rounded-full bg-green-500" />}
                      <span className="truncate">{tab.title}</span>
                    </button>
                    <button
                      onClick={() => handleCloseTab(tab.id)}
                      className="rounded p-0.5 hover:bg-muted"
                    >
                      <X className="size-3 text-muted-foreground" />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Terminal */}
            {activeTab?.sessionId && activeSession && (
              <TelnetTerminal
                sessionId={activeTab.sessionId}
                connectionId={activeTab.connectionId}
              />
            )}
          </div>
        )}
      </div>

      {/* Add/Edit Connection Dialog */}
      <Sheet open={showAddDialog} onOpenChange={setShowAddDialog}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>
              {editingConnection ? '编辑连接' : '新建 Telnet 连接'}
            </SheetTitle>
            <SheetDescription>
              {editingConnection ? '修改连接配置' : '添加一个新的 Telnet 连接'}
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">连接名称</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="My Telnet Server"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="host">主机地址</Label>
              <Input
                id="host"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                placeholder="192.168.1.1"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port">端口</Label>
              <Input
                id="port"
                type="number"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                placeholder="23"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="username">用户名（可选）</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="admin"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">密码（可选）</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="••••••••"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="reconnect"
                checked={formData.reconnect}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, reconnect: checked === true })
                }
              />
              <Label htmlFor="reconnect" className="text-sm font-normal">
                启用自动重连
              </Label>
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              取消
            </Button>
            <Button onClick={handleSaveConnection} disabled={!formData.name || !formData.host}>
              {editingConnection ? '保存' : '创建'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
