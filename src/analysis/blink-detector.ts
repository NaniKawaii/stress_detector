const EAR_THRESHOLD = 0.18;
const MAR_THRESHOLD = 0.5;

interface BlinkFrame {
    timestamp: number;
    isEyeOpen: boolean;
    isYawning: boolean;
}

class BlinkDetector {
    private frames: BlinkFrame[] = [];
    private blinkEvents: number[] = [];
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
        this.blinkEvents = this.blinkEvents.filter((timestamp) => now - timestamp < this.windowSize);

        if (this.frames.length >= 2) {
            const prev = this.frames[this.frames.length - 2];
            const curr = this.frames[this.frames.length - 1];

            if (prev.isEyeOpen && !curr.isEyeOpen) {
                this.blinkEvents.push(now);
            }
        }

        const elapsedWindowMs = this.frames.length > 1
            ? Math.max(1000, this.frames[this.frames.length - 1].timestamp - this.frames[0].timestamp)
            : 0;

        const blinksPerMinute = elapsedWindowMs > 0
            ? Math.round((this.blinkEvents.length / elapsedWindowMs) * 60000)
            : 0;

        return {
            blinks: blinksPerMinute,
            isBlinking: !isEyeOpen,
            isYawning
        };
    }

    reset(): void {
        this.frames = [];
        this.blinkEvents = [];
    }
}

export const blinkDetector = new BlinkDetector();
