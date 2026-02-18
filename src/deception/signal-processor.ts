export interface BaselineMetrics {
    attentionMean: number;
    attentionStd: number;
    blinkRateMean: number;
    blinkRateStd: number;
    fatigueMean: number;
    fatigueStd: number;
    headMotionMean: number;
    headMotionStd: number;
    emotionVolatilityMean: number;
    emotionVolatilityStd: number;
}

// Default baseline for when no calibration is performed
const DEFAULT_BASELINE: BaselineMetrics = {
    attentionMean: 75,
    attentionStd: 12,
    blinkRateMean: 15,
    blinkRateStd: 4,
    fatigueMean: 25,
    fatigueStd: 8,
    headMotionMean: 5,
    headMotionStd: 2,
    emotionVolatilityMean: 0.15,
    emotionVolatilityStd: 0.08
};

export class SignalProcessor {
    private baseline: BaselineMetrics | null = null;
    private currentSignals = {
        attention: 0,
        blinkRate: 0,
        fatigue: 0,
        headMotion: 0,
        emotionVolatility: 0
    };

    constructor() {
        // Use default baseline if none is set
        console.log('[SignalProcessor] Initialized with default baseline');
    }

    public setBaseline(baseline: BaselineMetrics): void {
        this.baseline = baseline;
    }

    public updateSignals(
        attention: number,
        blinkRate: number,
        fatigue: number,
        headMotion: number,
        emotionVolatility: number
    ): void {
        this.currentSignals = {
            attention,
            blinkRate,
            fatigue,
            headMotion,
            emotionVolatility
        };
    }

    public calculateZScores(): Record<string, number> {
        // Use default baseline if none is set
        const baseline = this.baseline || DEFAULT_BASELINE;

        const { attention, blinkRate, fatigue, headMotion, emotionVolatility } = this.currentSignals;
        const z: Record<string, number> = {};

        // Calculate z-scores: |value - mean| / std
        z.attention = Math.abs(attention - baseline.attentionMean) / Math.max(baseline.attentionStd, 0.1);
        z.blinkRate = Math.abs(blinkRate - baseline.blinkRateMean) / Math.max(baseline.blinkRateStd, 1);
        z.fatigue = Math.abs(fatigue - baseline.fatigueMean) / Math.max(baseline.fatigueStd, 1);
        z.headMotion = Math.abs(headMotion - baseline.headMotionMean) / Math.max(baseline.headMotionStd, 0.1);
        z.emotionVolatility = Math.abs(emotionVolatility - baseline.emotionVolatilityMean) / Math.max(baseline.emotionVolatilityStd, 0.1);

        console.debug('[Deception.SignalProcessor] Z-Scores calculated:', z);
        return z;
    }

    public getBaseline(): BaselineMetrics | null {
        return this.baseline || DEFAULT_BASELINE;
    }

    public isUsingDefaultBaseline(): boolean {
        return this.baseline === null;
    }

    public getSignals() {
        return this.currentSignals;
    }
}