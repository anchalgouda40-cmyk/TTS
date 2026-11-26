#!/bin/bash
# Startup script for Real-time Multilingual STT & Dashboard
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    ./venv/bin/pip install --upgrade pip
    ./venv/bin/pip install fastapi "uvicorn[standard]" python-multipart sqlalchemy aiosqlite httpx gTTS websockets SpeechRecognition
fi

echo "Starting Real-time Speech-to-Text service on http://0.0.0.0:8000 ..."
exec ./venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
