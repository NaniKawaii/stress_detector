/**
 * Calculate deception probability based on z-scores from baseline.
 * Returns a value 0–100 representing the likelihood of stress/incongruence.
 */
export function calculateDeceptionProbability(zScores: Record<string, number>): number {
    if (!zScores || Object.keys(zScores).length === 0) {
        return 0;
    }

    // Weights for each signal (must sum to ~1.0)
    const weights = {
        attention: 0.28,       // Lower attention = higher deception probability
        blinkRate: 0.22,       // Abnormal blink rate
        fatigue: 0.16,         // Fatigue unrelated to task
        headMotion: 0.18,      // Excessive head movement
        emotionVolatility: 0.16 // Emotional inconsistency
    };

    // Combine z-scores with weights
    let deceptionScore = 0;
    let totalWeight = 0;

    Object.entries(weights).forEach(([key, weight]) => {
        const z = zScores[key] || 0;
        // Clamp z-score and convert to 0-1 scale (saturation at z=2)
        const normalizedZ = Math.min(Math.max(z / 2, 0), 1);
        deceptionScore += normalizedZ * weight;
        totalWeight += weight;
    });

    // Normalize to 0-100 scale
    const probability = (deceptionScore / Math.max(totalWeight, 1)) * 100;

    // Clamp to 0-100 and round
    return Math.round(Math.min(Math.max(probability, 0), 100));
}