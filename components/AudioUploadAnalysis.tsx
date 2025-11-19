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
    <div className="container mx-auto p-4 sm:p-6 lg:p-8 flex items-center justify-center min-h-[calc(100vh-80px)]">
      <div className="bg-gray-800 p-8 rounded-lg shadow-xl border border-gray-700 max-w-2xl w-full text-center">
        <h2 className="text-3xl font-extrabold text-blue-300 mb-6">オーディオファイルを分析</h2>

        <div className="mb-8">
          <label htmlFor="audio-upload" className="block text-gray-300 text-lg font-medium mb-3">
            マスタリングしたいオーディオを選択してください
          </label>
          <input
            id="audio-upload"
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500
                       file:mr-4 file:py-2 file:px-4
                       file:rounded-full file:border-0
                       file:text-sm file:font-semibold
                       file:bg-blue-50 file:text-blue-700
                       hover:file:bg-blue-100 cursor-pointer"
          />
          {selectedFile && (
            <p className="mt-4 text-gray-400 text-sm">選択中のファイル: <span className="font-semibold text-blue-300">{selectedFile.name}</span></p>
          )}
          {error && <p className="mt-4 text-red-400 text-sm">{error}</p>}
        </div>

        <button
          onClick={handleAnalyzeClick}
          disabled={!selectedFile || isLoading}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-full text-lg shadow-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105"
        >
          {isLoading ? (
            <LoadingSpinner />
          ) : (
            'オーディオを分析'
          )}
        </button>

        {analysisResult && (
          <div className="mt-10 pt-8 border-t border-gray-700">
            <h3 className="text-2xl font-bold text-green-400 mb-6">初期分析結果:</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <MetricsDisplay label="現状（分析結果）" metrics={analysisResult} />
                <MetricsDisplay label="目標（配信: streaming 想定）" metrics={TARGET_METRICS} />
            </div>
            <button
              onClick={handleProceedToDashboard}
              className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-full text-lg shadow-lg transition-all duration-300 transform hover:scale-105"
            >
              マスタリングダッシュボードに進む
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AudioUploadAnalysis;
