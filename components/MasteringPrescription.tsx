import React, { useEffect, useRef } from 'react';
import type { AudioMetrics, MasteringStep } from '../types';

interface MasteringPrescriptionProps {
  prescription: MasteringStep[];
  currentMetrics?: AudioMetrics | null;
  onLog?: (type: 'info' | 'success' | 'error' | 'process', message: string, details?: string) => void;
}

const MasteringPrescription: React.FC<MasteringPrescriptionProps> = ({ prescription, currentMetrics, onLog }) => {
  const lastLoggedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentMetrics || !onLog) {
      return;
    }
    const signature = JSON.stringify({
      lufs: currentMetrics.lufs,
      tp: currentMetrics.truePeak,
      crest: currentMetrics.crest,
    });
    if (signature === lastLoggedRef.current) {
      return;
    }
    lastLoggedRef.current = signature;
    onLog(
      'process',
      'Generating mastering prescription from live metrics.',
      `LUFS=${currentMetrics.lufs?.toFixed(1) ?? 'N/A'}, TP=${currentMetrics.truePeak?.toFixed(1) ?? 'N/A'}, Crest=${currentMetrics.crest?.toFixed(1) ?? 'N/A'}`,
    );
  }, [currentMetrics, onLog]);

  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-md border border-gray-700 space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-blue-400 mb-3">マスタリング処方箋</h3>
        {currentMetrics && (
          <p className="text-sm text-gray-400">
            Current mix is sitting at{' '}
            <span className="text-blue-300 font-semibold">{currentMetrics.lufs?.toFixed(1) ?? '--'} LUFS</span> with a
            crest factor of <span className="text-blue-300 font-semibold">{currentMetrics.crest?.toFixed(1) ?? '--'} dB</span>. Steps below are tuned to close that gap.
          </p>
        )}
      </div>
      <div className="space-y-6">
        {prescription.map((step, index) => (
          <div key={index} className="bg-gray-700/70 p-4 rounded-md shadow-inner border border-gray-600">
            <h4 className="text-lg font-semibold text-gray-200 mb-2">{step.title}</h4>
            <p className="text-gray-300 text-sm leading-relaxed">{step.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MasteringPrescription;
