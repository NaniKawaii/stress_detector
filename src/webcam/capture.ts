export function getFrame(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement
): ImageData {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo obtener contexto 2D del canvas');

    // Asegurar que el canvas tenga las mismas dimensiones que el video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Dibujar el frame del video en el canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Retornar ImageData
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export function drawLandmarks(
    canvas: HTMLCanvasElement,
    landmarks: Array<[number, number]>,
    color: string = '#00ff88'
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = color;
    landmarks.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
    });
}

export function drawBox(
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string = '',
    color: string = '#00ff88'
): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);

    if (label) {
        ctx.fillStyle = color;
        ctx.font = '12px Arial';
        ctx.fillText(label, x, y - 5);
    }
}