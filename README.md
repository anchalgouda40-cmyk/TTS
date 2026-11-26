# Real-Time Multilingual Speech-to-Text & Transcription Service

An end-to-end web application providing real-time multilingual Speech-to-Text (STT) for sentences spoken in a mixture of Hindi and English (Hinglish), backed by persistent SQLite storage with full CRUD history management, audio file transcription, and open-source Text-to-Speech (TTS).

---

## Features
- **Real-time Multilingual Speech-to-Text**:
  - Live WebSocket audio streaming directly from the microphone.
  - Handles Hindi (`hi-IN`), Indian English (`en-IN`), US English (`en-US`), and mixed code-switched Hindi-English sentences.
  - Hybrid pipeline: streaming backend WebSocket transcription combined with zero-latency browser Web Speech fallback.
- **Database & Full CRUD Dashboard**:
  - **Create**: Save live streaming sessions or direct inputs with custom titles and language tags.
  - **Read**: List and search transcription history with timestamps, audio duration, and word count.
  - **Update**: Edit transcribed text or titles directly in a modal dialog.
  - **Delete**: Remove historical transcription records with immediate UI sync.
- **Open-Source Text-to-Speech (TTS)**:
  - Play back saved or current transcripts using open-source `gTTS` with automatic multilingual language detection.
- **Audio File Upload**:
  - Drag-and-drop `.wav`, `.mp3`, `.webm`, or `.ogg` files for instant server-side conversion & transcription using `ffmpeg` & STT engines.
- **Interactive Visualizer**:
  - Live HTML5 Canvas audio wave and frequency spectrum visualizer while speaking.

---

## Tech Stack
- **Backend**: FastAPI (Python 3.12), WebSockets, AsyncIO, Uvicorn
- **Database & ORM**: SQLite, SQLAlchemy, aiosqlite
- **Speech-to-Text**: Multilingual SpeechRecognition, Gemini Live compatible pipeline, Web Speech API fallback
- **Text-to-Speech**: gTTS (Google Text-to-Speech open engine)
- **Frontend**: Responsive HTML5, Vanilla JavaScript (MediaRecorder, WebSockets, Web Audio API), Modern Dark Glassmorphic CSS

---

## Getting Started

### 1. Prerequisites
- Python 3.10+
- FFmpeg (for audio format conversions)

### 2. Installation
```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
```

### 3. Run the Service
```bash
chmod +x run.sh
./run.sh
```
Or directly:
```bash
./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Open your browser at: **`http://localhost:8000`**
