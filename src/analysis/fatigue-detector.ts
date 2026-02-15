export class FatigueDetector {
    private blinkRate: number;
    private eyeAspectRatio: number;

    constructor() {
        this.blinkRate = 0;
        this.eyeAspectRatio = 0;
    }

    public detectFatigue(eyeData: { blinkCount: number; eyeHeight: number; eyeWidth: number }): string {
        this.blinkRate = this.calculateBlinkRate(eyeData.blinkCount);
        this.eyeAspectRatio = this.calculateEyeAspectRatio(eyeData.eyeHeight, eyeData.eyeWidth);

        if (this.blinkRate > 15 && this.eyeAspectRatio < 0.2) {
            return "High fatigue detected";
        } else if (this.blinkRate > 10 && this.eyeAspectRatio < 0.3) {
            return "Moderate fatigue detected";
        } else {
            return "Low fatigue detected";
        }
    }

    private calculateBlinkRate(blinkCount: number): number {
        // Assuming this method calculates the blink rate based on time
        return blinkCount; // Placeholder for actual calculation
    }

    private calculateEyeAspectRatio(eyeHeight: number, eyeWidth: number): number {
        return eyeHeight / eyeWidth; // Placeholder for actual calculation
    }
}