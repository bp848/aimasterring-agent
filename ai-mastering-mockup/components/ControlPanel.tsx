import React from 'react';
import { AudioMetrics, MasteringParameters } from '../types';
import LoadingSpinner from './LoadingSpinner';
import MetricsDisplay from './MetricsDisplay';
import { TARGET_METRICS } from '../constants';
import { useAiMasteringAgent } from '../hooks/useAiMasteringAgent'; // <-- NEW IMPORT
import ActionConsole from './ActionConsole';

interface ControlPanelProps {
  onMasteringStart: () => void;
  onMasteringComplete: (params: MasteringParameters, finalMetrics: AudioMetrics, masteredAudioUrl: string | null) => void;
  isLoading: boolean;
  masteredMetrics: AudioMetrics | null;
  simulationLog: string[];
  initialMetrics: AudioMetrics;
  initialAudioFile: File | null; // NEW: Original uploaded audio file
  masteredAudioUrl: string | null; // NEW: URL for the mastered audio
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  onMasteringStart,
  onMasteringComplete,
  isLoading,
  masteredMetrics,
  simulationLog,
  initialMetrics,
  initialAudioFile, // NEW
  masteredAudioUrl, // NEW
}) => {
  const { startMasteringSimulation, statusMessage, errorMessage, actionLog } = useAiMasteringAgent(); // <-- USE THE HOOK

  const handleStartSimulation = async () => { // <-- MADE ASYNC
    onMasteringStart();
    try {
      const { params, finalMetrics, masteredAudioUrl: masteredUrl } = await startMasteringSimulation({
        initialMetrics,
        targetMetrics: TARGET_METRICS,
        originalFile: initialAudioFile,
        platformId: 'streaming',
      });
      onMasteringComplete(params, finalMetrics, masteredUrl); // <-- PASS masteredAudioUrl
    } catch (error) {
      console.error("Mastering simulation failed:", error);
      // 必要に応じてUIでエラー状態を処理することもできます
    }
  };

  const initialAudioUrl = initialAudioFile ? URL.createObjectURL(initialAudioFile) : null;


  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-md border border-gray-700">
      <h3 className="text-2xl font-bold text-blue-400 mb-6">AIマスタリングコントロール</h3>

      <div className="flex items-center justify-center mb-6">
        <button
          onClick={handleStartSimulation}
          disabled={isLoading || !initialAudioFile} // Disable if no file uploaded
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-full text-lg shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105"
        >
          {isLoading ? 'マスタリング中...' : 'AIマスタリングシミュレーションを開始'}
        </button>
      </div>

      {statusMessage && (
        <p className="text-sm text-blue-300 text-center mb-4">{statusMessage}</p>
      )}

      {errorMessage && (
        <div className="mb-4 rounded border border-red-500/40 bg-red-900/30 p-3 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      <ActionConsole actions={actionLog} />

      {isLoading && (
        <div className="mb-6">
          <LoadingSpinner />
        </div>
      )}

      {masteredMetrics && (
        <div className="mt-8">
          <h4 className="text-xl font-bold text-green-400 mb-4">マスタリング結果:</h4>
          <MetricsDisplay title="シミュレーション後" metrics={masteredMetrics} colorClass="text-green-300" />
          
          {/* NEW: Audio Playback Section */}
          {(initialAudioUrl || masteredAudioUrl) && (
            <div className="mt-8 pt-8 border-t border-gray-700">
              <h4 className="text-xl font-bold text-blue-400 mb-4">前後の音を聞く:</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {initialAudioUrl && (
                  <div className="bg-gray-700 p-4 rounded-md shadow-inner border border-gray-600">
                    <p className="text-lg font-semibold text-gray-200 mb-2">オリジナルオーディオ</p>
                    <audio controls src={initialAudioUrl} className="w-full"></audio>
                  </div>
                )}
                {masteredAudioUrl && (
                  <div className="bg-gray-700 p-4 rounded-md shadow-inner border border-gray-600">
                    <p className="text-lg font-semibold text-gray-200 mb-2">マスタリング済みオーディオ</p>
                    <audio controls src={masteredAudioUrl} className="w-full"></audio>
                    <p className="text-xs text-gray-500 mt-2">
                      ※バックエンドで生成された最新のマスタリング結果です。
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
          {/* END NEW Audio Playback Section */}

          <div className="mt-6">
            <h5 className="text-lg font-semibold text-gray-300 mb-2">シミュレーションログ:</h5>
            <div className="bg-gray-700 p-4 rounded-md h-48 overflow-y-auto text-sm text-gray-300 border border-gray-600">
              {simulationLog.length > 0 ? (
                <ul className="list-disc list-inside space-y-1">
                  {simulationLog.map((log, index) => (
                    <li key={index}>{log}</li>
                  ))}
                </ul>
              ) : (
                <p>ログはありません。</p>
              )}
            </div>
            <div className="mt-4 text-xs text-gray-500">
              <p>注: Gemini→Python→ffmpeg のベータチェーンを利用しています。失敗時は自動でフェイルセーフ値へフォールバックします。</p>
              <p>ログにはGemini応答とマスタリングサーバーの進捗が順次追記されます。</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ControlPanel;
