export interface AudioMetrics {
  lufs: number | null;
  truePeak: number | null;      // dBTP
  crest: number | null;         // dB
  sampleRate?: number | null;   // kHz 表記 or 44.1 など
  bitDepth?: string | null;     // 16-bit / 24-bit など
  notes?: string | null;
}

export interface MasteringStep {
  title: string;
  description: string;
}

export interface MasteringParameters {
  // A. ゲイン周り
  inputTrimDb: number;          // apply_gain 前のトリム

  // B. コンプレッサ
  compThresholdDbfs: number;    // --comp-threshold
  compRatio: number;            // --comp-ratio
  compAttackMs: number;         // --attack
  compReleaseMs: number;        // --release

  // C. EQ（オプション: Shelving）
  eqLowHz: number;
  eqLowDb: number;
  eqLowQ: number;

  eqHighHz: number;
  eqHighDb: number;
  eqHighQ: number;

  // D. リミッタ
  targetLufs: number;           // --target-lufs
  truePeak: number;             // --true-peak
  limiterCeilingDb: number;     // brickwall_limiter ceiling_db
  limiterLookaheadMs: number;
  limiterReleaseMs: number;

  // E. メタ情報
  platform: 'streaming' | 'beatport' | 'cd' | 'youtube';
  profileName: string;          // "Streaming Default" など
  masteredAudioUrl?: string | null;
}

export type AgentActionStatus = 'pending' | 'in_progress' | 'success' | 'error';

export interface AgentActionEvent {
  id: string;
  label: string;
  status: AgentActionStatus;
  detail?: string | null;
  timestamp: string;
}
