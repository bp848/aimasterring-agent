import React, { useState } from 'react';
import { AudioMetrics } from '../types';
import LoadingSpinner from './LoadingSpinner';
import MetricsDisplay from './MetricsDisplay';
import { TARGET_METRICS } from '../constants';

export interface UploadedSource {
  objectUrl: string;
  publicUrl?: string;
  expiresAt: string;
  filename: string;
  contentType: string;
  size: number;
}

interface AudioUploadAnalysisProps {
  onAnalysisComplete: (metrics: AudioMetrics, file: File | null, source: UploadedSource) => void;
  onLog: (type: 'info' | 'success' | 'error' | 'process', message: string, details?: string) => void;
}

const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB ?? '512');
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

const AudioUploadAnalysis: React.FC<AudioUploadAnalysisProps> = ({ onAnalysisComplete, onLog }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AudioMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteSource, setRemoteSource] = useState<UploadedSource | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const resetStateForNewFile = () => {
    setAnalysisResult(null);
    setRemoteSource(null);
    setError(null);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      const file = event.target.files[0];
      if (file.size > MAX_UPLOAD_BYTES) {
        const message = `ファイルサイズ ${(file.size / 1024 / 1024).toFixed(2)} MB は上限 (${MAX_UPLOAD_MB} MB) を超えています。`;
        setSelectedFile(null);
        setError(message);
        onLog('error', 'File rejected because it exceeds the configured upload limit.', message);
        return;
      }
      setSelectedFile(file);
      resetStateForNewFile();
    }
  };

  const requestUploadUrl = async (file: File) => {
    const response = await fetch('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        fileSize: file.size,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || '署名付きURLの取得に失敗しました。');
    }
    return response.json() as Promise<{ uploadUrl: string; objectUrl: string; publicUrl?: string; expiresAt: string }>;
  };

  const ensureRemoteUpload = async (): Promise<UploadedSource | null> => {
    if (!selectedFile) {
      return null;
    }
    if (
      remoteSource &&
      remoteSource.filename === selectedFile.name &&
      remoteSource.size === selectedFile.size &&
      Date.parse(remoteSource.expiresAt) > Date.now()
    ) {
      return remoteSource;
    }

    setIsUploading(true);
    try {
      onLog('process', 'Requesting signed upload URL from backend...');
      const signed = await requestUploadUrl(selectedFile);
      onLog('process', 'Uploading file to object storage...');

      const uploadResponse = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': selectedFile.type || 'application/octet-stream',
        },
        body: selectedFile,
      });
      if (!uploadResponse.ok) {
        throw new Error(`署名付きURLへのアップロードに失敗しました: HTTP ${uploadResponse.status}`);
      }

      const remote: UploadedSource = {
        objectUrl: signed.objectUrl,
        publicUrl: signed.publicUrl,
        expiresAt: signed.expiresAt,
        filename: selectedFile.name,
        contentType: selectedFile.type || 'application/octet-stream',
        size: selectedFile.size,
      };
      setRemoteSource(remote);
      onLog('success', 'Upload completed.');
      return remote;
    } finally {
      setIsUploading(false);
    }
  };

  const handleAnalyzeClick = async () => {
    if (!selectedFile) {
      setError('オーディオファイルを選択してください。');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const remote = await ensureRemoteUpload();
      if (!remote) {
        throw new Error('リモートアップロードに失敗したため解析を続行できません。');
      }

      onLog('process', 'Sending source URL to analysis server...');
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl: remote.objectUrl }),
      });

      const rawBody = await response.text();
      const parsed = (() => {
        try {
          return JSON.parse(rawBody);
        } catch {
          return null;
        }
      })();
      if (!parsed && rawBody.trim().startsWith('<')) {
        onLog('error', 'Server returned HTML instead of JSON.', rawBody.slice(0, 400));
      }

      if (!response.ok) {
        const details = parsed?.details || parsed?.error || rawBody || 'Unknown server error';
        throw new Error(details);
      }

      const metrics: AudioMetrics | undefined = parsed?.metrics;
      if (!metrics) {
        throw new Error('サーバー応答に metrics が含まれていません。');
      }

      setAnalysisResult(metrics);
      onLog('success', 'Server processed audio successfully.');
      onLog('info', `Result: LUFS=${metrics.lufs}, Peak=${metrics.truePeak}`);
      onAnalysisComplete(metrics, selectedFile, remote);
    } catch (err) {
      console.error('Audio analysis failed:', err);
      const message = err instanceof Error ? err.message : String(err);
      setError('分析中にエラーが発生しました。もう一度お試しください。');
      onLog('error', 'Audio analysis failed.', message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const isBusy = isAnalyzing || isUploading;

  return (
    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700 space-y-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Step 1</p>
        <h2 className="text-2xl font-extrabold text-white">オーディオファイルを分析</h2>
        <p className="text-sm text-gray-400">
          署名付き URL を使用して最大 {MAX_UPLOAD_MB} MB のファイルを直接クラウドストレージへアップロードします。
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
          disabled={!selectedFile || isBusy}
          className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isBusy ? <LoadingSpinner /> : 'オーディオを分析'}
        </button>
        {analysisResult && (
          <span className="text-xs text-green-300">アップロード済みのファイルで解析が完了しました。</span>
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
