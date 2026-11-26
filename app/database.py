"""
Database schema & session management using SQLAlchemy + SQLite.
Stores transcriptions, audio metadata, language hints, and timestamps.
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, Float
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession

DATABASE_URL = "sqlite+aiosqlite:///./transcriptions.db"

Base = declarative_base()

class TranscriptionRecord(Base):
    __tablename__ = "transcriptions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    title = Column(String(255), default="Untitled Session")
    text = Column(Text, nullable=False)
    original_text = Column(Text, nullable=True) # in case edits are made
    language = Column(String(64), default="multilingual (hi-IN / en-IN)")
    engine = Column(String(64), default="multilingual-recognizer")
    duration = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "text": self.text,
            "original_text": self.original_text,
            "language": self.language,
            "engine": self.engine,
            "duration": self.duration,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
