export type BigFive = { O: number; C: number; E: number; A: number; N: number };

export interface PersonalityQuestion {
    id: number;
    trait: keyof BigFive;
    reversed: boolean;
    text: string;
}

export const BIG_FIVE_QUESTIONS: PersonalityQuestion[] = [
    { id: 1, trait: 'O', reversed: false, text: 'Me gusta probar ideas o experiencias nuevas.' },
    { id: 2, trait: 'O', reversed: true, text: 'Prefiero rutinas conocidas antes que explorar cosas nuevas.' },
    { id: 3, trait: 'C', reversed: false, text: 'Soy ordenado/a y cumplo lo que planifico.' },
    { id: 4, trait: 'C', reversed: true, text: 'Dejo tareas para último momento con frecuencia.' },
    { id: 5, trait: 'E', reversed: false, text: 'Me siento con energía al socializar con otras personas.' },
    { id: 6, trait: 'E', reversed: true, text: 'Prefiero actividades solitarias la mayor parte del tiempo.' },
    { id: 7, trait: 'A', reversed: false, text: 'Suelo ser empático/a y me importa cómo se sienten los demás.' },
    { id: 8, trait: 'A', reversed: true, text: 'En discusiones, me cuesta ceder aunque no sea tan importante.' },
    { id: 9, trait: 'N', reversed: false, text: 'Me preocupo con facilidad o me estreso rápido.' },
    { id: 10, trait: 'N', reversed: true, text: 'Mantengo la calma incluso cuando hay presión.' }
];

const invert = (value: number): number => 6 - value;

function clampLikert(value: number): number {
    return Math.min(5, Math.max(1, Math.round(value)));
}

export function computeBigFive(answers: number[]): BigFive {
    if (answers.length !== 10) {
        throw new Error('Se requieren 10 respuestas para calcular Big Five.');
    }

    const sanitized = answers.map(clampLikert);

    return {
        O: (sanitized[0] + invert(sanitized[1])) / 2,
        C: (sanitized[2] + invert(sanitized[3])) / 2,
        E: (sanitized[4] + invert(sanitized[5])) / 2,
        A: (sanitized[6] + invert(sanitized[7])) / 2,
        N: (sanitized[8] + invert(sanitized[9])) / 2
    };
}

export function traitToPercent(value: number): number {
    const clamped = Math.min(5, Math.max(1, value));
    return Math.round(((clamped - 1) / 4) * 100);
}

function traitLabel(trait: keyof BigFive, percent: number): string {
    if (trait === 'O') return percent >= 67 ? 'Curiosidad alta' : percent >= 34 ? 'Curiosidad media' : 'Curiosidad baja';
    if (trait === 'C') return percent >= 67 ? 'Estructura alta' : percent >= 34 ? 'Estructura media' : 'Estructura media-baja';
    if (trait === 'E') return percent >= 67 ? 'Social alto' : percent >= 34 ? 'Social moderado' : 'Social reservado';
    if (trait === 'A') return percent >= 67 ? 'Empatía alta' : percent >= 34 ? 'Empatía media' : 'Empatía baja';
    return percent >= 67 ? 'Alta reactividad al estrés' : percent >= 34 ? 'Reactividad media al estrés' : 'Baja reactividad al estrés';
}

export function buildBigFiveSummary(scores: BigFive): string {
    const O = traitToPercent(scores.O);
    const C = traitToPercent(scores.C);
    const E = traitToPercent(scores.E);
    const A = traitToPercent(scores.A);
    const N = traitToPercent(scores.N);

    return [
        `O: ${O}% ${traitLabel('O', O)}`,
        `C: ${C}% ${traitLabel('C', C)}`,
        `E: ${E}% ${traitLabel('E', E)}`,
        `A: ${A}% ${traitLabel('A', A)}`,
        `N: ${N}% ${traitLabel('N', N)}`
    ].join(' · ');
}
