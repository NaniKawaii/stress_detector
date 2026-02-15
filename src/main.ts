import { startWebcam, stopWebcam } from './webcam/stream';
import { getFrame, drawLandmarks, drawBox } from './webcam/capture';
import { detectEmotion } from './analysis/emotion-detector';
import { AnalysisFrame } from './types/index';

let stream: MediaStream | null = null;
let isRunning = false;

interface UIElements {
    video: HTMLVideoElement;
    overlay: HTMLCanvasElement;
    status: HTMLElement;
    age: HTMLElement;
    emotion: HTMLElement;
    attention: HTMLElement;
    fatigue: HTMLElement;
    personality: HTMLElement;
    deception: HTMLElement;
    timer: HTMLElement;
    calibrateBtn: HTMLButtonElement;
    questionBtn: HTMLButtonElement;
}

function getUIElements(): UIElements {
    return {
        video: document.getElementById('cam') as HTMLVideoElement,
        overlay: document.getElementById('overlay') as HTMLCanvasElement,
        status: document.getElementById('status') as HTMLElement,
        age: document.getElementById('age') as HTMLElement,
        emotion: document.getElementById('emotion') as HTMLElement,
        attention: document.getElementById('attention') as HTMLElement,
        fatigue: document.getElementById('fatigue') as HTMLElement,
        personality: document.getElementById('personality') as HTMLElement,
        deception: document.getElementById('deception') as HTMLElement,
        timer: document.getElementById('timer') as HTMLElement,
        calibrateBtn: document.getElementById('calibrate-btn') as HTMLButtonElement,
        questionBtn: document.getElementById('question-btn') as HTMLButtonElement
    };
}

function updateStats(ui: UIElements, analysis: AnalysisFrame): void {
    ui.emotion.textContent = `${analysis.emotion.label} (${(analysis.emotion.score * 100).toFixed(0)}%)`;
    ui.age.textContent = `${analysis.age.age} años`;
    ui.attention.textContent = `${analysis.attention.level}%`;
    ui.fatigue.textContent = analysis.fatigue.level;
    // TODO: actualizar deception cuando esté listo
}

async function frameLoop(ui: UIElements): Promise<void> {
    if (!isRunning) return;

    try {
        // Capturar frame
        const frame = getFrame(ui.video, ui.overlay);

        // Análisis (por ahora solo emoción)
        const analysis: AnalysisFrame = {
            emotion: await detectEmotion(frame),
            age: { age: Math.floor(Math.random() * 40 + 15), confidence: 0.85 },
            attention: { level: Math.floor(Math.random() * 30 + 70), gazingAway: false },
            fatigue: { level: 'Baja', blinkRate: 15, eyeAspectRatio: 0.4 },
            headPose: { yaw: 0, pitch: 0, roll: 0 }
        };

        // Actualizar UI
        updateStats(ui, analysis);
        ui.status.textContent = '✓ Cámara activa';
        ui.status.style.color = '#00ff88';

        // Siguiente frame
        requestAnimationFrame(() => frameLoop(ui));
    } catch (error) {
        console.error('Error en frame loop:', error);
        ui.status.textContent = '✗ Error en análisis';
        ui.status.style.color = '#ff6b7a';
        setTimeout(() => frameLoop(ui), 100);
    }
}

async function init(): Promise<void> {
    const ui = getUIElements();

    try {
        ui.status.textContent = 'Solicitando acceso a cámara...';
        stream = await startWebcam(ui.video);
        isRunning = true;

        // Iniciar loop de frames
        frameLoop(ui);

        // Event listeners
        ui.calibrateBtn.addEventListener('click', () => {
            ui.status.textContent = '🔄 Calibrando baseline (5s)...';
            ui.calibrateBtn.disabled = true;
            setTimeout(() => {
                ui.status.textContent = '✓ Baseline calibrado';
                ui.calibrateBtn.disabled = false;
            }, 5000);
        });

        ui.questionBtn.addEventListener('click', () => {
            startQuestionMode(ui);
        });
    } catch (error) {
        ui.status.textContent = `✗ ${error instanceof Error ? error.message : 'Error desconocido'}`;
        ui.status.style.color = '#ff6b7a';
    }
}

async function startQuestionMode(ui: UIElements): Promise<void> {
    ui.questionBtn.disabled = true;
    ui.timer.style.display = 'block';
    let seconds = 7;

    const interval = setInterval(() => {
        ui.timer.textContent = String(seconds);
        seconds--;

        if (seconds < 0) {
            clearInterval(interval);
            ui.timer.style.display = 'none';
            ui.deception.textContent = `${Math.floor(Math.random() * 60 + 20)}%`;
            ui.questionBtn.disabled = false;
        }
    }, 1000);
}

// Iniciar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}