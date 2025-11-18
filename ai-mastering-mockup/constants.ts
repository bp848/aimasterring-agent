import { AudioMetrics, MasteringStep, MasteringParameters } from './types';

export const DEFAULT_INITIAL_METRICS: AudioMetrics = {
  lufs: -18.0,
  truePeak: -3.5,
  crest: 12.5,
  sampleRate: 44.1,
  bitDepth: '24-bit',
  notes: 'アップロード前のプレースホルダ値。解析後に実測値で上書きされます。',
};

export const TARGET_METRICS: AudioMetrics = {
  lufs: -14.0,
  truePeak: -1.0,
  crest: 9.5,
  sampleRate: null, // Not directly a target, but inferred from context
  bitDepth: null, // Not directly a target, but inferred from context
  notes: 'Suno などでもクリップ警告を避けるため TP マージンは最低 -1.0。',
};

export const DIFFERENCE_METRICS: AudioMetrics = {
  lufs: +(TARGET_METRICS.lufs! - DEFAULT_INITIAL_METRICS.lufs!),
  truePeak: +(TARGET_METRICS.truePeak! - DEFAULT_INITIAL_METRICS.truePeak!),
  crest: -(DEFAULT_INITIAL_METRICS.crest! - TARGET_METRICS.crest!), // Crest factor is reduced for more punch
  sampleRate: null,
  bitDepth: null,
  notes: '+1.8 dB のラウドアップ余地、+1.6 dB のピークマージン、Crest を 2-3 dB 縮めてパンチを出す必要。',
};

export const MASTERING_PRESCRIPTION: MasteringStep[] = [
  {
    title: '1. トリム/サチュレーション前調整',
    description: 'インプットを -1.5 dB 付近でトリムし、不要なクリップやサチュレーションを避けつつチェーン全体のヘッドルームを確保。',
  },
  {
    title: '2. ワイドバンドコンプ (RMS 検出)',
    description: 'Ratio 1.6:1 / Threshold -13 dBFS / Attack 12 ms / Release 80 ms で平均 1.5〜2 dB の GR を狙い、低域のピークのみを滑らかにして Crest を 2〜3 dB 縮める。',
  },
  {
    title: '3. ブロード EQ (必要なら)',
    description: '120 Hz シェルフ -0.8 dB / Q 0.7 でローエンドを締め、3.5 kHz シェルフ +0.6 dB / Q 0.7 で抜けを補正。±1 dB 以内に抑えトーンに大きな変化を与えない。',
  },
  {
    title: '4. リミッタ',
    description: 'Ceiling -1.0 dBTP / Lookahead 1 ms / Release 40 ms で LUFS -14 を目指し、リダクションは 2 dB 以内。ピークは -1 dBTP を超えさせない。',
  },
  {
    title: '5. 最終チェック',
    description: 'LUFS / True Peak / Crest を再測定し、TP が -1 dBTP を超える場合は全体を 0.2 dB ずつ引き下げる。ターゲットに収まっていれば納品準備完了。',
  },
];

export const MOCKED_AI_MASTERING_PARAMS: MasteringParameters = {
  inputTrimDb: -1.5,
  compThresholdDbfs: -13.0,
  compRatio: 1.6,
  compAttackMs: 12.0,
  compReleaseMs: 80.0,
  eqLowHz: 120.0,
  eqLowDb: -0.8,
  eqLowQ: 0.7,
  eqHighHz: 3500.0,
  eqHighDb: 0.6,
  eqHighQ: 0.7,
  targetLufs: -14.0,
  truePeak: -1.0,
  limiterCeilingDb: -1.0,
  limiterLookaheadMs: 1.0,
  limiterReleaseMs: 40.0,
  platform: 'streaming',
  profileName: 'Streaming Default',
};

export const MOCKED_FINAL_METRICS: AudioMetrics = {
  lufs: -14.1,
  truePeak: -1.0,
  crest: 9.2,
  sampleRate: 48,
  bitDepth: '24-bit',
  notes: 'バックエンド未接続時に表示する模擬メトリクス。',
};

export const MOCKED_MASTERED_AUDIO_URL = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3';
