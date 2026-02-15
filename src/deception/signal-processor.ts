export class SignalProcessor {
    private age: number | null = null;
    private emotion: string | null = null;
    private attentionLevel: number | null = null;
    private fatigueLevel: number | null = null;
    private personalityTraits: string[] = [];

    constructor() {}

    public processSignals(age: number, emotion: string, attentionLevel: number, fatigueLevel: number, personalityTraits: string[]): void {
        this.age = age;
        this.emotion = emotion;
        this.attentionLevel = attentionLevel;
        this.fatigueLevel = fatigueLevel;
        this.personalityTraits = personalityTraits;

        // Additional processing logic can be added here
    }

    public getStressIndicators(): { stressLevel: number; incongruence: boolean } {
        let stressLevel = 0;

        // Example logic to calculate stress level based on various metrics
        if (this.emotion === 'stressed') {
            stressLevel += 50;
        }
        if (this.fatigueLevel && this.fatigueLevel > 5) {
            stressLevel += 30;
        }
        if (this.attentionLevel && this.attentionLevel < 3) {
            stressLevel += 20;
        }

        const incongruence = this.age && this.attentionLevel && this.age < 30 && this.attentionLevel < 3;

        return { stressLevel, incongruence };
    }
}