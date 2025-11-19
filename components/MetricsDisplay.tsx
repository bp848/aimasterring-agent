import React from 'react';
import { Activity, BarChart3, Zap } from 'lucide-react';
import type { AudioMetrics } from '../types';

interface MetricsDisplayProps {
  metrics: AudioMetrics | null;
  label: string;
}

export const MetricsDisplay: React.FC<MetricsDisplayProps> = ({ metrics, label }) => {
  if (!metrics) {
    return (
      <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 animate-pulse">
        <h3 className="text-gray-400 mb-4">{label} (Measuring...)</h3>
        <div className="space-y-4">
          <div className="h-4 bg-gray-800 rounded w-3/4" />
          <div className="h-4 bg-gray-800 rounded w-1/2" />
          <div className="h-4 bg-gray-800 rounded w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 shadow-lg transition-all hover:border-gray-700">
      <h3 className="text-gray-400 mb-4 font-semibold tracking-wider text-xs uppercase">{label}</h3>
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-black/50 p-3 rounded-lg border border-gray-800">
          <div className="flex items-center gap-2 text-blue-400 mb-1">
            <Activity size={16} />
            <span className="text-xs">LUFS (Int)</span>
          </div>
          <div className="text-xl font-bold font-mono">{metrics.lufs?.toFixed(1) ?? '--'} dB</div>
        </div>

        <div className="bg-black/50 p-3 rounded-lg border border-gray-800">
          <div className="flex items-center gap-2 text-purple-400 mb-1">
            <BarChart3 size={16} />
            <span className="text-xs">True Peak</span>
          </div>
          <div
            className={`text-xl font-bold font-mono ${
              metrics.truePeak !== null && metrics.truePeak !== undefined && metrics.truePeak > -1 ? 'text-red-500' : ''
            }`}
          >
            {metrics.truePeak?.toFixed(1) ?? '--'} dB
          </div>
        </div>

        <div className="bg-black/50 p-3 rounded-lg border border-gray-800">
          <div className="flex items-center gap-2 text-yellow-400 mb-1">
            <Zap size={16} />
            <span className="text-xs">Crest Factor</span>
          </div>
          <div className="text-xl font-bold font-mono">{metrics.crest?.toFixed(1) ?? '--'} dB</div>
        </div>
      </div>
    </div>
  );
};

export default MetricsDisplay;
