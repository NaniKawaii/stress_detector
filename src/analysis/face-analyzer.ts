import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import { EmotionResult, AttentionResult } from '../types/index';

type EmotionLabel = 'Neutral' | 'Feliz' | 'Triste' | 'Enojado' | 'Sorprendido' | 'Asustado' | 'Disgustado';

interface FaceAnalysisResult {
    emotion: EmotionResult;
    attention: AttentionResult;
    headPose: { yaw: number; pitch: number; roll: number };
    eyeMetrics: { 
        blink: number;
        eyeLook: number;
        jawOpen: number;
        eyeLookOut: number;
        eyeLookUp: number;
        eyeLookDown: number;
    };
    eyeAspectRatio: number;
    mouthAspectRatio: number;
    faceLandmarks: Array<[number, number, number]> | null;
    blendshapes: Array<{ categoryName: string; score: number }> | null;
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

function matrixToPose(matrixData: number[] | undefined): { yaw: number; pitch: number; roll: number } {
    if (!matrixData || matrixData.length < 16) {
        return { yaw: 0, pitch: 0, roll: 0 };
    }

    const r20 = matrixData[8];
    const r21 = matrixData[9];
    const r22 = matrixData[10];
    const r01 = matrixData[1];
    const r11 = matrixData[5];

    const yaw = Math.atan2(r20, r22) * (180 / Math.PI);
    const pitch = Math.asin(clamp(-r21, -1, 1)) * (180 / Math.PI);
    const roll = Math.atan2(r01, r11) * (180 / Math.PI);

    return {
        yaw: clamp(yaw, -45, 45),
        pitch: clamp(pitch, -35, 35),
        roll: clamp(roll, -35, 35)
    };
}

function extractEyeMetrics(blend: Record<string, number>): { 
    blink: number;
    eyeLook: number;
    jawOpen: number;
    eyeLookOut: number;
    eyeLookUp: number;
    eyeLookDown: number;
} {
    const eyeLookInLeft = blend.eyeLookInLeft || 0;
    const eyeLookOutLeft = blend.eyeLookOutLeft || 0;
    const eyeLookInRight = blend.eyeLookInRight || 0;
    const eyeLookOutRight = blend.eyeLookOutRight || 0;
    const eyeLookUpLeft = blend.eyeLookUpLeft || 0;
    const eyeLookUpRight = blend.eyeLookUpRight || 0;
    const eyeLookDownLeft = blend.eyeLookDownLeft || 0;
    const eyeLookDownRight = blend.eyeLookDownRight || 0;
    
    const eyeLookOut = Math.max(eyeLookOutLeft, eyeLookOutRight);
    const eyeLookUp = Math.max(eyeLookUpLeft, eyeLookUpRight);
    const eyeLookDown = Math.max(eyeLookDownLeft, eyeLookDownRight);
    
    const eyeLook =
        eyeLookInLeft +
        eyeLookOutLeft +
        eyeLookInRight +
        eyeLookOutRight +
        eyeLookUpLeft +
        eyeLookUpRight +
        eyeLookDownLeft +
        eyeLookDownRight;

    const blink = (blend.eyeBlinkLeft || 0) + (blend.eyeBlinkRight || 0);
    const jawOpen = blend.jawOpen || 0;

    return {
        blink,
        eyeLook,
        jawOpen,
        eyeLookOut,
        eyeLookUp,
        eyeLookDown
    };
}

function euclideanDistance(p1: [number, number], p2: [number, number]): number {
    const dx = p1[0] - p2[0];
    const dy = p1[1] - p2[1];
    return Math.sqrt(dx * dx + dy * dy);
}

function calculateEAR(landmarks: Array<[number, number, number]>): number {
    const EYE_LEFT_TOP = 159;
    const EYE_LEFT_BOTTOM = 145;
    const EYE_LEFT_INNER = 133;
    const EYE_LEFT_OUTER = 33;
    const EYE_LEFT_UP1 = 158;
    const EYE_LEFT_DOWN1 = 163;

    const EYE_RIGHT_TOP = 386;
    const EYE_RIGHT_BOTTOM = 374;
    const EYE_RIGHT_INNER = 362;
    const EYE_RIGHT_OUTER = 263;
    const EYE_RIGHT_UP1 = 385;
    const EYE_RIGHT_DOWN1 = 390;

    if (!landmarks[EYE_LEFT_TOP] || !landmarks[EYE_RIGHT_TOP]) {
        return 0.3;
    }

    const leftDistance1 = euclideanDistance(
        [landmarks[EYE_LEFT_UP1][0], landmarks[EYE_LEFT_UP1][1]],
        [landmarks[EYE_LEFT_DOWN1][0], landmarks[EYE_LEFT_DOWN1][1]]
    );

    const leftDistance2 = euclideanDistance(
        [landmarks[EYE_LEFT_INNER][0], landmarks[EYE_LEFT_INNER][1]],
        [landmarks[EYE_LEFT_OUTER][0], landmarks[EYE_LEFT_OUTER][1]]
    );

    const leftEAR = (leftDistance1 + leftDistance1) / (2 * leftDistance2 + 0.001);

    const rightDistance1 = euclideanDistance(
        [landmarks[EYE_RIGHT_UP1][0], landmarks[EYE_RIGHT_UP1][1]],
        [landmarks[EYE_RIGHT_DOWN1][0], landmarks[EYE_RIGHT_DOWN1][1]]
    );

    const rightDistance2 = euclideanDistance(
        [landmarks[EYE_RIGHT_INNER][0], landmarks[EYE_RIGHT_INNER][1]],
        [landmarks[EYE_RIGHT_OUTER][0], landmarks[EYE_RIGHT_OUTER][1]]
    );

    const rightEAR = (rightDistance1 + rightDistance1) / (2 * rightDistance2 + 0.001);

    return (leftEAR + rightEAR) / 2;
}

function calculateMAR(landmarks: Array<[number, number, number]>): number {
    const MOUTH_TOP = 13;
    const MOUTH_BOTTOM = 14;
    const MOUTH_LEFT = 78;
    const MOUTH_RIGHT = 308;

    if (!landmarks[MOUTH_TOP] || !landmarks[MOUTH_BOTTOM]) {
        return 0;
    }

    const verticalDistance = euclideanDistance(
        [landmarks[MOUTH_TOP][0], landmarks[MOUTH_TOP][1]],
        [landmarks[MOUTH_BOTTOM][0], landmarks[MOUTH_BOTTOM][1]]
    );

    const horizontalDistance = euclideanDistance(
        [landmarks[MOUTH_LEFT][0], landmarks[MOUTH_LEFT][1]],
        [landmarks[MOUTH_RIGHT][0], landmarks[MOUTH_RIGHT][1]]
    );

    return verticalDistance / (horizontalDistance + 0.001);
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

function inferAttention(eyeLook: number, blink: number, yaw: number, pitch: number): AttentionResult {

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
    const eyeMetrics = extractEyeMetrics(blend);

    const landmarks = detections.faceLandmarks?.[0]?.map((lm) => [lm.x, lm.y, lm.z] as [number, number, number]) || null;
    const eyeAspectRatio = landmarks ? calculateEAR(landmarks) : 0.3;
    const mouthAspectRatio = landmarks ? calculateMAR(landmarks) : 0;

    const result: FaceAnalysisResult = {
        emotion: inferEmotion(blend),
        attention: inferAttention(eyeMetrics.eyeLook, eyeMetrics.blink, pose.yaw, pose.pitch),
        headPose: pose,
        eyeMetrics,
        eyeAspectRatio,
        mouthAspectRatio,
        faceLandmarks: landmarks,
        blendshapes: detections.faceBlendshapes?.[0]?.categories as Array<{ categoryName: string; score: number }> || null
    };

    cached = { timestamp: now, result };
    return result;
}
