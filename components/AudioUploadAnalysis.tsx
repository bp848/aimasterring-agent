import React, { useState } from 'react';
import { AudioMetrics } from '../types';
import LoadingSpinner from './LoadingSpinner';
import MetricsDisplay from './MetricsDisplay';
import { TARGET_METRICS } from '../constants';

interface AudioUploadAnalysisProps {
  onAnalysisComplete: (metrics: AudioMetrics, file: File | null) => void;
  onLog: (type: 'info' | 'success' | 'error' | 'process', message: string, details?: string) => void;
}

const MAX_UPLOAD_BYTES = 32 * 1024 * 1024; // Cloud Run request limit (~32 MB)

const AudioUploadAnalysis: React.FC<AudioUploadAnalysisProps> = ({ onAnalysisComplete, onLog }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AudioMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      setAnalysisResult(null); // ファイルが変更されたら結果をリセット
      if (file.size > MAX_UPLOAD_BYTES) {
        const message = `ファイルサイズ ${(file.size / (1024 * 1024)).toFixed(2)} MB は Cloud Run の制限 (32 MB) を超えています。`;
        setSelectedFile(null);
        setError(message);
        onLog('error', 'File rejected because it exceeds the Cloud Run upload limit.', message);
        return;
      }
      setSelectedFile(file);
      setError(null);
    }
  };

  const handleAnalyzeClick = async () => {
    if (!selectedFile) {
      setError('オーディオファイルを選択してください。');
      return;
    }
    if (selectedFile.size > MAX_UPLOAD_BYTES) {
      setError('ファイルが大きすぎるためアップロードできません。（32 MB 以下にしてください）');
      onLog(
        'error',
        'Upload aborted because file exceeded Cloud Run limit.',
        `Size ${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB`,
      );
      return;
    }

    setIsLoading(true);
    setError(null);
    onLog('process', `Uploading file: ${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB)`);
    onLog('process', 'Sending to analysis server...');

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      const contentType = response.headers.get('content-type') ?? '';
      const rawBody = await response.text();
      const tryParseJson = (): any => {
        try {
          return JSON.parse(rawBody);
        } catch {
          return null;
        }
      };
      const parsed: any = tryParseJson();
      if (!parsed && rawBody.trim().startsWith('<')) {
        onLog('error', 'Server returned HTML instead of JSON.', rawBody.slice(0, 400));
      }

      if (!response.ok) {
        if (parsed?.command) {
          onLog('info', 'CLI command issued', parsed.command);
        }
        const details = parsed?.details || parsed?.error || rawBody || 'Unknown server error';
        throw new Error(details);
      }

      const metrics: AudioMetrics | undefined = parsed?.metrics;
      if (!metrics) {
        throw new Error(parsed ? JSON.stringify(parsed) : 'Server response missing metrics');
      }

      setAnalysisResult(metrics);
      onLog('success', 'Server processed audio successfully.');
      onLog('info', `Result: LUFS=${metrics.lufs}, Peak=${metrics.truePeak}`);
    } catch (err) {
      console.error('Audio analysis failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      setError('分析中にエラーが発生しました。もう一度お試しください。');
      onLog('error', 'Audio analysis failed.', message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProceedToDashboard = () => {
    if (analysisResult) {
      onLog('process', 'Transitioning to mastering dashboard.');
      onAnalysisComplete(analysisResult, selectedFile);
    }
  };

  return (
    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700 space-y-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Step 1</p>
        <h2 className="text-2xl font-extrabold text-white">オーディオファイルを分析</h2>
        <p className="text-sm text-gray-400">
          32 MB 以下の WAV/AIFF をアップロードしてください。Cloud Run の制限を超えるとアップロードできません。
        </p>
      </div>

      <div className="space-y-4">
        <label htmlFor="audio-upload" className="block text-sm font-medium text-gray-200">
          ソースファイル
        </label>
        <input
          id="audio-upload"
          type="file"
          accept="audio/*"
          onChange={handleFileChange}
          className="block w-full text-sm text-gray-300
                     file:mr-4 file:py-2 file:px-4
                     file:rounded-full file:border-0
                     file:text-sm file:font-semibold
                     file:bg-blue-50 file:text-blue-800
                     hover:file:bg-blue-100 cursor-pointer"
        />
        {selectedFile && (
          <p className="text-xs text-gray-400">
            選択中: <span className="font-semibold text-blue-300">{selectedFile.name}</span>{' '}
            ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
          </p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          onClick={handleAnalyzeClick}
          disabled={!selectedFile || isLoading}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? <LoadingSpinner /> : 'オーディオを分析'}
        </button>
        {analysisResult && (
          <button
            onClick={handleProceedToDashboard}
            className="border border-green-400 text-green-300 px-4 py-2 rounded-lg text-sm hover:bg-green-400/10 transition"
          >
            ダッシュボードに進む
          </button>
        )}
      </div>

      {analysisResult && (
        <div className="space-y-6 pt-4 border-t border-gray-700">
          <h3 className="text-lg font-semibold text-green-300">初期分析結果</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricsDisplay label="現状（分析結果）" metrics={analysisResult} />
            <MetricsDisplay label="目標（配信: streaming 想定）" metrics={TARGET_METRICS} />
          </div>
        </div>
      )}
    </div>
  );
};

export default AudioUploadAnalysis;
