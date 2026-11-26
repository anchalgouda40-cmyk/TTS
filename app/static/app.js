// VoxLingua Real-Time Speech-to-Text & Dashboard Client
let websocket = null;
let mediaRecorder = null;
let audioContext = null;
let analyser = null;
let isRecording = false;
let recordingStartTime = null;
let timerInterval = null;
let currentSessionText = "";
let historyCache = [];

// DOM Elements
const wsStatusDot = document.getElementById("ws-status-dot");
const wsStatusText = document.getElementById("ws-status-text");
const recordBtn = document.getElementById("record-btn");
const recordBtnText = document.getElementById("record-btn-text");
const saveTranscriptBtn = document.getElementById("save-transcript-btn");
const ttsListenBtn = document.getElementById("tts-listen-btn");
const liveTranscript = document.getElementById("live-transcript");
const streamStatus = document.getElementById("stream-status");
const recordingTimer = document.getElementById("recording-timer");
const charCount = document.getElementById("char-count");
const historyTableBody = document.getElementById("history-table-body");
const visualizerCanvas = document.getElementById("visualizer");
const canvasCtx = visualizerCanvas.getContext("2d");

// Initialize on Load
document.addEventListener("DOMContentLoaded", () => {
  initWebSocket();
  loadHistory();
  setupLiveTranscriptListeners();
});

// 1. WebSocket Setup for Real-time Streaming
function initWebSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/transcribe`;

  websocket = new WebSocket(wsUrl);

  websocket.onopen = () => {
    wsStatusDot.className = "status-dot connected";
    wsStatusText.innerText = "Real-time STT Connected";
  };

  websocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "transcript") {
        const text = data.text;
        if (text) {
          if (liveTranscript.value.trim().length > 0) {
            liveTranscript.value += " " + text;
          } else {
            liveTranscript.value = text;
          }
          currentSessionText = liveTranscript.value;
          updateWordCount();
          saveTranscriptBtn.disabled = false;
          ttsListenBtn.disabled = false;
          streamStatus.innerHTML = `<span style="color:#38bdf8"><i class="fa-solid fa-check"></i> Transcribed chunk: "${text}" (${data.detected_lang || 'multilingual'})</span>`;
        }
      } else if (data.type === "saved") {
        alert("Transcription successfully saved to database!");
        loadHistory();
      } else if (data.type === "audio_processed") {
        if (isRecording) {
          streamStatus.innerText = "Listening... Multilingual speech processing active.";
        }
      } else if (data.type === "error") {
        console.warn("STT Notice:", data.message);
      }
    } catch (e) {
      console.error("WebSocket message parse error:", e);
    }
  };

  websocket.onclose = () => {
    wsStatusDot.className = "status-dot";
    wsStatusText.innerText = "Disconnected (Reconnecting...)";
    setTimeout(initWebSocket, 3000);
  };

  websocket.onerror = () => {
    wsStatusDot.className = "status-dot";
    wsStatusText.innerText = "Connection error";
  };
}

// 2. Microphone & Audio Streaming Handler
async function toggleRecording() {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Setup Visualizer
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    drawVisualizer();

    // Setup MediaRecorder with 2-second streaming audio chunks
    const mimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/wav'];
    const selectedMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';

    mediaRecorder = new MediaRecorder(stream, selectedMime ? { mimeType: selectedMime } : {});

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0 && websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(event.data);
      }
    };

    // Emit chunk every 2.5 seconds for low latency streaming transcription
    mediaRecorder.start(2500);

    // Also support Web Speech API as simultaneous in-browser instant transcription engine for zero latency
    startWebSpeechFallback();

    isRecording = true;
    recordBtn.classList.add("recording");
    recordBtnText.innerText = "Stop Recording";
    wsStatusDot.className = "status-dot recording";
    streamStatus.innerText = "Microphone streaming: Hindi / English / Hinglish speech is active...";
    startTimer();

  } catch (err) {
    alert("Microphone permission was denied or is unavailable: " + err.message);
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }

  if (recognition) {
    try { recognition.stop(); } catch(e){}
  }

  isRecording = false;
  recordBtn.classList.remove("recording");
  recordBtnText.innerText = "Start Real-time Recording";
  wsStatusDot.className = "status-dot connected";
  streamStatus.innerText = "Session stopped. You can edit, listen, or save to Database.";
  stopTimer();

  if (liveTranscript.value.trim().length > 0) {
    saveTranscriptBtn.disabled = false;
    ttsListenBtn.disabled = false;
  }
}

// Zero-latency Web Speech API integration for instant interim words
let recognition = null;
function startWebSpeechFallback() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return;

  try {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.getElementById("lang-select").value.split(",")[0] || 'hi-IN';

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          const finalWord = event.results[i][0].transcript.trim();
          if (!liveTranscript.value.includes(finalWord)) {
            liveTranscript.value += (liveTranscript.value ? " " : "") + finalWord;
          }
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      if (interim) {
        streamStatus.innerHTML = `<span style="color:#a5b4fc"><i class="fa-solid fa-microphone-lines"></i> Live speaking: "${interim}"</span>`;
      }
      updateWordCount();
      saveTranscriptBtn.disabled = false;
      ttsListenBtn.disabled = false;
    };

    recognition.start();
  } catch(e) {
    console.log("Browser speech recognition optional fallback initialized");
  }
}

// 3. Audio Visualizer Canvas
function drawVisualizer() {
  if (!analyser) return;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function render() {
    if (!isRecording) {
      canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
      return;
    }
    requestAnimationFrame(render);
    analyser.getByteFrequencyData(dataArray);

    canvasCtx.fillStyle = "#090d16";
    canvasCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);

    const barWidth = (visualizerCanvas.width / bufferLength) * 2.5;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * visualizerCanvas.height;
      canvasCtx.fillStyle = `rgb(${dataArray[i] + 50}, 99, 235)`;
      canvasCtx.fillRect(x, visualizerCanvas.height - barHeight, barWidth, barHeight);
      x += barWidth + 2;
    }
  }
  render();
}

// 4. Timer & UI helpers
function startTimer() {
  recordingStartTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const secs = String(elapsed % 60).padStart(2, "0");
    recordingTimer.innerHTML = `<i class="fa-regular fa-clock"></i> ${mins}:${secs}`;
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
}

function updateWordCount() {
  const text = liveTranscript.value.trim();
  const words = text ? text.split(/\s+/).length : 0;
  charCount.innerText = `${words} words (${text.length} chars)`;
}

function clearLiveTranscript() {
  liveTranscript.value = "";
  updateWordCount();
  saveTranscriptBtn.disabled = true;
  ttsListenBtn.disabled = true;
  streamStatus.innerText = "Cleared. Click Start Recording to speak.";
  if (websocket && websocket.readyState === WebSocket.OPEN) {
    websocket.send(JSON.stringify({ action: "reset" }));
  }
}

function setupLiveTranscriptListeners() {
  liveTranscript.addEventListener("input", () => {
    updateWordCount();
    const hasText = liveTranscript.value.trim().length > 0;
    saveTranscriptBtn.disabled = !hasText;
    ttsListenBtn.disabled = !hasText;
  });
}

// 5. CRUD: Create / Save
async function saveCurrentTranscript() {
  const text = liveTranscript.value.trim();
  if (!text) {
    alert("Nothing to save!");
    return;
  }

  const lang = document.getElementById("lang-select").value;
  const title = prompt("Enter a title for this transcription:", `Session ${new Date().toLocaleTimeString()}`);
  if (title === null) return;

  try {
    const resp = await fetch("/api/transcriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title || "Untitled Session",
        text: text,
        language: lang,
        engine: "multilingual-stt"
      })
    });

    if (resp.ok) {
      alert("Saved successfully to database!");
      loadHistory();
    } else {
      alert("Failed to save transcription.");
    }
  } catch (err) {
    alert("Error saving: " + err.message);
  }
}

// 6. CRUD: Read / List History
async function loadHistory() {
  try {
    const resp = await fetch("/api/transcriptions");
    if (!resp.ok) throw new Error("Could not fetch history");
    const records = await resp.json();
    historyCache = records;
    renderHistoryTable(records);
  } catch (err) {
    historyTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Error loading history: ${err.message}</td></tr>`;
  }
}

function renderHistoryTable(records) {
  if (records.length === 0) {
    historyTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No transcription records yet. Record speech or upload audio to see records here.</td></tr>`;
    return;
  }

  historyTableBody.innerHTML = records.map(rec => {
    const dateFormatted = rec.created_at ? new Date(rec.created_at).toLocaleString() : "-";
    const safeText = escapeHtml(rec.text);
    return `
      <tr>
        <td><strong>#${rec.id}</strong></td>
        <td><strong>${escapeHtml(rec.title)}</strong></td>
        <td>
          <div style="max-height: 80px; overflow-y: auto; white-space: pre-wrap;">${safeText}</div>
        </td>
        <td><span class="badge">${escapeHtml(rec.language || 'multilingual')}</span></td>
        <td class="small-text">${dateFormatted}</td>
        <td>
          <div class="action-btns">
            <button class="action-btn btn-info" title="TTS Listen" onclick="speakText('${encodeURIComponent(rec.text)}')">
              <i class="fa-solid fa-volume-high"></i>
            </button>
            <button class="action-btn btn-secondary" title="Edit Record" onclick="openEditModal(${rec.id})">
              <i class="fa-solid fa-pen"></i>
            </button>
            <button class="action-btn btn-danger" title="Delete Record" onclick="deleteRecord(${rec.id})">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function filterHistory() {
  const query = document.getElementById("search-history").value.toLowerCase();
  const filtered = historyCache.filter(r => 
    (r.title && r.title.toLowerCase().includes(query)) ||
    (r.text && r.text.toLowerCase().includes(query)) ||
    (r.language && r.language.toLowerCase().includes(query))
  );
  renderHistoryTable(filtered);
}

// 7. CRUD: Update Record
function openEditModal(id) {
  const record = historyCache.find(r => r.id === id);
  if (!record) return;

  document.getElementById("edit-id").value = record.id;
  document.getElementById("edit-title").value = record.title || "";
  document.getElementById("edit-lang").value = record.language || "";
  document.getElementById("edit-text").value = record.text || "";

  document.getElementById("edit-modal").classList.remove("hidden");
}

function closeEditModal() {
  const modal = document.getElementById("edit-modal");
  if (modal) {
    modal.classList.add("hidden");
  }
}

// Close modal if clicking outside modal box
document.addEventListener("click", (e) => {
  const modalOverlay = document.getElementById("edit-modal");
  if (modalOverlay && e.target === modalOverlay) {
    closeEditModal();
  }
});

async function submitEditTranscription() {
  const id = document.getElementById("edit-id").value;
  const title = document.getElementById("edit-title").value;
  const language = document.getElementById("edit-lang").value;
  const text = document.getElementById("edit-text").value;

  try {
    const resp = await fetch(`/api/transcriptions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, language, text })
    });

    if (resp.ok) {
      closeEditModal();
      loadHistory();
    } else {
      alert("Failed to update record.");
    }
  } catch (err) {
    alert("Error updating: " + err.message);
  }
}

// 8. CRUD: Delete Record
async function deleteRecord(id) {
  if (!confirm(`Are you sure you want to delete transcription record #${id}?`)) return;

  try {
    const resp = await fetch(`/api/transcriptions/${id}`, { method: "DELETE" });
    if (resp.ok) {
      loadHistory();
    } else {
      alert("Failed to delete record.");
    }
  } catch (err) {
    alert("Error deleting record: " + err.message);
  }
}

// 9. Text to Speech (TTS) Integration
async function speakCurrentTranscript() {
  const text = liveTranscript.value.trim();
  if (!text) return;
  await speakText(encodeURIComponent(text));
}

async function speakText(encodedText) {
  const text = decodeURIComponent(encodedText);
  try {
    const resp = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text, language: "hi" })
    });

    if (resp.ok) {
      const blob = await resp.blob();
      const audioUrl = URL.createObjectURL(blob);
      const player = document.getElementById("audio-player");
      player.src = audioUrl;
      player.play();
    } else {
      // Fallback to Web Speech Synthesis API
      const utterance = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utterance);
    }
  } catch (err) {
    // Web Speech API fallback
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }
}

// 10. File Audio Upload STT Handler
async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const resultContainer = document.getElementById("upload-result");
  const resultText = document.getElementById("upload-result-text");
  resultContainer.classList.remove("hidden");
  resultText.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Transcribing audio file <strong>${file.name}</strong>...`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("language", document.getElementById("lang-select").value);
  formData.append("save_to_db", "true");

  try {
    const resp = await fetch("/api/transcribe/upload", {
      method: "POST",
      body: formData
    });

    const data = await resp.json();
    if (data.transcription && data.transcription.text) {
      resultText.innerText = data.transcription.text;
      loadHistory();
    } else {
      resultText.innerText = "No transcription output or speech was detected.";
    }
  } catch (err) {
    resultText.innerText = "Error uploading file: " + err.message;
  }
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
