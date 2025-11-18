import React from 'react';
import { AgentActionEvent } from '../types';

interface ActionConsoleProps {
  actions: AgentActionEvent[];
}

const STATUS_TEXT: Record<AgentActionEvent['status'], string> = {
  pending: '待機中',
  in_progress: '進行中',
  success: '完了',
  error: 'エラー',
};

const STATUS_COLOR: Record<AgentActionEvent['status'], string> = {
  pending: 'text-gray-300 border-gray-600',
  in_progress: 'text-blue-300 border-blue-500/60',
  success: 'text-green-300 border-green-500/60',
  error: 'text-red-300 border-red-500/70',
};

const ActionConsole: React.FC<ActionConsoleProps> = ({ actions }) => {
  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="mt-6">
      <h5 className="text-lg font-semibold text-gray-200 mb-3">アクションコンソール</h5>
      <div className="action-console-grid">
        {actions.map((action) => (
          <div
            key={action.id}
            className={`rounded-lg border bg-gray-900/70 px-4 py-3 shadow-inner ${STATUS_COLOR[action.status]}`}
          >
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>{action.label}</span>
              <span>{STATUS_TEXT[action.status]}</span>
            </div>
            {action.detail && (
              <p className="mt-2 text-xs text-gray-300 leading-relaxed">
                {action.detail}
              </p>
            )}
            <p className="mt-2 text-[11px] text-gray-500">
              {new Date(action.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ActionConsole;
