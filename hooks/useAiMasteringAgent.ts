import { useState } from 'react';
import { MasteringParameters, AudioMetrics } from '../types';
import {
  TARGET_METRICS,
  MOCKED_AI_MASTERING_PARAMS,
  MOCKED_FINAL_METRICS,
  MOCKED_MASTERED_AUDIO_URL,
} from '../constants';

export interface StartMasteringOptions {
  initialMetrics: AudioMetrics;
  targetMetrics?: AudioMetrics;
  platformId?: string;
  sourceUrl: string;
}

export interface MasteringResult {
  params: MasteringParameters;
  finalMetrics: AudioMetrics;
  masteredAudioUrl: string | null;
  meta: {
    usedMockResult: boolean;
    reason?: string;
  };
}

export interface UseAiMasteringAgentResult {
  startMasteringSimulation: (options: StartMasteringOptions) => Promise<MasteringResult>;
  statusMessage: string | null;
  errorMessage: string | null;
}

const MAX_ERROR_LENGTH = 400;

const formatBackendErrorMessage = (rawText: string | null | undefined, fallback: string): string => {
  if (!rawText) {
    return fallback;
  }
  const trimmed = rawText.trim();
  if (!trimmed) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(trimmed) as { error?: string; details?: unknown };
    const baseMessage = typeof parsed.error === 'string' ? parsed.error : fallback;
    const detailMessage = parseErrorDetails(parsed.details);
    if (detailMessage) {
      return `${baseMessage} (${detailMessage})`;
    }
    return baseMessage;
  } catch {
    return trimmed.length > MAX_ERROR_LENGTH ? `${trimmed.slice(0, MAX_ERROR_LENGTH)}…` : trimmed;
  }
};

const parseErrorDetails = (details: unknown): string | null => {
  if (!details) {
    return null;
  }
  if (typeof details === 'string') {
    return details;
  }
  if (typeof details === 'object' && !Array.isArray(details)) {
    const detailObj = details as Record<string, unknown>;
    if (Array.isArray(detailObj.formErrors) && detailObj.formErrors.length > 0) {
      const formErrors = detailObj.formErrors.filter((value): value is string => typeof value === 'string');
      if (formErrors.length > 0) {
        return formErrors.join(', ');
      }
    }
    if (typeof detailObj.command === 'string') {
      return detailObj.command;
    }
    if (typeof detailObj.message === 'string') {
      return detailObj.message;
    }
  }
  return null;
};

const MASTERING_PARAMS_ENDPOINT = import.meta.env.VITE_MASTERING_PARAMS_API_URL ?? '/api/mastering-params';
const MASTERING_JOB_ENDPOINT = import.meta.env.VITE_MASTERING_API_URL ?? '/api/master';

export const useAiMasteringAgent = (): UseAiMasteringAgentResult => {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startMasteringSimulation = async (options: StartMasteringOptions): Promise<MasteringResult> => {
    if (!options?.initialMetrics) {
      throw new Error('initialMetrics is required to start mastering.');
    }
    if (!options.sourceUrl) {
      throw new Error('sourceUrl is required to start mastering.');
    }

    setErrorMessage(null);
    const platform = resolvePlatform(options.platformId);
    const currentMetrics = options.initialMetrics;
    const targetMetrics = options.targetMetrics ?? TARGET_METRICS;

    let params: MasteringParameters;
    setStatusMessage('Gemini にパラメータをリクエストしています...');
    try {
      const responseParams = await requestMasteringParametersFromBackend({
        platform,
        currentMetrics,
        targetMetrics,
      });
      params = normalizeParams(responseParams, platform);
      setStatusMessage('Gemini 応答を検証しました。');
    } catch (error) {
      console.error('Gemini 呼び出しに失敗したためフェイルセーフ値を使用します。', error);
      setErrorMessage('Gemini 応答を取得できなかったため、推奨プリセットで進行します。');
      params = normalizeParams(MOCKED_AI_MASTERING_PARAMS, platform);
    }

    setStatusMessage('Python マスタリングエンジンでジョブを起動しています...');
    try {
      const backendResult = await callMasteringBackend(params, options.sourceUrl, setStatusMessage);
      const finalMetrics: AudioMetrics = backendResult.finalMetrics ?? MOCKED_FINAL_METRICS;
      const masteredAudioUrl: string | null = backendResult.masteredAudioUrl ?? MOCKED_MASTERED_AUDIO_URL;

      if (!backendResult.masteredAudioUrl) {
        setErrorMessage((prev) => prev ?? 'マスタリングAPIから有効な応答を取得できなかったためモックデータを表示しています。');
      } else {
        setErrorMessage(null);
      }

      setStatusMessage('マスタリングチェーンが完了しました。');

      return {
        params: { ...params, masteredAudioUrl },
        finalMetrics,
        masteredAudioUrl,
        meta: { usedMockResult: false },
      };
    } catch (error) {
      console.error('バックエンドマスタリングに失敗しました。', error);
      const reason =
        (error instanceof Error && error.message) || 'バックエンドマスタリングに失敗したためモック結果を表示します。';
      setErrorMessage(reason);
      return {
        params,
        finalMetrics: MOCKED_FINAL_METRICS,
        masteredAudioUrl: MOCKED_MASTERED_AUDIO_URL,
        meta: { usedMockResult: true, reason },
      };
    }
  };

  return { startMasteringSimulation, statusMessage, errorMessage };
};

const requestMasteringParametersFromBackend = async ({
  platform,
  currentMetrics,
  targetMetrics,
}: {
  platform: MasteringParameters['platform'];
  currentMetrics: AudioMetrics;
  targetMetrics: AudioMetrics;
}): Promise<MasteringParameters> => {
  const response = await fetch(MASTERING_PARAMS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      platform,
      currentMetrics,
      targetMetrics,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    const message = formatBackendErrorMessage(text, 'Gemini パラメータAPI呼び出しに失敗しました。');
    throw new Error(message);
  }
  const json = (await response.json()) as { params?: MasteringParameters };
  if (!json.params) {
    throw new Error('Gemini パラメータAPIからパラメータを取得できませんでした。');
  }
  return json.params;
};

const normalizeParams = (
  params: Partial<MasteringParameters>,
  platform: MasteringParameters['platform'],
): MasteringParameters => {
  const fallback = { ...MOCKED_AI_MASTERING_PARAMS, platform };
  return {
    ...fallback,
    ...params,
    platform: (params.platform as MasteringParameters['platform']) ?? platform,
    profileName: params.profileName ?? fallback.profileName,
  };
};

const resolvePlatform = (value?: string): MasteringParameters['platform'] => {
  if (value === 'beatport' || value === 'cd' || value === 'youtube') {
    return value;
  }
  return 'streaming';
};

const callMasteringBackend = async (
  params: MasteringParameters,
  sourceUrl: string,
  onProgress?: (message: string | null) => void,
): Promise<{ masteredAudioUrl: string | null; finalMetrics: AudioMetrics | null }> => {
  onProgress?.('音源URLを送信しています...');
  const response = await fetch(MASTERING_JOB_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceUrl, params }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    const message = formatBackendErrorMessage(errorText, 'マスタリングAPIへの接続に失敗しました。');
    throw new Error(message);
  }
  const json = (await response.json()) as { jobId?: string };
  if (!json.jobId) {
    throw new Error('ジョブIDが応答に含まれていません。');
  }

  const jobStatusUrl = `${MASTERING_JOB_ENDPOINT.replace(/\/$/, '')}/${json.jobId}`;
  onProgress?.('マスタリングジョブを監視しています...');
  const job = await pollMasteringJob(jobStatusUrl, onProgress);
  return {
    masteredAudioUrl: typeof job.masteredAudioUrl === 'string' ? job.masteredAudioUrl : null,
    finalMetrics: job.finalMetrics ?? null,
  };
};

interface MasteringJobStatus {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  masteredAudioUrl?: string | null;
  finalMetrics?: AudioMetrics | null;
  error?: string;
  progress?: number;
}

const pollMasteringJob = async (statusUrl: string, onProgress?: (message: string | null) => void) => {
  const timeoutMs = 120_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch(statusUrl, { method: 'GET', cache: 'no-store' });
    if (!response.ok) {
      const text = await response.text();
      const message = formatBackendErrorMessage(text, 'ジョブステータスの取得に失敗しました。');
      throw new Error(message);
    }
    const job = (await response.json()) as MasteringJobStatus;
    if (job.status === 'completed') {
      return job;
    }
    if (job.status === 'error') {
      throw new Error(job.error ?? 'マスタリングジョブが失敗しました。');
    }
    const progressPercent = job.progress ? Math.round(job.progress * 100) : 0;
    onProgress?.(`マスタリング中... (${progressPercent}%)`);
    await sleep(2000);
  }
  throw new Error('マスタリング結果の取得がタイムアウトしました。');
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
