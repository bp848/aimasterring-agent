import React from 'react';
import { AudioMetrics, MasteringParameters } from '../types';
import LoadingSpinner from './LoadingSpinner';
import MetricsDisplay from './MetricsDisplay';
import { TARGET_METRICS } from '../constants';
import { useAiMasteringAgent } from '../hooks/useAiMasteringAgent';
import type { MasteringResult } from '../hooks/useAiMasteringAgent';

interface ControlPanelProps {
  onMasteringStart: () => void;
  onMasteringComplete: (
    params: MasteringParameters,
    finalMetrics: AudioMetrics,
    masteredAudioUrl: string | null,
    meta: MasteringResult['meta'],
  ) => void;
  isLoading: boolean;
  masteredMetrics: AudioMetrics | null;
  simulationLog: string[];
  initialMetrics: AudioMetrics;
  initialAudioFile: File | null;
  masteredAudioUrl: string | null;
  masteringMeta: MasteringResult['meta'] | null;
  sourceUrl: string | null;
  onLog?: (type: 'info' | 'success' | 'error' | 'process', message: string, details?: string) => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  onMasteringStart,
  onMasteringComplete,
  isLoading,
  masteredMetrics,
  simulationLog,
  initialMetrics,
  initialAudioFile,
  masteredAudioUrl,
  masteringMeta,
  sourceUrl,
  onLog,
}) => {
  const { startMasteringSimulation, statusMessage, errorMessage } = useAiMasteringAgent();

  const handleStartSimulation = async () => {
    if (!sourceUrl) {
      setTimeout(() => {
        onLog?.('error', 'ソースURLが見つかりません。', 'もう一度解析を実行してからマスタリングを開始してください。');
      }, 0);
      return;
    }
    onMasteringStart();
    try {
      const { params, finalMetrics, masteredAudioUrl: masteredUrl, meta } = await startMasteringSimulation({
        initialMetrics,
        targetMetrics: TARGET_METRICS,
        platformId: 'streaming',
        sourceUrl,
      });
      if (meta?.usedMockResult) {
        onLog?.('error', 'バックエンドマスタリングに失敗したためモック結果を表示します。', meta.reason);
      } else {
        onLog?.('success', 'バックエンドマスタリングが正常に完了しました。');
      }
      onMasteringComplete(params, finalMetrics, masteredUrl, meta);
    } catch (error) {
      console.error('Mastering simulation failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      onLog?.('error', 'Mastering simulation failed unexpectedly.', message);
    }
  };

  const initialAudioUrl = initialAudioFile ? URL.createObjectURL(initialAudioFile) : null;
  const isMockedResult = masteringMeta?.usedMockResult ?? false;
  const shouldShowMasteredAudio = Boolean(masteredAudioUrl && !isMockedResult);


  return (
    <div className="bg-gray-800 p-6 rounded-lg shadow-md border border-gray-700">
      <h3 className="text-2xl font-bold text-blue-400 mb-6">AIマスタリングコントロール</h3>

      <div className="flex items-center justify-center mb-6">
        <button
          onClick={handleStartSimulation}
          disabled={isLoading || !initialAudioFile || !sourceUrl}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-full text-lg shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105"
        >
          {isLoading ? 'マスタリング中...' : 'AIマスタリングシミュレーションを開始'}
        </button>
      </div>
      {!sourceUrl && (
        <p className="text-xs text-yellow-400 text-center -mt-4 mb-4">
          解析済みのソース URL が見つかりません。再度 Step 1 でアップロード &amp; 解析を実行してください。
        </p>
      )}

      {statusMessage && (
        <p className="text-sm text-blue-300 text-center mb-4">{statusMessage}</p>
      )}

      {errorMessage && (
        <div className="mb-4 rounded border border-red-500/40 bg-red-900/30 p-3 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      {isLoading && (
        <div className="mb-6">
          <LoadingSpinner />
        </div>
      )}

      {masteredMetrics && (
        <div className="mt-8">
          <h4 className="text-xl font-bold text-green-400 mb-4">マスタリング結果:</h4>
          <MetricsDisplay label="シミュレーション後" metrics={masteredMetrics} />
          
          {/* NEW: Audio Playback Section */}
          {(initialAudioUrl || shouldShowMasteredAudio || isMockedResult) && (
            <div className="mt-8 pt-8 border-t border-gray-700">
              <h4 className="text-xl font-bold text-blue-400 mb-4">前後の音を聞く:</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {initialAudioUrl && (
                  <div className="bg-gray-700 p-4 rounded-md shadow-inner border border-gray-600">
                    <p className="text-lg font-semibold text-gray-200 mb-2">オリジナルオーディオ</p>
                    <audio controls src={initialAudioUrl} className="w-full"></audio>
                  </div>
                )}
                {shouldShowMasteredAudio && (
                  <div className="bg-gray-700 p-4 rounded-md shadow-inner border border-gray-600">
                    <p className="text-lg font-semibold text-gray-200 mb-2">マスタリング済みオーディオ</p>
                    <audio controls src={masteredAudioUrl} className="w-full"></audio>
                    <p className="text-xs text-gray-500 mt-2">
                      ※バックエンドで生成された最新のマスタリング結果です。
                    </p>
                  </div>
                )}
                {isMockedResult && (
                  <div className="bg-gray-700 p-4 rounded-md shadow-inner border border-gray-600">
                    <p className="text-lg font-semibold text-gray-200 mb-2 flex items-center gap-2">
                      マスタリング済みオーディオ
                      <span className="text-xs font-semibold text-red-300">表示不可</span>
                    </p>
                    <p className="text-sm text-gray-400">
                      バックエンドマスタリングに失敗したため、モック結果のみ表示しています。オーディオ比較はできません。
                    </p>
                    {masteringMeta?.reason && (
                      <p className="mt-2 text-xs text-gray-500">理由: {masteringMeta.reason}</p>
                    )}
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
