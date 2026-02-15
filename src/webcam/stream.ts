export async function startWebcam(video: HTMLVideoElement): Promise<MediaStream> {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 480 },
                facingMode: 'user'
            },
            audio: false
        });

        video.srcObject = stream;

        return new Promise((resolve) => {
            video.onloadedmetadata = () => {
                video.play();
                resolve(stream);
            };
        });
    } catch (error) {
        console.error('Error al acceder a la cámara:', error);
        throw new Error('No se pudo acceder a la cámara. Verifica los permisos.');
    }
}

export function stopWebcam(stream: MediaStream): void {
    stream.getTracks().forEach(track => track.stop());
}