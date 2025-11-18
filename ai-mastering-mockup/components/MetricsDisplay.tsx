import React from 'react';
import { AudioMetrics } from '../types';

interface MetricsDisplayProps {
  title: string;
  metrics: AudioMetrics;
  colorClass?: string;
}

const MetricsDisplay: React.FC<MetricsDisplayProps> = ({ title, metrics, colorClass = 'text-gray-200' }) => {
  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-md hover:shadow-xl transition-shadow duration-300 border border-gray-700">
      <h3 className={`text-xl font-semibold mb-4 ${colorClass}`}>{title}</h3>
      <ul className="space-y-2 text-sm">
        <li className="flex justify-between">
          <span className="font-medium text-gray-400">LUFS:</span>
          <span className="text-blue-300 font-bold">
            {metrics.lufs !== null ? `${metrics.lufs.toFixed(1)}` : 'N/A'}
          </span>
        </li>
        <li className="flex justify-between">
          <span className="font-medium text-gray-400">True Peak (dBTP):</span>
          <span className="text-blue-300 font-bold">
            {metrics.truePeak !== null ? `${metrics.truePeak.toFixed(1)}` : 'N/A'}
          </span>
        </li>
        <li className="flex justify-between">
          <span className="font-medium text-gray-400">Crest Factor (dB):</span>
          <span className="text-blue-300 font-bold">
            {metrics.crest !== null ? `${metrics.crest.toFixed(1)}` : 'N/A'}
          </span>
        </li>
        {metrics.sampleRate && (
          <li className="flex justify-between">
            <span className="font-medium text-gray-400">Sample Rate:</span>
            <span className="text-gray-300">{metrics.sampleRate} kHz</span>
          </li>
        )}
        {metrics.bitDepth && (
          <li className="flex justify-between">
            <span className="font-medium text-gray-400">Bit Depth:</span>
            <span className="text-gray-300">{metrics.bitDepth}</span>
          </li>
        )}
        {metrics.notes && (
          <li className="pt-2 text-xs text-gray-500 italic">
            {metrics.notes}
          </li>
        )}
      </ul>
    </div>
  );
};

export default MetricsDisplay;