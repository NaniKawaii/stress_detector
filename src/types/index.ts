export interface AnalysisFrame {
    emotion: EmotionResult;
    age: AgeResult;
    attention: AttentionResult;
    fatigue: FatigueResult;
    headPose: HeadPoseResult;
}

export interface EmotionResult {
    label: string;
    score: number;
}

export interface AgeResult {
    age: number;
    confidence: number;
}

export interface AttentionResult {
    level: number; // 0-100
    gazingAway: boolean;
}

export interface FatigueResult {
    level: string; // "Baja" | "Media" | "Alta"
    blinkRate: number;
    eyeAspectRatio: number;
}

export interface HeadPoseResult {
    yaw: number;
    pitch: number;
    roll: number;
}

export interface BaselineStats {
    emotion: { mean: number; std: number };
    blinkRate: { mean: number; std: number };
    gazeAway: { mean: number; std: number };
    headMotion: { mean: number; std: number };
}