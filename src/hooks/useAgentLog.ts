import { useState, useCallback } from 'react';
import { AgentLog } from '../types/cargo';

let logIdCounter = 0;

export function useAgentLog() {
  const [logs, setLogs] = useState<AgentLog[]>([]);

  const addLog = useCallback((entry: Omit<AgentLog, 'id' | 'timestamp'>) => {
    setLogs(prev => [
      {
        ...entry,
        id: `log-${++logIdCounter}`,
        timestamp: Date.now(),
      },
      ...prev.slice(0, 49), // keep last 50
    ]);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { logs, addLog, clearLogs };
}
