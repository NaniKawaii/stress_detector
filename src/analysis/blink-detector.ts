const EAR_THRESHOLD = 0.18;
const MAR_THRESHOLD = 0.5;

interface BlinkFrame {
    timestamp: number;
    isEyeOpen: boolean;
    isYawning: boolean;
}

class BlinkDetector {
    private frames: BlinkFrame[] = [];
    private lastBlinkTime = 0;
    private blinkCount = 0;
    private windowSize = 60000;

    constructor() {}

    update(ear: number, mar: number, now: number = Date.now()): { blinks: number; isBlinking: boolean; isYawning: boolean } {
        const isEyeOpen = ear > EAR_THRESHOLD;
        const isYawning = mar > MAR_THRESHOLD;

        this.frames.push({
            timestamp: now,
            isEyeOpen,
            isYawning
        });

        this.frames = this.frames.filter((f) => now - f.timestamp < this.windowSize);

        let blinksThisFrame = 0;
        if (this.frames.length >= 2) {
            const prev = this.frames[this.frames.length - 2];
            const curr = this.frames[this.frames.length - 1];

            if (prev.isEyeOpen && !curr.isEyeOpen) {
                blinksThisFrame = 1;
                this.blinkCount++;
                this.lastBlinkTime = now;
            }
        }

        const blinksPerMinute = this.frames.length > 0
            ? Math.round((this.blinkCount / this.frames.length) * 600)
            : 0;

        return {
            blinks: blinksPerMinute,
            isBlinking: !isEyeOpen,
            isYawning
        };
    }

    reset(): void {
        this.frames = [];
        this.blinkCount = 0;
        this.lastBlinkTime = 0;
    }
}

export const blinkDetector = new BlinkDetector();
