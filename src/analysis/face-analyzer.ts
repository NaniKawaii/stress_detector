import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { EmotionResult, AttentionResult } from '../types/index';

type EmotionLabel = 'Neutral' | 'Feliz' | 'Triste' | 'Enojado' | 'Sorprendido' | 'Asustado' | 'Disgustado';

interface FaceAnalysisResult {
    emotion: EmotionResult;
    attention: AttentionResult;
}

interface CachedResult {
    timestamp: number;
    result: FaceAnalysisResult | null;
}

const MODEL_ASSET_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';
const MAX_ANALYSIS_HZ = 8;
const ANALYSIS_INTERVAL_MS = 1000 / MAX_ANALYSIS_HZ;

let faceLandmarker: FaceLandmarker | null = null;
let initializationPromise: Promise<void> | null = null;
let cached: CachedResult = { timestamp: 0, result: null };

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function scoreMap(categories: Array<{ categoryName: string; score: number }> | undefined): Record<string, number> {
    const map: Record<string, number> = {};
    if (!categories) return map;

    categories.forEach((category) => {
        map[category.categoryName] = category.score;
    });

    return map;
}

function matrixToPose(matrixData: number[] | undefined): { yaw: number; pitch: number } {
    if (!matrixData || matrixData.length < 16) {
        return { yaw: 0, pitch: 0 };
    }

    const r20 = matrixData[8];
    const r21 = matrixData[9];
    const r22 = matrixData[10];

    const yaw = Math.atan2(r20, r22) * (180 / Math.PI);
    const pitch = Math.asin(clamp(-r21, -1, 1)) * (180 / Math.PI);

    return {
        yaw: clamp(yaw, -45, 45),
        pitch: clamp(pitch, -35, 35)
    };
}

function inferEmotion(blend: Record<string, number>): EmotionResult {
    const smile = (blend.mouthSmileLeft || 0) + (blend.mouthSmileRight || 0);
    const frown = (blend.mouthFrownLeft || 0) + (blend.mouthFrownRight || 0);
    const browInnerUp = blend.browInnerUp || 0;
    const jawOpen = blend.jawOpen || 0;
    const cheekSquint = (blend.cheekSquintLeft || 0) + (blend.cheekSquintRight || 0);

    const happyScore = smile * 0.95 + cheekSquint * 0.35 - frown * 0.45;
    const sadScore = frown * 0.9 + browInnerUp * 0.5 - smile * 0.35;
    const surpriseScore = jawOpen * 0.9 + browInnerUp * 0.45;

    let label: EmotionLabel = 'Neutral';
    let score = 0.62;

    if (happyScore > sadScore && happyScore > surpriseScore && happyScore > 0.35) {
        label = 'Feliz';
        score = clamp(0.62 + happyScore * 0.32, 0.62, 0.97);
    } else if (sadScore > happyScore && sadScore > surpriseScore && sadScore > 0.35) {
        label = 'Triste';
        score = clamp(0.6 + sadScore * 0.28, 0.6, 0.94);
    } else if (surpriseScore > 0.45) {
        label = 'Sorprendido';
        score = clamp(0.6 + surpriseScore * 0.25, 0.6, 0.94);
    }

    return { label, score };
}

function inferAttention(blend: Record<string, number>, yaw: number, pitch: number): AttentionResult {
    const eyeLook =
        (blend.eyeLookInLeft || 0) +
        (blend.eyeLookOutLeft || 0) +
        (blend.eyeLookInRight || 0) +
        (blend.eyeLookOutRight || 0) +
        (blend.eyeLookUpLeft || 0) +
        (blend.eyeLookUpRight || 0) +
        (blend.eyeLookDownLeft || 0) +
        (blend.eyeLookDownRight || 0);

    const blink = (blend.eyeBlinkLeft || 0) + (blend.eyeBlinkRight || 0);

    const gazePenalty = clamp(eyeLook * 36, 0, 45);
    const headPenalty = clamp(Math.abs(yaw) * 0.8 + Math.abs(pitch) * 0.65, 0, 42);
    const blinkPenalty = clamp(blink * 12, 0, 18);

    const level = clamp(Math.round(100 - gazePenalty - headPenalty - blinkPenalty), 10, 99);

    return {
        level,
        gazingAway: level < 45
    };
}

async function ensureInitialized(): Promise<void> {
    if (faceLandmarker) return;

    if (!initializationPromise) {
        initializationPromise = (async () => {
            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
            );

            faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: MODEL_ASSET_URL,
                    delegate: 'GPU'
                },
                runningMode: 'VIDEO',
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: true,
                numFaces: 1
            });
        })().catch(async () => {
            const vision = await FilesetResolver.forVisionTasks(
                'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm'
            );

            faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: MODEL_ASSET_URL,
                    delegate: 'CPU'
                },
                runningMode: 'VIDEO',
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: true,
                numFaces: 1
            });
        });
    }

    await initializationPromise;
}

export async function analyzeFaceFromVideo(video: HTMLVideoElement): Promise<FaceAnalysisResult | null> {
    if (!video.videoWidth || !video.videoHeight) {
        return null;
    }

    const now = performance.now();
    if (now - cached.timestamp < ANALYSIS_INTERVAL_MS) {
        return cached.result;
    }

    await ensureInitialized();
    if (!faceLandmarker) {
        cached = { timestamp: now, result: null };
        return null;
    }

    const detections = faceLandmarker.detectForVideo(video, now);
    if (!detections.faceBlendshapes?.length) {
        cached = { timestamp: now, result: null };
        return null;
    }

    const blend = scoreMap(detections.faceBlendshapes[0]?.categories as Array<{ categoryName: string; score: number }>);
    const matrix = detections.facialTransformationMatrixes?.[0]?.data as number[] | undefined;
    const pose = matrixToPose(matrix);

    const result: FaceAnalysisResult = {
        emotion: inferEmotion(blend),
        attention: inferAttention(blend, pose.yaw, pose.pitch)
    };

    cached = { timestamp: now, result };
    return result;
}
