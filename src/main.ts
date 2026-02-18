import { startWebcam } from './webcam/stream';
import { getFrame } from './webcam/capture';
import { detectEmotion } from './analysis/emotion-detector';
import { analyzeFaceFromVideo } from './analysis/face-analyzer';
import { blinkDetector } from './analysis/blink-detector';
import { AnalysisFrame, EmotionResult } from './types/index';
import { BIG_FIVE_QUESTIONS, BigFive, buildBigFiveSummary, computeBigFive } from './analysis/personality-analyzer';
import { SignalProcessor } from './deception/signal-processor';
import { calculateDeceptionProbability } from './deception/probability-calculator';

let stream: MediaStream | null = null;
let isRunning = false;

const DISPLAY_UPDATE_MS = 1200;

type EmotionLabel = 'Neutral' | 'Feliz' | 'Triste' | 'Enojado' | 'Sorprendido' | 'Asustado' | 'Disgustado';
type FaceAnalysis = NonNullable<Awaited<ReturnType<typeof analyzeFaceFromVideo>>>;

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
    smoothedAttention: number;
    smoothedFatigue: number;
    earHistory: number[];
    blinkRateHistory: number[];
    yawnCount: number;
    baselineAgeSamples: number[];
    personalityProfile: BigFive | null;
    signalProcessor: SignalProcessor;
    isCalibrating: boolean;
    calibrationData: {
        attention: number[];
        blinkRate: number[];
        fatigue: number[];
        headMotion: number[];
        emotionVolatility: number[];
    };
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
    smoothedAttention: 75,
    smoothedFatigue: 25,
    earHistory: [],
    blinkRateHistory: [],
    yawnCount: 0,
    baselineAgeSamples: [],
    personalityProfile: null,
    signalProcessor: new SignalProcessor(),
    isCalibrating: false,
    calibrationData: {
        attention: [],
        blinkRate: [],
        fatigue: [],
        headMotion: [],
        emotionVolatility: []
    },
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
    personalityBtn: HTMLButtonElement;
    personalityModal: HTMLElement;
    personalityQuestions: HTMLElement;
    personalitySubmitBtn: HTMLButtonElement;
    personalityCancelBtn: HTMLButtonElement;
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
        questionBtn: document.getElementById('question-btn') as HTMLButtonElement,
        personalityBtn: document.getElementById('personality-test-btn') as HTMLButtonElement,
        personalityModal: document.getElementById('personality-modal') as HTMLElement,
        personalityQuestions: document.getElementById('personality-questions') as HTMLElement,
        personalitySubmitBtn: document.getElementById('personality-submit-btn') as HTMLButtonElement,
        personalityCancelBtn: document.getElementById('personality-cancel-btn') as HTMLButtonElement
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

function applyEMA(newValue: number, previousValue: number, alpha: number = 0.2): number {
    return alpha * newValue + (1 - alpha) * previousValue;
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

function normalizeEmotionLabel(label: string): EmotionLabel {
    const normalized = label.trim().toLowerCase();

    if (normalized === 'feliz' || normalized === 'happy') return 'Feliz';
    if (normalized === 'triste' || normalized === 'sad') return 'Triste';
    if (normalized === 'enojado' || normalized === 'angry') return 'Enojado';
    if (normalized === 'sorprendido' || normalized === 'surprised') return 'Sorprendido';
    if (normalized === 'asustado' || normalized === 'fear' || normalized === 'fearful') return 'Asustado';
    if (normalized === 'disgustado' || normalized === 'disgust') return 'Disgustado';
    return 'Neutral';
}

function combineEmotionSignals(faceEmotion: EmotionResult | null, modelEmotion: EmotionResult): { label: EmotionLabel; score: number } {
    if (!faceEmotion) {
        return {
            label: normalizeEmotionLabel(modelEmotion.label),
            score: clamp(modelEmotion.score, 0.35, 0.95)
        };
    }

    const face = {
        label: normalizeEmotionLabel(faceEmotion.label),
        score: clamp(faceEmotion.score, 0.35, 0.95)
    };

    const local = {
        label: normalizeEmotionLabel(modelEmotion.label),
        score: clamp(modelEmotion.score, 0.35, 0.95)
    };

    let faceWeight = 0.58;
    let localWeight = 0.42;

    if (local.score > face.score + 0.12) {
        faceWeight = 0.45;
        localWeight = 0.55;
    }

    if (face.label === local.label) {
        return {
            label: face.label,
            score: clamp(face.score * faceWeight + local.score * localWeight + 0.03, 0.4, 0.95)
        };
    }

    const faceStrength = face.score * faceWeight;
    const localStrength = local.score * localWeight;

    if (Math.abs(faceStrength - localStrength) < 0.08) {
        if (face.label === 'Neutral' && local.label !== 'Neutral') {
            return { label: local.label, score: clamp(local.score, 0.4, 0.95) };
        }
        return { label: face.label, score: clamp(face.score, 0.4, 0.95) };
    }

    return faceStrength > localStrength
        ? { label: face.label, score: clamp(face.score, 0.4, 0.95) }
        : { label: local.label, score: clamp(local.score, 0.4, 0.95) };
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
    const decayFactor = 0.86;

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

    const normalizedScore = total > 0 ? clamp(bestScore / total + 0.25, 0.35, 0.92) : 0.65;
    return { label: bestLabel, score: normalizedScore };
}

function estimateAge(faceAnalysis: FaceAnalysis | null): { age: number; confidence: number } {
    if (!faceAnalysis) {
        return { age: runtimeState.stableAge, confidence: 0.7 };
    }

    const blend = faceAnalysis.blendshapes || [];
    const getBlend = (name: string): number => blend.find((item) => item.categoryName === name)?.score || 0;

    const brow = (getBlend('browInnerUp') + getBlend('browOuterUpLeft') + getBlend('browOuterUpRight')) / 3;
    const smile = (getBlend('mouthSmileLeft') + getBlend('mouthSmileRight')) / 2;
    const frown = (getBlend('mouthFrownLeft') + getBlend('mouthFrownRight')) / 2;
    const eyeSquint = (getBlend('eyeSquintLeft') + getBlend('eyeSquintRight')) / 2;

    const normalizedEar = clamp((faceAnalysis.eyeAspectRatio - 0.2) / 0.16, 0, 1);

    const ageOffset =
        (1 - normalizedEar) * 6 +
        eyeSquint * 5 +
        frown * 3 -
        smile * 4 -
        brow * 3;

    const instantaneousAge = clamp(Math.round(22 + ageOffset), 18, 40);

    pushLimited(runtimeState.baselineAgeSamples, instantaneousAge, 45);

    const sorted = [...runtimeState.baselineAgeSamples].sort((a, b) => a - b);
    const median = sorted.length
        ? sorted[Math.floor(sorted.length / 2)]
        : instantaneousAge;

    runtimeState.stableAge = Math.round(applyEMA(median, runtimeState.stableAge, 0.12));

    const volatility = sorted.length > 4
        ? sorted[sorted.length - 1] - sorted[0]
        : 0;

    const confidence = clamp(0.9 - volatility / 60, 0.62, 0.92);

    return { age: runtimeState.stableAge, confidence };
}

function estimateAttention(
    faceAnalysis: FaceAnalysis | null,
    emotion: { label: EmotionLabel; score: number }
): number {
    if (!faceAnalysis) {
        // Fallback if no face detected
        const emotionPenalty = (emotion.label === 'Asustado' || emotion.label === 'Enojado')
            ? clamp(emotion.score * 10, 0, 10)
            : emotion.label === 'Triste'
                ? clamp(emotion.score * 7, 0, 7)
                : 0;
        return clamp(75 - emotionPenalty, 20, 99);
    }

    // Extract eye gaze from individual eye look metrics
    const gazeAway = Math.max(
        faceAnalysis.eyeMetrics.eyeLookOut,
        faceAnalysis.eyeMetrics.eyeLookUp,
        faceAnalysis.eyeMetrics.eyeLookDown
    );
    
    // Extract head pose: yaw and pitch from transformation
    const headYaw = Math.abs(faceAnalysis.headPose.yaw || 0) / 45; // Normalize to 0-1 (45° max)
    const headPitch = Math.abs(faceAnalysis.headPose.pitch || 0) / 45;
    const headAway = Math.max(Math.min(headYaw, 1), Math.min(headPitch, 1));
    
    // Apply attention formula: 100 * (1 - clamp(0.6*gaze_away + 0.4*head_away, 0, 1))
    const attentionRaw = 100 * (1 - clamp(0.6 * gazeAway + 0.4 * headAway, 0, 1));
    
    // Apply EMA smoothing
    runtimeState.smoothedAttention = applyEMA(attentionRaw, runtimeState.smoothedAttention, 0.15);
    
    return clamp(Math.round(runtimeState.smoothedAttention), 20, 99);
}

function estimateFatigue(
    faceAnalysis: FaceAnalysis | null,
    blinkInfo: { blinks: number; isBlinking: boolean; isYawning: boolean } | null,
    emotion: { label: EmotionLabel; score: number }
): { score: number; level: string; blinkRate: number; eyeAspectRatio: number } {
    if (!faceAnalysis) {
        return {
            score: 35,
            level: 'Baja',
            blinkRate: 14,
            eyeAspectRatio: 0.34
        };
    }

    const ear = faceAnalysis.eyeAspectRatio;
    const mar = faceAnalysis.mouthAspectRatio;
    const blinkRate = blinkInfo?.blinks || 0;
    const isYawning = blinkInfo?.isYawning || false;

    pushLimited(runtimeState.earHistory, ear, 60);
    if (blinkRate > 0) {
        pushLimited(runtimeState.blinkRateHistory, blinkRate, 60);
    }

    const earMin = Math.min(...runtimeState.earHistory);
    const normalizedBlinkRate = clamp(blinkRate / 28, 0, 1);
    const lowBlinkPenalty = blinkRate > 0 && blinkRate < 8 ? (8 - blinkRate) / 8 : 0;
    const prolongedClosure = clamp((0.2 - ear) / 0.07, 0, 1);
    const microSleepRisk = clamp((0.17 - earMin) / 0.05, 0, 1);
    const yawnBonus = isYawning ? 1 : 0;

    if (isYawning) {
        runtimeState.yawnCount++;
    }

    const earClosedPercent = runtimeState.earHistory.filter((e) => e < 0.2).length / Math.max(runtimeState.earHistory.length, 1);

    const fatigueScore = clamp(
        earClosedPercent * 35 +
        prolongedClosure * 22 +
        normalizedBlinkRate * 18 +
        lowBlinkPenalty * 12 +
        microSleepRisk * 8 +
        yawnBonus * 12 +
        (emotion.label === 'Triste' ? emotion.score * 8 : 0),
        0,
        100
    );

    // Apply EMA smoothing to fatigue score
    runtimeState.smoothedFatigue = applyEMA(fatigueScore, runtimeState.smoothedFatigue, 0.18);

    const level =
        runtimeState.smoothedFatigue >= 67 ? 'Alta' : runtimeState.smoothedFatigue >= 34 ? 'Media' : 'Baja';

    return {
        score: Math.round(runtimeState.smoothedFatigue),
        level,
        blinkRate: Math.round(blinkRate),
        eyeAspectRatio: Number(ear.toFixed(2))
    };
}

function buildPersonalitySummary(): string {
    if (!runtimeState.personalityProfile) {
        return 'Completa el test de personalidad';
    }

    return buildBigFiveSummary(runtimeState.personalityProfile);
}

function renderPersonalityQuestions(container: HTMLElement): void {
    const options = [
        { value: 1, text: '1 - Totalmente en desacuerdo' },
        { value: 2, text: '2 - En desacuerdo' },
        { value: 3, text: '3 - Neutral' },
        { value: 4, text: '4 - De acuerdo' },
        { value: 5, text: '5 - Totalmente de acuerdo' }
    ];

    container.innerHTML = BIG_FIVE_QUESTIONS.map((question) => {
        const choices = options
            .map((option) => `<option value="${option.value}" ${option.value === 3 ? 'selected' : ''}>${option.text}</option>`)
            .join('');

        return `
            <div class="question-item">
                <label for="bf-q-${question.id}">${question.id}. ${question.text}</label>
                <select id="bf-q-${question.id}" class="likert-select" data-question-id="${question.id}">${choices}</select>
            </div>
        `;
    }).join('');
}

function readPersonalityAnswers(container: HTMLElement): number[] {
    const answers: number[] = [];

    BIG_FIVE_QUESTIONS.forEach((question) => {
        const select = container.querySelector(`#bf-q-${question.id}`) as HTMLSelectElement | null;
        answers.push(Number(select?.value || 3));
    });

    return answers;
}

function calculateDeceptionEstimate(): number {
    // Get current metrics
    const attentionAvg = average(runtimeState.attentionHistory) || 75;
    const blinkRate = runtimeState.currentAnalysis.fatigue.blinkRate;
    const fatigueAvg = average(runtimeState.fatigueHistory) || 25;
    const headPose = runtimeState.currentAnalysis.headPose;
    const headMotion = Math.sqrt(
        Math.pow(headPose.yaw, 2) + Math.pow(headPose.pitch, 2) + Math.pow(headPose.roll, 2)
    );

    // Calculate emotion volatility: std of recent emotion scores
    const recentEmotions = runtimeState.emotionHistory.slice(-20);
    let emotionVolatility = 0;
    if (recentEmotions.length > 0) {
        let transitions = 0;
        for (let i = 1; i < recentEmotions.length; i++) {
            if (recentEmotions[i] !== recentEmotions[i - 1]) {
                transitions++;
            }
        }
        emotionVolatility = recentEmotions.length > 1 ? transitions / (recentEmotions.length - 1) : 0;
    }

    // Update signals in processor
    runtimeState.signalProcessor.updateSignals(
        attentionAvg,
        blinkRate,
        fatigueAvg,
        headMotion,
        emotionVolatility
    );

    // Calculate z-scores
    const zScores = runtimeState.signalProcessor.calculateZScores();

    // Calculate deception probability (0-100)
    const deceptionProbability = calculateDeceptionProbability(zScores);

    return Math.round(deceptionProbability);
}

async function analyzeFrame(frame: ImageData, video: HTMLVideoElement): Promise<AnalysisFrame> {
    if (!runtimeState.initialized) {
        runtimeState.stableAge = 24;
        runtimeState.currentAnalysis.age.age = runtimeState.stableAge;
        runtimeState.initialized = true;
    }

    const faceAnalysis = await analyzeFaceFromVideo(video);
    const ageEstimate = estimateAge(faceAnalysis);
    const modelEmotion = await detectEmotion(frame);
    const fusedEmotion = combineEmotionSignals(faceAnalysis?.emotion ?? null, modelEmotion);
    const stableEmotion = updateStableEmotion(fusedEmotion.label, fusedEmotion.score);

    // Update blink detector with EAR and MAR values if face detected
    let blinkInfo = { blinks: 0, isBlinking: false, isYawning: false };
    if (faceAnalysis) {
        blinkInfo = blinkDetector.update(faceAnalysis.eyeAspectRatio, faceAnalysis.mouthAspectRatio);
    }

    // Calculate attention using gaze and head pose
    const attentionLevel = estimateAttention(faceAnalysis, stableEmotion);

    // Calculate fatigue with new signature
    const fatigue = estimateFatigue(faceAnalysis, blinkInfo, stableEmotion);

    pushLimited(runtimeState.attentionHistory, attentionLevel);
    pushLimited(runtimeState.fatigueHistory, fatigue.score);
    pushEmotionLimited(runtimeState.emotionHistory, stableEmotion.label);

    runtimeState.currentAnalysis = {
        emotion: stableEmotion,
        age: ageEstimate,
        attention: {
            level: Math.round(average(runtimeState.attentionHistory) || attentionLevel),
            gazingAway: attentionLevel < 55
        },
        fatigue: {
            level: fatigue.level,
            blinkRate: fatigue.blinkRate,
            eyeAspectRatio: fatigue.eyeAspectRatio
        },
        headPose: faceAnalysis?.headPose ?? { yaw: 0, pitch: 0, roll: 0 }
    };

    // Collect calibration data if calibrating
    if (runtimeState.isCalibrating) {
        runtimeState.calibrationData.attention.push(attentionLevel);
        runtimeState.calibrationData.blinkRate.push(fatigue.blinkRate);
        runtimeState.calibrationData.fatigue.push(fatigue.score);

        // Head motion: magnitude of head pose vectors
        const headPose = runtimeState.currentAnalysis.headPose;
        const headMotion = Math.sqrt(
            Math.pow(headPose.yaw, 2) + Math.pow(headPose.pitch, 2) + Math.pow(headPose.roll, 2)
        );
        runtimeState.calibrationData.headMotion.push(headMotion);

        // Emotion volatility: use emotion score standard deviation
        runtimeState.calibrationData.emotionVolatility.push(stableEmotion.score);
    }

    return runtimeState.currentAnalysis;
}

async function frameLoop(ui: UIElements): Promise<void> {
    if (!isRunning) return;

    try {
        const frame = getFrame(ui.video, ui.overlay);

        await analyzeFrame(frame, ui.video);

        const now = Date.now();
        if (now - runtimeState.lastDisplayUpdate >= DISPLAY_UPDATE_MS) {
            updateStats(ui, runtimeState.currentAnalysis);
            runtimeState.lastDisplayUpdate = now;
        }

        ui.status.textContent = '✓ Cámara activa';
        ui.status.style.color = '#00ff88';

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

        frameLoop(ui);

        ui.calibrateBtn.addEventListener('click', () => {
            ui.status.textContent = '🔄 Calibrando baseline (5s)...';
            ui.calibrateBtn.disabled = true;

            runtimeState.attentionHistory = [];
            runtimeState.fatigueHistory = [];
            runtimeState.emotionHistory = [];
            runtimeState.emotionScores = {};
            runtimeState.baselineAgeSamples = [];
            runtimeState.isCalibrating = true;
            runtimeState.calibrationData = {
                attention: [],
                blinkRate: [],
                fatigue: [],
                headMotion: [],
                emotionVolatility: []
            };

            setTimeout(() => {
                runtimeState.isCalibrating = false;
                
                // Calculate baseline metrics (mean and std)
                const calculateStats = (data: number[]) => {
                    if (data.length === 0) return { mean: 0, std: 0.1 };
                    const mean = data.reduce((a, b) => a + b, 0) / data.length;
                    const variance = data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / data.length;
                    const std = Math.sqrt(variance) || 0.1;
                    return { mean, std };
                };

                const baseline = {
                    attentionMean: calculateStats(runtimeState.calibrationData.attention).mean,
                    attentionStd: calculateStats(runtimeState.calibrationData.attention).std,
                    blinkRateMean: calculateStats(runtimeState.calibrationData.blinkRate).mean,
                    blinkRateStd: calculateStats(runtimeState.calibrationData.blinkRate).std,
                    fatigueMean: calculateStats(runtimeState.calibrationData.fatigue).mean,
                    fatigueStd: calculateStats(runtimeState.calibrationData.fatigue).std,
                    headMotionMean: calculateStats(runtimeState.calibrationData.headMotion).mean,
                    headMotionStd: calculateStats(runtimeState.calibrationData.headMotion).std,
                    emotionVolatilityMean: calculateStats(runtimeState.calibrationData.emotionVolatility).mean
                };

                runtimeState.signalProcessor.setBaseline(baseline);
                ui.status.textContent = '✓ Baseline calibrado';
                ui.calibrateBtn.disabled = false;
            }, 5000);
        });

        renderPersonalityQuestions(ui.personalityQuestions);

        ui.questionBtn.addEventListener('click', () => {
            startQuestionMode(ui);
        });

        ui.personalityBtn.addEventListener('click', () => {
            ui.personalityModal.classList.add('open');
        });

        ui.personalityCancelBtn.addEventListener('click', () => {
            ui.personalityModal.classList.remove('open');
        });

        ui.personalitySubmitBtn.addEventListener('click', () => {
            const answers = readPersonalityAnswers(ui.personalityQuestions);
            runtimeState.personalityProfile = computeBigFive(answers);
            ui.personality.textContent = buildPersonalitySummary();
            ui.personalityModal.classList.remove('open');
            ui.status.textContent = '✓ Test de personalidad actualizado';
            ui.status.style.color = '#00ff88';
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
            ui.deception.textContent = `${calculateDeceptionEstimate()}%`;
            ui.questionBtn.disabled = false;
        }
    }, 1000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}