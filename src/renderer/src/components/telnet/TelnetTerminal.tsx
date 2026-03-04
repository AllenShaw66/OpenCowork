import { useEffect, useRef, useState, useCallback } from 'react'
import { IPC } from '@renderer/lib/ipc/channels'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Send, Trash2, Download } from 'lucide-react'

interface TelnetTerminalProps {
  sessionId: string
  connectionId?: string
}

interface LogEntry {
  id: string
  type: 'command' | 'response' | 'error' | 'system'
  content: string
  timestamp: number
}

export function TelnetTerminal({
  sessionId,
  connectionId: _connectionId
}: TelnetTerminalProps): React.JSX.Element {
  const [input, setInput] = useState('')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [, setLastSeq] = useState(0)

  const logsEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Listen for output events (only way, no polling)
  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on(
      'telnet:output',
      (
        _event: unknown,
        data: { sessionId: string; data: number[]; seq: number }
      ) => {
        if (data.sessionId !== sessionId) return

        const text = new TextDecoder().decode(new Uint8Array(data.data))
        setLogs((prev) => [
          ...prev,
          {
            id: `log-${Date.now()}-${Math.random()}`,
            type: 'response',
            content: text,
            timestamp: Date.now()
          }
        ])
        setLastSeq(data.seq)
      }
    )

    return () => {
      cleanup()
    }
  }, [sessionId])

  // Auto-scroll to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSend = useCallback(() => {
    if (!input.trim()) return

    // Add to history
    setCommandHistory((prev) => [input, ...prev.slice(0, 49)])
    setHistoryIndex(-1)

    // Send via IPC
    ipcClient.send(IPC.TELNET_DATA, { sessionId, data: input })

    setInput('')
  }, [input, sessionId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSend()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (historyIndex < commandHistory.length - 1) {
          const newIndex = historyIndex + 1
          setHistoryIndex(newIndex)
          setInput(commandHistory[newIndex])
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1
          setHistoryIndex(newIndex)
          setInput(commandHistory[newIndex])
        } else if (historyIndex === 0) {
          setHistoryIndex(-1)
          setInput('')
        }
      }
    },
    [handleSend, commandHistory, historyIndex]
  )

  const handleClear = useCallback(() => {
    setLogs([])
  }, [])

  const handleExport = useCallback(() => {
    const content = logs
      .map((log) => `[${new Date(log.timestamp).toLocaleTimeString()}] ${log.content}`)
      .join('\n')

    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `telnet-session-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [logs])

  return (
    <div className="flex h-full flex-col">
      {/* Terminal Output */}
      <div className="flex-1 overflow-y-auto bg-black p-4 font-mono text-sm">
        {logs.length === 0 ? (
          <div className="text-gray-500">等待数据...</div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className={cn(
                'whitespace-pre-wrap break-words',
                log.type === 'command' && 'text-green-400',
                log.type === 'response' && 'text-gray-300',
                log.type === 'error' && 'text-red-400',
                log.type === 'system' && 'text-yellow-400'
              )}
            >
              {log.content}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Input Bar */}
      <div className="flex shrink-0 items-center gap-2 border-t bg-muted/50 p-2">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入指令..."
          className="flex-1 font-mono"
          autoFocus
        />
        <Button onClick={handleSend} size="icon" variant="default">
          <Send className="size-4" />
        </Button>
        <Button onClick={handleClear} size="icon" variant="outline" title="清空日志">
          <Trash2 className="size-4" />
        </Button>
        <Button onClick={handleExport} size="icon" variant="outline" title="导出日志">
          <Download className="size-4" />
        </Button>
      </div>
    </div>
  )
}

// Helper for cn import
function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}
