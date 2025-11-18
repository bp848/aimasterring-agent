import { AudioMetrics } from '../types';
import { DEFAULT_INITIAL_METRICS } from '../constants';

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
      console.warn('Backend audio analysis failed. Fallback to Web Audio API.', error);
      try {
        return await analyzeInBrowser(file);
      } catch (browserError) {
        console.error('Browser-based analysis failed:', browserError);
        throw browserError instanceof Error
          ? browserError
          : new Error('音声解析に失敗しました。ネットワーク状態を確認してください。');
      }
    }
  };

  return { analyzeAudio };
};

const analyzeInBrowser = async (file: File): Promise<AudioMetrics> => {
  let audioContext: AudioContext | null = null;

  try {
    audioContext = createAudioContext();
  } catch (error) {
    console.warn('Web Audio API is not available in this environment.', error);
    return {
      ...DEFAULT_INITIAL_METRICS,
      notes: '解析サーバーとWeb Audio APIの両方が利用できないため、既定値を表示しています。',
    };
  }

  const arrayBuffer = await file.arrayBuffer();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const metrics = analyzeBuffer(audioBuffer, file.name);
    return metrics;
  } catch (error) {
    console.error('Audio analysis failed:', error);
    throw new Error('オーディオの解析に失敗しました。別のファイルでお試しください。');
  } finally {
    if (audioContext) {
      try {
        await audioContext.close();
      } catch (closeError) {
        console.warn('Failed to close AudioContext', closeError);
      }
    }
  }
};

const createAudioContext = (): AudioContext => {
  if (typeof window === 'undefined') {
    throw new Error('ブラウザ環境でのみオーディオ解析が可能です。');
  }

  const extendedWindow = window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  };

  const AudioContextClass = extendedWindow.AudioContext || extendedWindow.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error('このブラウザでは Web Audio API がサポートされていません。');
  }

  return new AudioContextClass();
};

const analyzeBuffer = (audioBuffer: AudioBuffer, fileName: string): AudioMetrics => {
  const { length, numberOfChannels, sampleRate } = audioBuffer;

  if (length === 0) {
    throw new Error('空のオーディオファイルは解析できません。');
  }

  const channelCount = Math.max(1, numberOfChannels);
  let peak = 0;
  let sumSquares = 0;

  for (let i = 0; i < length; i += 1) {
    let mixedSample = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      mixedSample += audioBuffer.getChannelData(channel)[i];
    }
    mixedSample /= channelCount;

    const absSample = Math.abs(mixedSample);
    if (absSample > peak) {
      peak = absSample;
    }

    sumSquares += mixedSample * mixedSample;
  }

  const rms = Math.sqrt(sumSquares / length);
  const peakDb = toDb(peak);
  const rmsDb = toDb(rms);
  const crest = peakDb - rmsDb;
  const approxLufs = rmsDb - 0.5; // LUFS 近似値（簡易補正）

  return {
    lufs: roundToDecimal(approxLufs),
    truePeak: roundToDecimal(peakDb),
    crest: roundToDecimal(crest),
    sampleRate: roundToDecimal(sampleRate / 1000), // kHz 表記 (例: 44.1)
    bitDepth: '24-bit', // decodeAudioData は 32-bit float だが表示は簡易値
    notes: `ブラウザ内解析結果 (${fileName})`,
  };
};

const toDb = (value: number): number => {
  const clamped = Math.max(value, 1e-9);
  return 20 * Math.log10(clamped);
};

const roundToDecimal = (value: number, decimals = 1): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
