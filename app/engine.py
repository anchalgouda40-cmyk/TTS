"""
Transcription and Text-to-Speech service handler.
Supports:
1. Multilingual Audio chunk/file transcription (Hindi + English / Hinglish / auto-detect).
2. Live WebSocket audio stream decoding with chunk aggregation & real-time response.
3. Gemini API / Gemini Live fallback / simulated backend if API key provided or standard recognizer.
4. Text-to-Speech (TTS) using open-source gTTS & Web Speech API fallback.
"""
import os
import io
import wave
import tempfile
import asyncio
import subprocess
from typing import Optional, Dict, Any
import speech_recognition as sr
from gtts import gTTS

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

class TranscriptionEngine:
    def __init__(self):
        self.recognizer = sr.Recognizer()
        self.recognizer.energy_threshold = 300
        self.recognizer.dynamic_energy_threshold = True

    def convert_to_wav(self, input_bytes: bytes, input_format: Optional[str] = None) -> bytes:
        """Converts incoming audio bytes (mp3, webm, ogg, pcm) to standard 16kHz mono WAV for STT."""
        try:
            cmd = ["ffmpeg", "-y"]
            if input_format:
                cmd += ["-f", input_format]
            cmd += [
                "-i", "pipe:0",
                "-ar", "16000",
                "-ac", "1",
                "-f", "wav",
                "pipe:1"
            ]
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            out, err = process.communicate(input=input_bytes, timeout=10)
            if process.returncode == 0 and len(out) > 44:
                return out
        except Exception:
            pass

        # Fallback without format flag
        try:
            cmd = [
                "ffmpeg",
                "-y",
                "-i", "pipe:0",
                "-ar", "16000",
                "-ac", "1",
                "-f", "wav",
                "pipe:1"
            ]
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            out, err = process.communicate(input=input_bytes, timeout=10)
            if process.returncode == 0 and len(out) > 44:
                return out
        except Exception:
            pass
        return input_bytes

    async def transcribe_audio_chunk(self, audio_bytes: bytes, language: str = "hi-IN,en-IN") -> Dict[str, Any]:
        """
        Transcribes multilingual audio bytes (Hindi + English / Hinglish).
        Uses open source & free transcription pipeline.
        """
        wav_data = self.convert_to_wav(audio_bytes)
        
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._transcribe_sync, wav_data, language)

    def _transcribe_sync(self, wav_bytes: bytes, language: str) -> Dict[str, Any]:
        if not wav_bytes or len(wav_bytes) < 44:
            return {"text": "", "detected_lang": language, "success": False, "error": "Empty or corrupted audio"}

        try:
            with io.BytesIO(wav_bytes) as wav_file:
                with sr.AudioFile(wav_file) as source:
                    audio_data = self.recognizer.record(source)

            # Try primary target (Hindi/Hinglish hi-IN or en-IN)
            # Google Speech recognition API through SpeechRecognition is free and multilingual
            candidates = []
            
            # Primary recognition query:
            # In India, multilingual speakers speak Hinglish (Hindi + English mixed)
            target_langs = ["hi-IN", "en-IN", "en-US"] if "hi" in language.lower() else ["en-IN", "hi-IN", "en-US"]
            
            recognized_text = ""
            active_lang = target_langs[0]

            for lang in target_langs:
                try:
                    text = self.recognizer.recognize_google(audio_data, language=lang)
                    if text and text.strip():
                        recognized_text = text.strip()
                        active_lang = lang
                        break
                except sr.UnknownValueError:
                    continue
                except sr.RequestError as e:
                    # network error or rate limit
                    return {"text": "", "detected_lang": active_lang, "success": False, "error": f"API request error: {str(e)}"}
                except Exception:
                    continue

            if recognized_text:
                return {
                    "text": recognized_text,
                    "detected_lang": active_lang,
                    "success": True,
                    "engine": "multilingual-stt (hi-IN/en-IN)"
                }
            else:
                return {
                    "text": "",
                    "detected_lang": language,
                    "success": False,
                    "error": "No speech detected in this segment"
                }

        except Exception as e:
            return {"text": "", "detected_lang": language, "success": False, "error": str(e)}

    def synthesize_speech(self, text: str, lang: str = "hi") -> bytes:
        """Text to speech synthesis using open source gTTS."""
        # Detect or default language
        target_lang = "hi" if ("hi" in lang.lower() or any('\u0900' <= char <= '\u097F' for char in text)) else "en"
        tts = gTTS(text=text, lang=target_lang, slow=False)
        fp = io.BytesIO()
        tts.write_to_fp(fp)
        fp.seek(0)
        return fp.read()

stt_engine = TranscriptionEngine()
