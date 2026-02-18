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
}

export class SignalProcessor {
    private baseline: BaselineMetrics | null = null;
    private currentSignals = {
        attention: 0,
        blinkRate: 0,
        fatigue: 0,
        headMotion: 0,
        emotionVolatility: 0
    };

    constructor() {}

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
        if (!this.baseline) {
            return {};
        }

        const { attention, blinkRate, fatigue, headMotion, emotionVolatility } = this.currentSignals;
        const z: Record<string, number> = {};

        // Calculate z-scores: |value - mean| / std
        z.attention = Math.abs(attention - this.baseline.attentionMean) / Math.max(this.baseline.attentionStd, 0.1);
        z.blinkRate = Math.abs(blinkRate - this.baseline.blinkRateMean) / Math.max(this.baseline.blinkRateStd, 1);
        z.fatigue = Math.abs(fatigue - this.baseline.fatigueMean) / Math.max(this.baseline.fatigueStd, 1);
        z.headMotion = Math.abs(headMotion - this.baseline.headMotionMean) / Math.max(this.baseline.headMotionStd, 0.1);
        z.emotionVolatility = emotionVolatility / Math.max(this.baseline.emotionVolatilityMean, 0.1);

        return z;
    }

    public getSignals() {
        return this.currentSignals;
    }
}