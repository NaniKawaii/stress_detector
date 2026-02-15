import { EmotionResult } from '../types/index';

const EMOTIONS = ['Neutral', 'Feliz', 'Triste', 'Enojado', 'Sorprendido', 'Asustado', 'Disgustado'];

export async function detectEmotion(frame: ImageData): Promise<EmotionResult> {
    // TODO: Integrar modelo TensorFlow.js de emoción real
    // Por ahora, devolvemos mock para que se vea algo
    const randomIndex = Math.floor(Math.random() * EMOTIONS.length);
    const label = EMOTIONS[randomIndex];
    const score = Math.random() * 0.3 + 0.7; // 0.7 a 1.0

    return {
        label,
        score
    };
}