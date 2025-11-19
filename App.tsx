import React, { useState } from 'react';
import Navbar from './components/Navbar';
import MetricsDisplay from './components/MetricsDisplay';
import MasteringPrescription from './components/MasteringPrescription';
import ControlPanel from './components/ControlPanel';
import AudioUploadAnalysis from './components/AudioUploadAnalysis';
import { ActionConsole, LogEntry } from './components/ActionConsole';
import { DEFAULT_INITIAL_METRICS, TARGET_METRICS, MASTERING_PRESCRIPTION } from './constants';
import type { AudioMetrics, MasteringParameters } from './types';

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [masteredMetrics, setMasteredMetrics] = useState<AudioMetrics | null>(null);
  const [simulationLog, setSimulationLog] = useState<string[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [initialMetrics, setInitialMetrics] = useState<AudioMetrics>(DEFAULT_INITIAL_METRICS);
  const [uploadedAudioFile, setUploadedAudioFile] = useState<File | null>(null);
  const [masteredAudioUrl, setMasteredAudioUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConsoleCollapsed, setIsConsoleCollapsed] = useState(false);
  const [isConsoleVisible, setIsConsoleVisible] = useState(true);

  const addLog = (type: LogEntry['type'], message: string, details?: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, type, message, details }]);
  };

  const handleMasteringStart = () => {
    setIsLoading(true);
    setMasteredMetrics(null);
    setMasteredAudioUrl(null);
    setSimulationLog(['シミュレーションを開始しています...', 'AIエージェントが最適なパラメータを分析中...']);
    addLog('process', 'Mastering simulation started.');
  };

  const handleMasteringComplete = (
    params: MasteringParameters,
    finalMetrics: AudioMetrics,
    newMasteredAudioUrl: string | null,
    meta?: { usedMockResult: boolean; reason?: string },
  ) => {
    setIsLoading(false);
    setMasteredMetrics(finalMetrics);
    setMasteredAudioUrl(newMasteredAudioUrl);
    setSimulationLog((prevLog) => [
      ...prevLog,
      'AIエージェントがパラメータを決定しました。',
      `入力トリム: ${params.inputTrimDb} dB`,
      `コンプ閾値: ${params.compThresholdDbfs} dBFS, 比率: ${params.compRatio}:1, アタック: ${params.compAttackMs} ms, リリース: ${params.compReleaseMs} ms`,
      `EQ (低域): ${params.eqLowHz} Hzで ${params.eqLowDb} dB, Q: ${params.eqLowQ}`,
      `EQ (高域): ${params.eqHighHz} Hzで ${params.eqHighDb} dB, Q: ${params.eqHighQ}`,
      `リミッタ: Ceiling ${params.limiterCeilingDb} dBTP, Lookahead: ${params.limiterLookaheadMs} ms, リリース: ${params.limiterReleaseMs} ms`,
      `目標LUFS: ${params.targetLufs}`,
      meta?.usedMockResult ? '⚠️ バックエンド失敗によりモック結果を表示しています。' : 'マスタリングプロセスが完了しました！',
    ]);
    if (meta?.usedMockResult) {
      addLog('error', 'バックエンドマスタリングに失敗したためモック結果を表示します。', meta.reason);
    } else {
      addLog('success', 'Mastering simulation completed successfully.');
    }
  };

  const handleInitialAnalysisComplete = (metrics: AudioMetrics, file: File | null) => {
    setInitialMetrics(metrics);
    setUploadedAudioFile(file);
    setHasAnalyzed(true);
    addLog('success', 'Audio analysis completed successfully.');
    addLog(
      'info',
      'Measurement captured.',
      `LUFS=${metrics.lufs?.toFixed(1) ?? 'N/A'}, TruePeak=${metrics.truePeak?.toFixed(1) ?? 'N/A'}, Crest=${metrics.crest?.toFixed(1) ?? 'N/A'}`,
    );
  };

  const currentDifferenceMetrics: AudioMetrics = {
    lufs: +(TARGET_METRICS.lufs! - initialMetrics.lufs!),
    truePeak: +(TARGET_METRICS.truePeak! - initialMetrics.truePeak!),
    crest: -(initialMetrics.crest! - TARGET_METRICS.crest!),
    sampleRate: null,
    bitDepth: null,
    notes: '+1.8 dB のラウドアップ余地、+1.6 dB のピークマージン、Crest を 2-3 dB 縮めてパンチを出す必要。',
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <Navbar />
      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8 pb-80">
        {!hasAnalyzed ? (
          <AudioUploadAnalysis onAnalysisComplete={handleInitialAnalysisComplete} onLog={addLog} />
        ) : (
          <>
            <section className="mb-12">
              <h2 className="text-3xl font-extrabold text-blue-300 mb-8 text-center">
                オーディオ分析: 現状と目標
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <MetricsDisplay label="現状（分析結果）" metrics={hasAnalyzed ? initialMetrics : null} />
                <MetricsDisplay label="目標（ストリーミング想定）" metrics={TARGET_METRICS} />
                <MetricsDisplay label="差分所見" metrics={currentDifferenceMetrics} />
              </div>
            </section>

            <section className="mb-12">
              <MasteringPrescription
                prescription={MASTERING_PRESCRIPTION}
                currentMetrics={initialMetrics}
                onLog={addLog}
              />
            </section>

            <section>
              <ControlPanel
                onMasteringStart={handleMasteringStart}
                onMasteringComplete={handleMasteringComplete}
                isLoading={isLoading}
                masteredMetrics={masteredMetrics}
                simulationLog={simulationLog}
                initialMetrics={initialMetrics}
                initialAudioFile={uploadedAudioFile}
                masteredAudioUrl={masteredAudioUrl}
                onLog={addLog}
              />
            </section>
          </>
        )}
      </main>
      {isConsoleVisible ? (
        <div className="fixed bottom-0 w-full z-50">
          <ActionConsole
            logs={logs}
            isCollapsed={isConsoleCollapsed}
            onCollapseToggle={() => setIsConsoleCollapsed((prev) => !prev)}
            onClose={() => setIsConsoleVisible(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsConsoleVisible(true)}
          className="fixed bottom-4 right-4 z-50 px-4 py-2 rounded bg-green-600 text-white shadow-lg hover:bg-green-500 transition"
        >
          Open Console
        </button>
      )}
    </div>
  );
};

export default App;
