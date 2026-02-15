export function calculateDeceptionProbability(signals: any, baselineData: any): number {
    let probability = 0;

    // Analyze signals related to stress and incongruence
    const stressLevel = signals.stressLevel || 0;
    const incongruenceLevel = signals.incongruenceLevel || 0;

    // Calculate base probability based on stress and incongruence
    probability += stressLevel * 0.5; // Weight for stress
    probability += incongruenceLevel * 0.5; // Weight for incongruence

    // Adjust probability based on baseline data
    if (baselineData) {
        const baselineStress = baselineData.stressLevel || 0;
        const baselineIncongruence = baselineData.incongruenceLevel || 0;

        // Normalize the probability based on baseline
        probability = (probability - baselineStress - baselineIncongruence) / 2;
    }

    // Ensure probability is within 0 to 1 range
    probability = Math.max(0, Math.min(1, probability));

    return probability;
}