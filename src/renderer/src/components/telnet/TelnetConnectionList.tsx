import { useTelnetStore } from '@renderer/stores/telnet-store'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Search, Wifi, WifiOff, Trash2, Edit, Play, RefreshCw } from 'lucide-react'
import { useState, useMemo } from 'react'
import { cn } from '@renderer/lib/utils'

interface TelnetConnectionListProps {
  onConnect: (connectionId: string) => void
  onEdit: (connectionId: string) => void
  onDelete: (connectionId: string) => void
  onTest: (connectionId: string) => void
}

export function TelnetConnectionList({
  onConnect,
  onEdit,
  onDelete,
  onTest
}: TelnetConnectionListProps): React.JSX.Element {
  const connections = useTelnetStore((s) => s.connections)
  const sessions = useTelnetStore((s) => s.sessions)
  const [searchQuery, setSearchQuery] = useState('')

  const filteredConnections = useMemo(() => {
    if (!searchQuery.trim()) return connections
    const query = searchQuery.toLowerCase()
    return connections.filter(
      (conn) =>
        conn.name.toLowerCase().includes(query) ||
        conn.host.toLowerCase().includes(query)
    )
  }, [connections, searchQuery])

  const getConnectionStatus = (connectionId: string) => {
    const session = Object.values(sessions).find(
      (s) => s.connectionId === connectionId && s.status === 'connected'
    )
    return session ? 'connected' : 'disconnected'
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search Bar */}
      <div className="flex items-center gap-2 border-b p-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="搜索连接..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Connection List */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredConnections.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Wifi className="mx-auto mb-2 size-8 opacity-50" />
              <p className="text-sm">暂无连接</p>
              <p className="text-xs">点击右上角"新建"添加连接</p>
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredConnections.map((conn) => {
              const status = getConnectionStatus(conn.id)

              return (
                <div
                  key={conn.id}
                  className={cn(
                    'group flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50',
                    status === 'connected' && 'border-green-500/50 bg-green-500/5'
                  )}
                >
                  {/* Status Icon */}
                  <div
                    className={cn(
                      'flex size-9 items-center justify-center rounded-full',
                      status === 'connected'
                        ? 'bg-green-500/10 text-green-500'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {status === 'connected' ? (
                      <Wifi className="size-4" />
                    ) : (
                      <WifiOff className="size-4" />
                    )}
                  </div>

                  {/* Connection Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{conn.name}</span>
                      {conn.lastConnectedAt && (
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(conn.lastConnectedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {conn.host}:{conn.port}
                      {conn.username && ` · ${conn.username}`}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => onConnect(conn.id)}
                      title="连接"
                    >
                      <Play className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => onTest(conn.id)}
                      title="测试连接"
                    >
                      <RefreshCw className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => onEdit(conn.id)}
                      title="编辑"
                    >
                      <Edit className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-red-500 hover:text-red-500"
                      onClick={() => onDelete(conn.id)}
                      title="删除"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
