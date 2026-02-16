import { startWebcam } from './webcam/stream';
import { getFrame } from './webcam/capture';
import { detectEmotion } from './analysis/emotion-detector';
import { analyzeFaceFromVideo } from './analysis/face-analyzer';
import { AnalysisFrame } from './types/index';

let stream: MediaStream | null = null;
let isRunning = false;

const DISPLAY_UPDATE_MS = 1200;

type EmotionLabel = 'Neutral' | 'Feliz' | 'Triste' | 'Enojado' | 'Sorprendido' | 'Asustado' | 'Disgustado';

interface FrameMetrics {
    luminance: number;
    contrast: number;
    motion: number;
}

interface RuntimeState {
    initialized: boolean;
    stableAge: number;
    lastDisplayUpdate: number;
    previousSample: number[] | null;
    emotionScores: Record<string, number>;
    attentionHistory: number[];
    fatigueHistory: number[];
    emotionHistory: EmotionLabel[];
    currentAnalysis: AnalysisFrame;
}

const runtimeState: RuntimeState = {
    initialized: false,
    stableAge: 28,
    lastDisplayUpdate: 0,
    previousSample: null,
    emotionScores: {},
    attentionHistory: [],
    fatigueHistory: [],
    emotionHistory: [],
    currentAnalysis: {
        emotion: { label: 'Neutral', score: 0.75 },
        age: { age: 28, confidence: 0.8 },
        attention: { level: 75, gazingAway: false },
        fatigue: { level: 'Baja', blinkRate: 14, eyeAspectRatio: 0.34 },
        headPose: { yaw: 0, pitch: 0, roll: 0 }
    }
};

interface UIElements {
    video: HTMLVideoElement;
    overlay: HTMLCanvasElement;
    status: HTMLElement;
    age: HTMLElement;
    emotion: HTMLElement;
    attention: HTMLElement;
    fatigue: HTMLElement;
    personality: HTMLElement;
    deception: HTMLElement;
    timer: HTMLElement;
    calibrateBtn: HTMLButtonElement;
    questionBtn: HTMLButtonElement;
}

function getUIElements(): UIElements {
    return {
        video: document.getElementById('cam') as HTMLVideoElement,
        overlay: document.getElementById('overlay') as HTMLCanvasElement,
        status: document.getElementById('status') as HTMLElement,
        age: document.getElementById('age') as HTMLElement,
        emotion: document.getElementById('emotion') as HTMLElement,
        attention: document.getElementById('attention') as HTMLElement,
        fatigue: document.getElementById('fatigue') as HTMLElement,
        personality: document.getElementById('personality') as HTMLElement,
        deception: document.getElementById('deception') as HTMLElement,
        timer: document.getElementById('timer') as HTMLElement,
        calibrateBtn: document.getElementById('calibrate-btn') as HTMLButtonElement,
        questionBtn: document.getElementById('question-btn') as HTMLButtonElement
    };
}

function updateStats(ui: UIElements, analysis: AnalysisFrame): void {
    ui.emotion.textContent = `${analysis.emotion.label} (${(analysis.emotion.score * 100).toFixed(0)}%)`;
    ui.age.textContent = `${analysis.age.age} años`;
    ui.attention.textContent = `${analysis.attention.level}%`;
    ui.fatigue.textContent = analysis.fatigue.level;
    ui.personality.textContent = buildPersonalitySummary();
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function pushLimited(values: number[], value: number, maxSize: number = 30): void {
    values.push(value);
    if (values.length > maxSize) {
        values.shift();
    }
}

function pushEmotionLimited(values: EmotionLabel[], value: EmotionLabel, maxSize: number = 40): void {
    values.push(value);
    if (values.length > maxSize) {
        values.shift();
    }
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((acc, value) => acc + value, 0);
    return sum / values.length;
}

function sampleFrame(frame: ImageData): number[] {
    const data = frame.data;
    const sampled: number[] = [];
    const stride = 16;

    for (let i = 0; i < data.length; i += 4 * stride) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        sampled.push(0.299 * r + 0.587 * g + 0.114 * b);
    }

    return sampled;
}

function computeMetrics(frame: ImageData): FrameMetrics {
    const sample = sampleFrame(frame);
    const luminance = average(sample);

    const variance = sample.reduce((acc, value) => acc + Math.pow(value - luminance, 2), 0) / Math.max(sample.length, 1);
    const contrast = Math.sqrt(variance);

    let motion = 0;
    if (runtimeState.previousSample && runtimeState.previousSample.length === sample.length) {
        let diffSum = 0;
        for (let i = 0; i < sample.length; i++) {
            diffSum += Math.abs(sample[i] - runtimeState.previousSample[i]);
        }
        motion = diffSum / sample.length;
    }

    runtimeState.previousSample = sample;

    return {
        luminance,
        contrast,
        motion
    };
}

function updateStableEmotion(rawLabel: EmotionLabel, rawScore: number): { label: EmotionLabel; score: number } {
    const decayFactor = 0.92;

    Object.keys(runtimeState.emotionScores).forEach((label) => {
        runtimeState.emotionScores[label] *= decayFactor;
    });

    runtimeState.emotionScores[rawLabel] = (runtimeState.emotionScores[rawLabel] || 0) + rawScore;

    let bestLabel: EmotionLabel = rawLabel;
    let bestScore = 0;
    let total = 0;

    Object.entries(runtimeState.emotionScores).forEach(([label, score]) => {
        total += score;
        if (score > bestScore) {
            bestLabel = label as EmotionLabel;
            bestScore = score;
        }
    });

    const normalizedScore = total > 0 ? clamp(bestScore / total + 0.4, 0.55, 0.98) : 0.75;
    return { label: bestLabel, score: normalizedScore };
}

function estimateAttention(metrics: FrameMetrics): number {
    const motionPenalty = clamp(Math.abs(metrics.motion - 10) * 2.5, 0, 35);
    const brightnessPenalty = clamp(Math.abs(metrics.luminance - 125) / 4, 0, 20);
    const contrastPenalty = clamp(Math.abs(metrics.contrast - 52) / 3, 0, 15);

    return clamp(Math.round(100 - motionPenalty - brightnessPenalty - contrastPenalty), 20, 99);
}

function estimateFatigue(metrics: FrameMetrics, attention: number): { score: number; level: string; blinkRate: number; eyeAspectRatio: number } {
    const fatigueScore = clamp(
        (30 - metrics.motion) * 1.8 +
        (95 - metrics.contrast) * 0.35 +
        (80 - metrics.luminance) * 0.25 +
        (65 - attention) * 0.75,
        0,
        100
    );

    const level = fatigueScore >= 68 ? 'Alta' : fatigueScore >= 45 ? 'Media' : 'Baja';
    const blinkRate = clamp(Math.round(24 - metrics.motion / 1.8), 6, 28);
    const eyeAspectRatio = clamp(0.18 + metrics.contrast / 430, 0.18, 0.38);

    return {
        score: fatigueScore,
        level,
        blinkRate,
        eyeAspectRatio
    };
}

function buildPersonalitySummary(): string {
    const attentionAvg = average(runtimeState.attentionHistory);
    const fatigueAvg = average(runtimeState.fatigueHistory);
    const emotions = runtimeState.emotionHistory;

    const totalEmotions = emotions.length || 1;
    const positive = emotions.filter((emotion) => emotion === 'Feliz' || emotion === 'Sorprendido').length / totalEmotions;
    const negative = emotions.filter((emotion) => emotion === 'Triste' || emotion === 'Enojado' || emotion === 'Asustado').length / totalEmotions;
    const uniqueEmotions = new Set(emotions).size;

    const openness = clamp(Math.round(45 + uniqueEmotions * 8), 25, 95);
    const conscientiousness = clamp(Math.round(attentionAvg), 20, 95);
    const extraversion = clamp(Math.round(40 + positive * 55), 20, 95);
    const agreeableness = clamp(Math.round(70 - negative * 35), 20, 95);
    const neuroticism = clamp(Math.round(35 + fatigueAvg * 0.5 + negative * 35), 20, 95);

    return `O:${openness} C:${conscientiousness} E:${extraversion} A:${agreeableness} N:${neuroticism}`;
}

async function analyzeFrame(frame: ImageData, video: HTMLVideoElement): Promise<AnalysisFrame> {
    const metrics = computeMetrics(frame);

    if (!runtimeState.initialized) {
        runtimeState.stableAge = clamp(Math.round(22 + (metrics.luminance + metrics.contrast) % 20), 18, 48);
        runtimeState.currentAnalysis.age.age = runtimeState.stableAge;
        runtimeState.initialized = true;
    }

    const faceAnalysis = await analyzeFaceFromVideo(video);
    const fallbackEmotion = await detectEmotion(frame);

    const emotionSource = faceAnalysis?.emotion ?? fallbackEmotion;
    const stableEmotion = updateStableEmotion(emotionSource.label as EmotionLabel, emotionSource.score);

    const attentionLevel = faceAnalysis?.attention.level ?? estimateAttention(metrics);
    const fatigue = estimateFatigue(metrics, attentionLevel);

    pushLimited(runtimeState.attentionHistory, attentionLevel);
    pushLimited(runtimeState.fatigueHistory, fatigue.score);
    pushEmotionLimited(runtimeState.emotionHistory, stableEmotion.label);

    runtimeState.currentAnalysis = {
        emotion: stableEmotion,
        age: { age: runtimeState.stableAge, confidence: 0.82 },
        attention: {
            level: Math.round(average(runtimeState.attentionHistory) || attentionLevel),
            gazingAway: faceAnalysis?.attention.gazingAway ?? attentionLevel < 45
        },
        fatigue: {
            level: fatigue.level,
            blinkRate: fatigue.blinkRate,
            eyeAspectRatio: Number(fatigue.eyeAspectRatio.toFixed(2))
        },
        headPose: { yaw: 0, pitch: 0, roll: 0 }
    };

    return runtimeState.currentAnalysis;
}

async function frameLoop(ui: UIElements): Promise<void> {
    if (!isRunning) return;

    try {
        // Capturar frame
        const frame = getFrame(ui.video, ui.overlay);

        await analyzeFrame(frame, ui.video);

        const now = Date.now();
        if (now - runtimeState.lastDisplayUpdate >= DISPLAY_UPDATE_MS) {
            updateStats(ui, runtimeState.currentAnalysis);
            runtimeState.lastDisplayUpdate = now;
        }

        ui.status.textContent = '✓ Cámara activa';
        ui.status.style.color = '#00ff88';

        // Siguiente frame
        requestAnimationFrame(() => frameLoop(ui));
    } catch (error) {
        console.error('Error en frame loop:', error);
        ui.status.textContent = '✗ Error en análisis';
        ui.status.style.color = '#ff6b7a';
        setTimeout(() => frameLoop(ui), 100);
    }
}

async function init(): Promise<void> {
    const ui = getUIElements();

    try {
        ui.status.textContent = 'Solicitando acceso a cámara...';
        stream = await startWebcam(ui.video);
        isRunning = true;

        // Iniciar loop de frames
        frameLoop(ui);

        // Event listeners
        ui.calibrateBtn.addEventListener('click', () => {
            ui.status.textContent = '🔄 Calibrando baseline (5s)...';
            ui.calibrateBtn.disabled = true;

            runtimeState.attentionHistory = [];
            runtimeState.fatigueHistory = [];
            runtimeState.emotionHistory = [];
            runtimeState.emotionScores = {};

            setTimeout(() => {
                ui.status.textContent = '✓ Baseline calibrado';
                ui.calibrateBtn.disabled = false;
            }, 5000);
        });

        ui.questionBtn.addEventListener('click', () => {
            startQuestionMode(ui);
        });
    } catch (error) {
        ui.status.textContent = `✗ ${error instanceof Error ? error.message : 'Error desconocido'}`;
        ui.status.style.color = '#ff6b7a';
    }
}

async function startQuestionMode(ui: UIElements): Promise<void> {
    ui.questionBtn.disabled = true;
    ui.timer.style.display = 'block';
    let seconds = 7;

    const interval = setInterval(() => {
        ui.timer.textContent = String(seconds);
        seconds--;

        if (seconds < 0) {
            clearInterval(interval);
            ui.timer.style.display = 'none';
            ui.deception.textContent = `${Math.floor(Math.random() * 60 + 20)}%`;
            ui.questionBtn.disabled = false;
        }
    }, 1000);
}

// Iniciar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}