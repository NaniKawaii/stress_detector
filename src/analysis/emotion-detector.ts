import { EmotionResult } from '../types/index';
import * as tf from '@tensorflow/tfjs';

type EmotionLabel = 'Neutral' | 'Feliz' | 'Triste' | 'Enojado' | 'Sorprendido' | 'Asustado' | 'Disgustado';

interface RegionStats {
    meanLuminance: number;
    variance: number;
    brightNeutralRatio: number;
    darkRatio: number;
    edgeEnergy: number;
}

const EMOTION_LABELS: EmotionLabel[] = ['Enojado', 'Disgustado', 'Asustado', 'Feliz', 'Triste', 'Sorprendido', 'Neutral'];
const MODEL_PATH = '/models/emotion/model.json';

let emotionModel: tf.LayersModel | null = null;
let modelLoadPromise: Promise<void> | null = null;
let modelLoadFailed = false;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function softmax(values: number[]): number[] {
    if (!values.length) return [];

    const max = Math.max(...values);
    const exps = values.map((value) => Math.exp(value - max));
    const sum = exps.reduce((acc, value) => acc + value, 0) || 1;
    return exps.map((value) => value / sum);
}


function normalizeProbabilities(values: number[]): number[] {
    if (!values.length) return [];

    const clean = values.map((value) => Number.isFinite(value) ? Math.max(0, value) : 0);
    const sum = clean.reduce((acc, value) => acc + value, 0);

    if (sum <= 0) {
        return softmax(values);
    }

    return clean.map((value) => value / sum);
}

async function ensureModelLoaded(): Promise<void> {
    if (emotionModel || modelLoadFailed) {
        return;
    }

    if (!modelLoadPromise) {
        modelLoadPromise = (async () => {
            try {
                emotionModel = await tf.loadLayersModel(MODEL_PATH);
                console.log('[EmotionDetector] Model loaded from', MODEL_PATH);
            } catch (error) {
                modelLoadFailed = true;
                console.error('[EmotionDetector] Failed to load from', MODEL_PATH, error);
            }
        })();
    }

    await modelLoadPromise;
}

function inferInputShape(model: tf.LayersModel): { height: number; width: number; channels: number } {
    const shape = model.inputs[0]?.shape;

    const height = shape?.[1] && shape[1] > 0 ? shape[1] : 48;
    const width = shape?.[2] && shape[2] > 0 ? shape[2] : 48;
    const channels = shape?.[3] && shape[3] > 0 ? shape[3] : 1;

    return {
        height,
        width,
        channels
    };
}

async function detectFromModel(frame: ImageData): Promise<EmotionResult | null> {
    await ensureModelLoaded();
    if (!emotionModel) {
        console.warn('[EmotionDetector] Model not loaded, will use heuristic');
        return null;
    }

    const { height, width, channels } = inferInputShape(emotionModel);

    const inputTensor = tf.tidy(() => {
        const pixels = tf.browser.fromPixels(frame, channels === 1 ? 1 : 3).toFloat();
        const resized = tf.image.resizeBilinear(pixels, [height, width], true);
        const normalized = resized.div(255);
        return normalized.expandDims(0);
    });

    const prediction = emotionModel.predict(inputTensor);
    const outputTensor = Array.isArray(prediction) ? prediction[0] : prediction;
    const data = Array.from(await outputTensor.data());

    inputTensor.dispose();
    if (Array.isArray(prediction)) {
        prediction.forEach((tensor) => tensor.dispose());
    } else {
        prediction.dispose();
    }

    const probabilities = data.every((value) => value >= 0 && value <= 1)
        ? normalizeProbabilities(data)
        : softmax(data);

    if (!probabilities.length) {
        return null;
    }

    let bestIndex = 0;
    let bestValue = probabilities[0];

    for (let index = 1; index < probabilities.length; index++) {
        if (probabilities[index] > bestValue) {
            bestValue = probabilities[index];
            bestIndex = index;
        }
    }

    const sorted = [...probabilities].sort((a, b) => b - a);
    const margin = (sorted[0] || 0) - (sorted[1] || 0);

    if (bestValue < 0.4 || margin < 0.08) {
        console.debug('[EmotionDetector] Model confidence too low', { bestValue, margin, label: EMOTION_LABELS[bestIndex] });
        return null;
    }

    const result = {
        label: EMOTION_LABELS[bestIndex] ?? 'Neutral',
        score: clamp(bestValue, 0.35, 0.95)
    };
    console.debug('[EmotionDetector] Model result:', result);
    return result;
}

function getLuminance(r: number, g: number, b: number): number {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

function getSaturation(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === 0) return 0;
    return ((max - min) / max) * 255;
}

function analyzeRegion(
    frame: ImageData,
    x0: number,
    y0: number,
    x1: number,
    y1: number
): RegionStats {
    const width = frame.width;
    const data = frame.data;

    let count = 0;
    let luminanceSum = 0;
    let luminanceSqSum = 0;
    let brightNeutral = 0;
    let darkCount = 0;
    let edgeSum = 0;

    const left = clamp(Math.floor(width * x0), 0, width - 1);
    const right = clamp(Math.floor(width * x1), 0, width - 1);
    const top = clamp(Math.floor(frame.height * y0), 0, frame.height - 1);
    const bottom = clamp(Math.floor(frame.height * y1), 0, frame.height - 1);

    for (let y = top; y < bottom; y += 2) {
        for (let x = left; x < right; x += 2) {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            const lum = getLuminance(r, g, b);
            const sat = getSaturation(r, g, b);

            count++;
            luminanceSum += lum;
            luminanceSqSum += lum * lum;

            if (lum > 165 && sat < 60) {
                brightNeutral++;
            }

            if (lum < 65) {
                darkCount++;
            }

            if (x + 2 < right) {
                const idx2 = (y * width + (x + 2)) * 4;
                const lum2 = getLuminance(data[idx2], data[idx2 + 1], data[idx2 + 2]);
                edgeSum += Math.abs(lum - lum2);
            }
        }
    }

    if (count === 0) {
        return {
            meanLuminance: 0,
            variance: 0,
            brightNeutralRatio: 0,
            darkRatio: 0,
            edgeEnergy: 0
        };
    }

    const mean = luminanceSum / count;
    const variance = Math.max(0, luminanceSqSum / count - mean * mean);

    return {
        meanLuminance: mean,
        variance,
        brightNeutralRatio: brightNeutral / count,
        darkRatio: darkCount / count,
        edgeEnergy: edgeSum / count
    };
}

function inferEmotionLabel(faceStats: RegionStats, mouthStats: RegionStats): EmotionLabel {
    const smileScore =
        mouthStats.brightNeutralRatio * 2.7 +
        mouthStats.edgeEnergy / 45 +
        mouthStats.variance / 1100 -
        mouthStats.darkRatio * 0.7;

    if (smileScore >= 0.55) {
        return 'Feliz';
    }

    if (mouthStats.darkRatio > 0.58 && mouthStats.meanLuminance < faceStats.meanLuminance * 0.75) {
        return 'Triste';
    }

    if (faceStats.variance > 1850 && mouthStats.edgeEnergy > 24) {
        return 'Sorprendido';
    }

    return 'Neutral';
}

function inferEmotionFromBlendshapes(blendshapes: Array<{ categoryName: string; score: number }>): EmotionLabel {
    const blend: Record<string, number> = {};
    blendshapes.forEach((b) => {
        blend[b.categoryName] = b.score;
    });

    // Feliz: comisuras de boca hacia arriba, ojos entrecerrados (smile)
    const mouthSmile = Math.max(blend['mouthSmileLeft'] ?? 0, blend['mouthSmileRight'] ?? 0);
    const cheekSquint = Math.max(blend['eyeSquintLeft'] ?? 0, blend['eyeSquintRight'] ?? 0);
    const happyScore = mouthSmile * 0.6 + cheekSquint * 0.3;

    // Triste: comisuras hacia abajo, cejas bajas
    const mouthFrown = Math.max(blend['mouthFrownLeft'] ?? 0, blend['mouthFrownRight'] ?? 0);
    const browDown = Math.max(blend['browDownLeft'] ?? 0, blend['browDownRight'] ?? 0);
    const sadScore = mouthFrown * 0.6 + browDown * 0.3;

    // Sorprendido: boca abierta, cejas arriba
    const jawOpen = blend['jawOpen'] ?? 0;
    const browUp = Math.max(blend['browInnerUp'] ?? 0, blend['browOuterUpLeft'] ?? 0, blend['browOuterUpRight'] ?? 0);
    const surprisedScore = jawOpen * 0.6 + browUp * 0.3;

    // Asustado: ojos muy abiertos, boca abierta
    const eyeWide = Math.max(blend['eyeWideLeft'] ?? 0, blend['eyeWideRight'] ?? 0);
    const fearScore = eyeWide * 0.5 + jawOpen * 0.4;

    // Enojado: cejas fruncidas
    const browInnerUp = blend['browInnerUp'] ?? 0;
    const angryScore = (1 - browInnerUp) * 0.7;  // Cejas bajas/fruncidas

    const scores: Record<EmotionLabel, number> = {
        'Feliz': happyScore,
        'Triste': sadScore,
        'Sorprendido': surprisedScore,
        'Asustado': fearScore,
        'Enojado': angryScore,
        'Disgustado': 0,
        'Neutral': 0
    };

    let best: EmotionLabel = 'Neutral';
    let bestScore = 0.2;  // Umbral mínimo para no ser Neutral

    Object.entries(scores).forEach(([emotion, score]) => {
        if (score > bestScore) {
            bestScore = score;
            best = emotion as EmotionLabel;
        }
    });

    console.debug('[EmotionDetector] Blendshape inference:', { best, scores });
    return best;
}


function buildScore(label: EmotionLabel, faceStats: RegionStats, mouthStats: RegionStats): number {
    const base = label === 'Feliz'
        ? 0.6 + mouthStats.brightNeutralRatio * 1.6 + mouthStats.edgeEnergy / 85
        : label === 'Triste'
            ? 0.55 + mouthStats.darkRatio * 0.5
            : 0.58 + faceStats.variance / 7000;

    return clamp(base, 0.55, 0.96);
}

export async function detectEmotion(
    frame: ImageData,
    blendshapes?: Array<{ categoryName: string; score: number }> | null
): Promise<EmotionResult> {
    const modelEmotion = await detectFromModel(frame);
    if (modelEmotion) {
        console.log('[EmotionDetector] Using MODEL:', modelEmotion);
        return modelEmotion;
    }

    // Fallback: use blendshapes (geometry) if available
    if (blendshapes && blendshapes.length > 0) {
        console.log('[EmotionDetector] Using BLENDSHAPES (geometry-based)');
        const label = inferEmotionFromBlendshapes(blendshapes);
        return {
            label,
            score: 0.65  // Conservative confidence for blendshape fallback
        };
    }

    // Last resort: brightness-based heuristic (only if no other option)
    console.log('[EmotionDetector] Using HEURISTIC (brightness-based - fallback)');
    const faceStats = analyzeRegion(frame, 0.2, 0.18, 0.8, 0.86);
    const mouthStats = analyzeRegion(frame, 0.33, 0.56, 0.67, 0.82);

    const label = inferEmotionLabel(faceStats, mouthStats);
    const score = buildScore(label, faceStats, mouthStats);

    return {
        label,
        score
    };
}