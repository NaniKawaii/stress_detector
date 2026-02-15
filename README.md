# Stress/Incongruence Signal Detector

## Overview
The Stress/Incongruence Signal Detector is a project designed to analyze user signals through webcam input. It estimates various psychological and physiological metrics, including age, emotion, attention level, fatigue, and personality traits. Additionally, it calculates the probability of deception based on user responses and analyzed signals.

## Features
- **Age Estimation**: Estimates the user's age using facial features.
- **Emotion Detection**: Identifies emotions from facial expressions.
- **Attention Analysis**: Measures attention levels based on gaze direction.
- **Fatigue Detection**: Assesses fatigue levels through eye metrics.
- **Personality Analysis**: Evaluates personality traits via a mini-test.
- **Deception Probability Calculation**: Computes the likelihood of deception based on analyzed signals.

## Project Structure
```
stress-detector
├── src
│   ├── main.ts
│   ├── webcam
│   │   ├── capture.ts
│   │   └── stream.ts
│   ├── analysis
│   │   ├── age-estimator.ts
│   │   ├── emotion-detector.ts
│   │   ├── attention-analyzer.ts
│   │   ├── fatigue-detector.ts
│   │   └── personality-analyzer.ts
│   ├── deception
│   │   ├── signal-processor.ts
│   │   └── probability-calculator.ts
│   ├── models
│   │   └── index.ts
│   ├── types
│   │   └── index.ts
│   └── utils
│       └── logger.ts
├── public
│   └── index.html
├── package.json
├── tsconfig.json
└── README.md
```

## Installation
1. Clone the repository:
   ```
   git clone <repository-url>
   ```
2. Navigate to the project directory:
   ```
   cd stress-detector
   ```
3. Install the dependencies:
   ```
   npm install
   ```

## Usage
1. Start the application:
   ```
   npm start
   ```
2. Open your web browser and navigate to `http://localhost:3000` to access the interface.
3. Allow webcam access when prompted to begin the analysis.

## Dependencies
- OpenCV
- MediaPipe
- Streamlit
- Other necessary libraries as specified in `package.json`

## Contributing
Contributions are welcome! Please submit a pull request or open an issue for any enhancements or bug fixes.

## License
This project is licensed under the MIT License. See the LICENSE file for details.