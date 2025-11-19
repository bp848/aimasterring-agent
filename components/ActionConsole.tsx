import React, { useEffect, useRef } from 'react';

export interface LogEntry {
  timestamp: string;
  type: 'info' | 'success' | 'error' | 'process';
  message: string;
  details?: string;
}

interface ActionConsoleProps {
  logs: LogEntry[];
}

export const ActionConsole: React.FC<ActionConsoleProps> = ({ logs }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="w-full bg-black border-t-4 border-gray-800 font-mono text-sm shadow-2xl mt-8">
      <div className="bg-gray-900 px-4 py-2 flex items-center justify-between border-b border-gray-800">
        <span className="text-green-500 font-bold flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          ACTION CONSOLE
        </span>
        <span className="text-gray-500 text-xs">AI AGENT SYSTEM V1.0</span>
      </div>

      <div className="h-64 overflow-y-auto p-4 space-y-2 custom-scrollbar">
        {logs.length === 0 && <div className="text-gray-600 italic">Waiting for actions...</div>}

        {logs.map((log, index) => (
          <div key={`${log.timestamp}-${index}`} className="animate-fadeIn">
            <div className="flex gap-3">
              <span className="text-gray-500 select-none">[{log.timestamp}]</span>
              <span
                className={
                  log.type === 'error'
                    ? 'text-red-500 font-bold'
                    : log.type === 'success'
                      ? 'text-green-400'
                      : log.type === 'process'
                        ? 'text-blue-400'
                        : 'text-gray-300'
                }
              >
                {log.type === 'process' && '> '}
                {log.message}
              </span>
            </div>
            {log.details && (
              <div className="pl-24 mt-1 text-xs text-red-300/80 whitespace-pre-wrap break-all border-l-2 border-red-900/50 ml-3">
                {log.details}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
