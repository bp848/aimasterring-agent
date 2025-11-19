import React, { useState } from 'react';
import Navbar from './components/Navbar';
import MetricsDisplay from './components/MetricsDisplay';
import MasteringPrescription from './components/MasteringPrescription';
import ControlPanel from './components/ControlPanel';
import AudioUploadAnalysis, { UploadedSource } from './components/AudioUploadAnalysis';
import { ActionConsole, LogEntry } from './components/ActionConsole';
import { DEFAULT_INITIAL_METRICS, TARGET_METRICS, MASTERING_PRESCRIPTION } from './constants';
import type { AudioMetrics, MasteringParameters } from './types';
import type { MasteringResult } from './hooks/useAiMasteringAgent';

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [masteredMetrics, setMasteredMetrics] = useState<AudioMetrics | null>(null);
  const [simulationLog, setSimulationLog] = useState<string[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [initialMetrics, setInitialMetrics] = useState<AudioMetrics>(DEFAULT_INITIAL_METRICS);
  const [uploadedAudioFile, setUploadedAudioFile] = useState<File | null>(null);
  const [masteredAudioUrl, setMasteredAudioUrl] = useState<string | null>(null);
  const [remoteSource, setRemoteSource] = useState<UploadedSource | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConsoleCollapsed, setIsConsoleCollapsed] = useState(false);
  const [isConsoleVisible, setIsConsoleVisible] = useState(true);
  const [masteringMeta, setMasteringMeta] = useState<MasteringResult['meta'] | null>(null);

  const addLog = (type: LogEntry['type'], message: string, details?: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, { timestamp, type, message, details }]);
  };

  const handleMasteringStart = () => {
    setIsLoading(true);
    setMasteredMetrics(null);
    setMasteredAudioUrl(null);
    setMasteringMeta(null);
    setSimulationLog(['シミュレーションを開始しています...', 'AIエージェントが最適なパラメータを分析中...']);
    addLog('process', 'Mastering simulation started.');
  };

  const handleMasteringComplete = (
    params: MasteringParameters,
    finalMetrics: AudioMetrics,
    newMasteredAudioUrl: string | null,
    meta: MasteringResult['meta'],
  ) => {
    setIsLoading(false);
    setMasteredMetrics(finalMetrics);
    setMasteringMeta(meta);
    setMasteredAudioUrl(meta?.usedMockResult ? null : newMasteredAudioUrl);
    setSimulationLog((prevLog) => [
      ...prevLog,
      'AIエージェントがパラメータを決定しました。',
      `入力トリム: ${params.inputTrimDb} dB`,
      `コンプ閾値: ${params.compThresholdDbfs} dBFS, 比率: ${params.compRatio}:1, アタック: ${params.compAttackMs} ms, リリース: ${params.compReleaseMs} ms`,
      `EQ (低域): ${params.eqLowHz} Hzで ${params.eqLowDb} dB, Q: ${params.eqLowQ}`,
      `EQ (高域): ${params.eqHighHz} Hzで ${params.eqHighDb} dB, Q: ${params.eqHighQ}`,
      `リミッタ: Ceiling ${params.limiterCeilingDb} dBTP, Lookahead: ${params.limiterLookaheadMs} ms, リリース: ${params.limiterReleaseMs} ms`,
      `目標LUFS: ${params.targetLufs}`,
      ...(meta?.usedMockResult
        ? [
            'バックエンドマスタリングに失敗したためモック結果を表示しています。',
            meta?.reason ? `理由: ${meta.reason}` : 'フェイルセーフプリセットで進行しました。',
          ]
        : ['マスタリングプロセスが完了しました！']),
    ]);
    if (meta?.usedMockResult) {
      addLog('error', 'バックエンドマスタリングに失敗したためモック結果を表示します。', meta.reason);
    } else {
      addLog('success', 'Mastering simulation completed successfully.');
    }
  };

  const handleInitialAnalysisComplete = (metrics: AudioMetrics, file: File | null, remote: UploadedSource) => {
    setInitialMetrics(metrics);
    setUploadedAudioFile(file);
    setHasAnalyzed(true);
    setRemoteSource(remote);
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
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <Navbar />
      <main className="flex-grow w-full px-4 py-6 pb-72">
        <div className="max-w-7xl mx-auto h-full">
          <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-6 h-full">
            <div className="flex flex-col gap-6 overflow-y-auto pr-1">
              <AudioUploadAnalysis onAnalysisComplete={handleInitialAnalysisComplete} onLog={addLog} />

              {hasAnalyzed ? (
                <>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <MetricsDisplay label="現状（分析結果）" metrics={initialMetrics} />
                      <MetricsDisplay label="差分所見" metrics={currentDifferenceMetrics} />
                    </div>
                    <MetricsDisplay label="目標（ストリーミング想定）" metrics={TARGET_METRICS} />
                  </div>
                  <MasteringPrescription
                    prescription={MASTERING_PRESCRIPTION}
                    currentMetrics={initialMetrics}
                    onLog={addLog}
                  />
                </>
              ) : (
                <div className="bg-gray-900/80 border border-gray-800 rounded-2xl p-6 shadow-inner">
                  <p className="text-xs uppercase tracking-[0.2em] text-gray-500 mb-2">Step 2</p>
                  <h3 className="text-xl font-semibold text-white mb-3">分析完了後に指針を表示します</h3>
                  <p className="text-sm text-gray-400">
                    ファイルをアップロードし解析が完了すると、ここに現状・目標・差分の実測値とマスタリング方針が表示されます。
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-6">
              {hasAnalyzed ? (
                <ControlPanel
                  onMasteringStart={handleMasteringStart}
                  onMasteringComplete={handleMasteringComplete}
                  isLoading={isLoading}
                  masteredMetrics={masteredMetrics}
                  simulationLog={simulationLog}
                  initialMetrics={initialMetrics}
                  initialAudioFile={uploadedAudioFile}
                masteredAudioUrl={masteredAudioUrl}
                masteringMeta={masteringMeta}
                sourceUrl={remoteSource?.objectUrl ?? null}
                onLog={addLog}
              />
              ) : (
                <div className="bg-gray-800/80 border border-gray-800 rounded-2xl p-8 h-full flex flex-col justify-center text-center shadow-lg">
                  <h3 className="text-2xl font-bold text-blue-300 mb-4">右カラム: マスタリング操作</h3>
                  <p className="text-sm text-gray-400 mb-4">
                    解析が完了すると、ここで Gemini が生成したパラメータを確認し、Python/ffmpeg チェーンを起動できます。
                  </p>
                  <p className="text-xs text-gray-500">
                    まず左カラムで音源を解析してから、AIマスタリングを開始してください。
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
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
