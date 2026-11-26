"""
FastAPI application with:
1. REST API for Full CRUD operations on Transcriptions.
2. WebSocket endpoint for Real-Time streaming Speech-to-Text.
3. Audio upload & Instant transcription endpoint.
4. Text to Speech (TTS) generation endpoint.
5. Interactive UI Dashboard serving.
"""
import os
import json
import uuid
import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import update, delete, desc

from app.database import init_db, get_db, TranscriptionRecord
from app.engine import stt_engine

app = FastAPI(title="Real-Time Multilingual Speech-to-Text & Dashboard")

# Mount static files
os.makedirs("app/static", exist_ok=True)
app.mount("/static", StaticFiles(directory="app/static"), name="static")

@app.on_event("startup")
async def on_startup():
    await init_db()

# --- Pydantic Schemas for CRUD ---
class TranscriptionCreate(BaseModel):
    title: Optional[str] = "Untitled Session"
    text: str
    language: Optional[str] = "multilingual (hi-IN / en-IN)"
    engine: Optional[str] = "real-time-stt"
    duration: Optional[float] = 0.0

class TranscriptionUpdate(BaseModel):
    title: Optional[str] = None
    text: Optional[str] = None
    language: Optional[str] = None

class TTSRequest(BaseModel):
    text: str
    language: Optional[str] = "hi"

# --- CRUD Endpoints ---

@app.get("/api/transcriptions")
async def list_transcriptions(db: AsyncSession = Depends(get_db)):
    """READ (List all) transcriptions ordered by most recent."""
    result = await db.execute(select(TranscriptionRecord).order_by(desc(TranscriptionRecord.created_at)))
    records = result.scalars().all()
    return [r.to_dict() for r in records]

@app.get("/api/transcriptions/{record_id}")
async def get_transcription(record_id: int, db: AsyncSession = Depends(get_db)):
    """READ (Single) transcription by ID."""
    result = await db.execute(select(TranscriptionRecord).where(TranscriptionRecord.id == record_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Transcription not found")
    return record.to_dict()

@app.post("/api/transcriptions", status_code=201)
async def create_transcription(data: TranscriptionCreate, db: AsyncSession = Depends(get_db)):
    """CREATE a new transcription record in the database."""
    record = TranscriptionRecord(
        title=data.title or "Untitled Session",
        text=data.text,
        original_text=data.text,
        language=data.language or "multilingual (hi-IN / en-IN)",
        engine=data.engine or "real-time-stt",
        duration=data.duration or 0.0,
        created_at=datetime.datetime.utcnow(),
        updated_at=datetime.datetime.utcnow()
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record.to_dict()

@app.put("/api/transcriptions/{record_id}")
async def update_transcription(record_id: int, data: TranscriptionUpdate, db: AsyncSession = Depends(get_db)):
    """UPDATE an existing transcription text, title or language."""
    result = await db.execute(select(TranscriptionRecord).where(TranscriptionRecord.id == record_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Transcription not found")

    if data.title is not None:
        record.title = data.title
    if data.text is not None:
        record.text = data.text
    if data.language is not None:
        record.language = data.language
    record.updated_at = datetime.datetime.utcnow()

    await db.commit()
    await db.refresh(record)
    return record.to_dict()

@app.delete("/api/transcriptions/{record_id}")
async def delete_transcription(record_id: int, db: AsyncSession = Depends(get_db)):
    """DELETE a transcription from the database."""
    result = await db.execute(select(TranscriptionRecord).where(TranscriptionRecord.id == record_id))
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Transcription not found")

    await db.delete(record)
    await db.commit()
    return {"message": "Transcription deleted successfully", "id": record_id}

# --- Audio File Upload & Processing ---

@app.post("/api/transcribe/upload")
async def transcribe_file(
    file: UploadFile = File(...),
    language: str = Form("hi-IN,en-IN"),
    save_to_db: bool = Form(True),
    db: AsyncSession = Depends(get_db)
):
    """Transcribes an uploaded audio file (wav, webm, mp3, ogg)."""
    contents = await file.read()
    fmt = file.filename.split(".")[-1] if "." in file.filename else "webm"
    result = await stt_engine.transcribe_audio_chunk(contents, language=language)
    
    saved_record = None
    if save_to_db and result.get("success") and result.get("text"):
        record = TranscriptionRecord(
            title=f"Upload: {file.filename}",
            text=result["text"],
            original_text=result["text"],
            language=result.get("detected_lang", language),
            engine=result.get("engine", "upload-stt"),
            duration=0.0
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)
        saved_record = record.to_dict()

    return {
        "transcription": result,
        "saved_record": saved_record
    }

# --- Text-to-Speech (TTS) Endpoint ---

@app.post("/api/tts")
async def text_to_speech(payload: TTSRequest):
    """Generates audio for given text using open-source gTTS."""
    try:
        audio_bytes = stt_engine.synthesize_speech(payload.text, lang=payload.language or "hi")
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")

# --- Real-Time Streaming WebSocket ---

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket, db: AsyncSession = Depends(get_db)):
    """
    Real-Time Multilingual Speech-to-Text WebSocket Stream.
    Receives real-time raw audio binary chunks from the browser microphone,
    converts and feeds chunks to the transcription engine,
    and pushes live intermediate and finalized transcripts back.
    """
    await websocket.accept()
    session_id = str(uuid.uuid4())[:8]
    accumulated_text = []
    
    try:
        await websocket.send_json({
            "type": "connected",
            "session_id": session_id,
            "message": "Real-time speech-to-text connection established. Ready for multilingual audio stream."
        })

        while True:
            message = await websocket.receive()
            
            # Binary chunk from MediaRecorder or AudioWorklet
            if "bytes" in message and message["bytes"]:
                chunk_bytes = message["bytes"]
                # Process speech audio chunk
                res = await stt_engine.transcribe_audio_chunk(chunk_bytes, language="hi-IN,en-IN")
                
                if res.get("success") and res.get("text"):
                    chunk_text = res["text"].strip()
                    accumulated_text.append(chunk_text)
                    full_current_text = " ".join(accumulated_text)
                    
                    await websocket.send_json({
                        "type": "transcript",
                        "is_final": True,
                        "text": chunk_text,
                        "cumulative": full_current_text,
                        "detected_lang": res.get("detected_lang")
                    })
                else:
                    await websocket.send_json({
                        "type": "audio_processed",
                        "message": "Chunk received (silence or low energy)"
                    })

            # JSON control commands (start, stop, save)
            elif "text" in message and message["text"]:
                try:
                    data = json.loads(message["text"])
                    action = data.get("action")
                    
                    if action == "save":
                        # Save current session transcription into DB
                        final_text = data.get("text", " ".join(accumulated_text)).strip()
                        title = data.get("title", f"Real-time Session #{session_id}")
                        lang = data.get("language", "multilingual (hi-IN / en-IN)")
                        
                        if final_text:
                            rec = TranscriptionRecord(
                                title=title,
                                text=final_text,
                                original_text=final_text,
                                language=lang,
                                engine="real-time-live",
                                duration=float(data.get("duration", 0.0))
                            )
                            db.add(rec)
                            await db.commit()
                            await db.refresh(rec)
                            
                            await websocket.send_json({
                                "type": "saved",
                                "record": rec.to_dict()
                            })
                        else:
                            await websocket.send_json({
                                "type": "error",
                                "message": "No transcription text to save."
                            })

                    elif action == "reset":
                        accumulated_text = []
                        await websocket.send_json({"type": "reset_done"})

                    elif action == "ping":
                        await websocket.send_json({"type": "pong"})

                except json.JSONDecodeError:
                    pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass

# --- Front-end Root Page ---

@app.get("/", response_class=HTMLResponse)
async def serve_index():
    with open("app/templates/index.html", "r", encoding="utf-8") as f:
        return f.read()
