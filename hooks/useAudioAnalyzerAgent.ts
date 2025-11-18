import { AudioMetrics } from '../types';

interface UseAudioAnalyzerAgentResult {
  analyzeAudio: (file: File) => Promise<AudioMetrics>;
}

export const useAudioAnalyzerAgent = (): UseAudioAnalyzerAgentResult => {
  const analyzeAudio = async (file: File): Promise<AudioMetrics> => {
    const apiUrl = import.meta.env.VITE_ANALYZE_API_URL ?? '/api/analyze';
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || '解析APIへの接続に失敗しました。');
      }
      const json = (await response.json()) as { metrics?: AudioMetrics };
      if (!json.metrics) {
        throw new Error('サーバーから有効な解析結果を取得できませんでした。');
      }
      return json.metrics;
    } catch (error) {
      console.error('Audio analysis failed:', error);
      throw error instanceof Error
        ? error
        : new Error('音声解析に失敗しました。ネットワーク状態を確認してください。');
    }
  };

  return { analyzeAudio };
};
