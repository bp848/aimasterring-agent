import { useState } from 'react';
import { MasteringParameters, AudioMetrics, AgentActionEvent } from '../types';
import {
  TARGET_METRICS,
  MOCKED_AI_MASTERING_PARAMS,
  MOCKED_FINAL_METRICS,
  MOCKED_MASTERED_AUDIO_URL,
} from '../constants';

export interface StartMasteringOptions {
  initialMetrics: AudioMetrics;
  targetMetrics?: AudioMetrics;
  originalFile?: File | null;
  platformId?: string;
}

export interface UseAiMasteringAgentResult {
  startMasteringSimulation: (
    options: StartMasteringOptions
  ) => Promise<{ params: MasteringParameters; finalMetrics: AudioMetrics; masteredAudioUrl: string | null }>;
  statusMessage: string | null;
  errorMessage: string | null;
  actionLog: AgentActionEvent[];
}

const MASTERING_PARAMS_ENDPOINT = import.meta.env.VITE_MASTERING_PARAMS_API_URL ?? '/api/mastering-params';
const MASTERING_JOB_ENDPOINT = import.meta.env.VITE_MASTERING_API_URL ?? '/api/master';

export const useAiMasteringAgent = (): UseAiMasteringAgentResult => {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<AgentActionEvent[]>([]);

  const seedActionLog = () => {
    const now = new Date().toISOString();
    setActionLog([
      createActionEvent('gemini', 'Gemini パラメータ生成', 'pending', now),
      createActionEvent('upload', 'オーディオアップロード/ジョブ発行', 'pending', now),
      createActionEvent('monitor', 'ジョブ監視/最終取得', 'pending', now),
    ]);
  };

  const updateAction = (id: string, updates: Partial<AgentActionEvent>) => {
    setActionLog((prev) =>
      prev.map((action) =>
        action.id === id
          ? {
              ...action,
              ...updates,
              timestamp: updates.timestamp ?? new Date().toISOString(),
            }
          : action,
      ),
    );
  };

  const startMasteringSimulation = async (
    options: StartMasteringOptions,
  ): Promise<{ params: MasteringParameters; finalMetrics: AudioMetrics; masteredAudioUrl: string | null }> => {
    if (!options?.initialMetrics) {
      throw new Error('initialMetrics is required to start mastering.');
    }

    setErrorMessage(null);
    seedActionLog();
    const platform = resolvePlatform(options.platformId);
    const currentMetrics = options.initialMetrics;
    const targetMetrics = options.targetMetrics ?? TARGET_METRICS;

    let params: MasteringParameters;
    setStatusMessage('Gemini にパラメータをリクエストしています...');
    updateAction('gemini', { status: 'in_progress' });
    try {
      const responseParams = await requestMasteringParametersFromBackend({
        platform,
        currentMetrics,
        targetMetrics,
      });
      params = normalizeParams(responseParams, platform);
      setStatusMessage('Gemini 応答を検証しました。');
      updateAction('gemini', { status: 'success', detail: 'パラメータを取得しました。' });
    } catch (error) {
      console.error('Gemini 呼び出しに失敗したためフェイルセーフ値を使用します。', error);
      setErrorMessage('Gemini 応答を取得できなかったため、推奨プリセットで進行します。');
      params = normalizeParams(MOCKED_AI_MASTERING_PARAMS, platform);
      updateAction('gemini', { status: 'error', detail: 'Gemini API 応答が得られないためフェイルセーフに切り替えました。' });
    }

    if (!options.originalFile) {
      setErrorMessage('元音源ファイルが見つからないため、バックエンド連携をスキップしました。');
       updateAction('upload', { status: 'error', detail: 'アップロードファイルがありません。' });
       updateAction('monitor', { status: 'error', detail: 'マスタリングジョブを開始できません。' });
      return {
        params,
        finalMetrics: MOCKED_FINAL_METRICS,
        masteredAudioUrl: MOCKED_MASTERED_AUDIO_URL,
      };
    }

    setStatusMessage('Python マスタリングエンジンでジョブを起動しています...');
    updateAction('upload', { status: 'in_progress', detail: 'ファイル送信中...' });
    updateAction('monitor', { status: 'pending', detail: null });
    try {
      const backendResult = await callMasteringBackend(params, options.originalFile, (message) => {
        setStatusMessage(message);
        if (message) {
          updateAction('monitor', { status: 'in_progress', detail: message });
        }
      });
      updateAction('upload', { status: 'success', detail: 'バックエンドジョブをキューしました。' });
      updateAction('monitor', { status: 'success', detail: 'マスタリング結果を取得しました。' });
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
      };
    } catch (error) {
      console.error('バックエンドマスタリングに失敗しました。', error);
      setErrorMessage('バックエンドマスタリングに失敗したためモック結果を表示します。');
      updateAction('upload', { status: 'error', detail: 'マスタリングAPIとの通信に失敗しました。' });
      updateAction('monitor', { status: 'error', detail: 'ジョブ完了前にエラーが発生しました。' });
      return {
        params,
        finalMetrics: MOCKED_FINAL_METRICS,
        masteredAudioUrl: MOCKED_MASTERED_AUDIO_URL,
      };
    }
  };

  return { startMasteringSimulation, statusMessage, errorMessage, actionLog };
};

const createActionEvent = (
  id: string,
  label: string,
  status: AgentActionEvent['status'],
  timestamp: string,
  detail?: string,
): AgentActionEvent => ({
  id,
  label,
  status,
  detail: detail ?? null,
  timestamp,
});

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
    throw new Error(text || 'Gemini パラメータAPI呼び出しに失敗しました。');
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
  originalFile: File,
  onProgress?: (message: string | null) => void,
): Promise<{ masteredAudioUrl: string | null; finalMetrics: AudioMetrics | null }> => {
  const formData = new FormData();
  formData.append('file', originalFile);
  formData.append('params', JSON.stringify(params));

  onProgress?.('ファイルをアップロード中...');
  const response = await fetch(MASTERING_JOB_ENDPOINT, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'マスタリングAPIへの接続に失敗しました。');
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
      throw new Error(text || 'ジョブステータスの取得に失敗しました。');
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
