import React, { useState } from 'react';
import Navbar from './components/Navbar';
import MetricsDisplay from './components/MetricsDisplay';
import MasteringPrescription from './components/MasteringPrescription';
import ControlPanel from './components/ControlPanel';
import AudioUploadAnalysis from './components/AudioUploadAnalysis'; // NEW IMPORT
import {
  DEFAULT_INITIAL_METRICS, // Renamed from INITIAL_METRICS
  TARGET_METRICS,
  DIFFERENCE_METRICS, // This will be calculated based on dynamic initial metrics
  MASTERING_PRESCRIPTION,
} from './constants';
import { AudioMetrics, MasteringParameters } from './types';

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [masteredMetrics, setMasteredMetrics] = useState<AudioMetrics | null>(null);
  const [simulationLog, setSimulationLog] = useState<string[]>([]);
  const [masteringParams, setMasteringParams] = useState<MasteringParameters | null>(null);

  // New states for initial analysis screen
  const [hasAnalyzed, setHasAnalyzed] = useState<boolean>(false);
  const [initialMetrics, setInitialMetrics] = useState<AudioMetrics>(DEFAULT_INITIAL_METRICS); // Default or loaded from analysis
  const [uploadedAudioFile, setUploadedAudioFile] = useState<File | null>(null); // NEW: Store the uploaded file
  const [masteredAudioUrl, setMasteredAudioUrl] = useState<string | null>(null); // NEW: Store the mastered audio URL

  const handleMasteringStart = () => {
    setIsLoading(true);
    setMasteredMetrics(null);
    setSimulationLog(['シミュレーションを開始しています...', 'AIエージェントが最適なパラメータを分析中...']);
    setMasteringParams(null);
    setMasteredAudioUrl(null); // Reset mastered audio URL on new simulation
  };

  const handleMasteringComplete = (params: MasteringParameters, finalMetrics: AudioMetrics, newMasteredAudioUrl: string | null) => { // MODIFIED
    setIsLoading(false);
    setMasteringParams(params);
    setMasteredMetrics(finalMetrics);
    setMasteredAudioUrl(newMasteredAudioUrl); // NEW: Store the mastered audio URL
    setSimulationLog((prevLog) => [
      ...prevLog,
      'AIエージェントがパラメータを決定しました。',
      `入力トリム: ${params.inputTrimDb} dB`,
      `コンプ閾値: ${params.compThresholdDbfs} dBFS, 比率: ${params.compRatio}:1, アタック: ${params.compAttackMs} ms, リリース: ${params.compReleaseMs} ms`,
      `EQ (低域): ${params.eqLowHz} Hzで ${params.eqLowDb} dB, Q: ${params.eqLowQ}`,
      `EQ (高域): ${params.eqHighHz} Hzで ${params.eqHighDb} dB, Q: ${params.eqHighQ}`,
      `リミッタ: Ceiling ${params.limiterCeilingDb} dBTP, Lookahead: ${params.limiterLookaheadMs} ms, リリース: ${params.limiterReleaseMs} ms`,
      `目標LUFS: ${params.targetLufs}`,
      'マスタリングプロセスが完了しました！',
    ]);
  };

  const handleInitialAnalysisComplete = (metrics: AudioMetrics, file: File | null) => { // MODIFIED
    setInitialMetrics(metrics);
    setUploadedAudioFile(file); // NEW: Store the uploaded file
    setHasAnalyzed(true);
  };

  // Re-calculate difference metrics based on the dynamically set initial metrics
  const currentDifferenceMetrics: AudioMetrics = {
    lufs: +(TARGET_METRICS.lufs! - initialMetrics.lufs!),
    truePeak: +(TARGET_METRICS.truePeak! - initialMetrics.truePeak!),
    crest: -(initialMetrics.crest! - TARGET_METRICS.crest!),
    sampleRate: null,
    bitDepth: null,
    notes: '+1.8 dB のラウドアップ余地、+1.6 dB のピークマージン、Crest を 2-3 dB 縮めてパンチを出す必要。',
  };


  return (
    <div className="min-h-screen bg-gray-900">
      <Navbar />
      {/* hasAnalyzedの状態に基づいて画面を切り替える */}
      {!hasAnalyzed ? (
        <AudioUploadAnalysis onAnalysisComplete={handleInitialAnalysisComplete} />
      ) : (
        <main className="container mx-auto p-4 sm:p-6 lg:p-8">
          {/* 現状 vs 目標 */}
          <section className="mb-12">
            <h2 className="text-3xl font-extrabold text-blue-300 mb-8 text-center">
              オーディオ分析: 現状と目標
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <MetricsDisplay title="現状（分析結果）" metrics={initialMetrics} colorClass="text-orange-300" />
              <MetricsDisplay title="目標（配信: streaming 想定）" metrics={TARGET_METRICS} colorClass="text-green-300" />
              <MetricsDisplay title="差分所見" metrics={currentDifferenceMetrics} colorClass="text-purple-300" />
            </div>
          </section>

          {/* マスタリング処方箋 */}
          <section className="mb-12">
            <MasteringPrescription prescription={MASTERING_PRESCRIPTION} />
          </section>

          {/* AIマスタリングコントロールと結果表示 */}
          <section>
            <ControlPanel
              onMasteringStart={handleMasteringStart}
              onMasteringComplete={handleMasteringComplete}
              isLoading={isLoading}
              masteredMetrics={masteredMetrics}
              simulationLog={simulationLog}
              initialMetrics={initialMetrics}
              initialAudioFile={uploadedAudioFile} // NEW: Pass the uploaded file
              masteredAudioUrl={masteredAudioUrl} // NEW: Pass the mastered audio URL
            />
          </section>
        </main>
      )}
    </div>
  );
};

export default App;
