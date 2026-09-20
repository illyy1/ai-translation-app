const form = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');
const dropzone = document.getElementById('dropzone');
const modeSelect = document.getElementById('mode');
const languageSelect = document.getElementById('language');
const submitBtn = document.getElementById('submit-btn');
const statusBox = document.getElementById('status');
const statusText = document.getElementById('status-text');
const progressBar = document.getElementById('progress-bar');
const resultBox = document.getElementById('result-box');
const errorBox = document.getElementById('error-box');
const downloadTxtBtn = document.getElementById('download-txt');
const downloadDocxBtn = document.getElementById('download-docx');
const timeline = document.getElementById('timeline');

let currentTranscript = '';

function setLoadingState(message, percent = 10) {
  statusBox.classList.remove('hidden');
  statusText.textContent = message;
  progressBar.style.width = `${percent}%`;
}

function setError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
}

function clearError() {
  errorBox.textContent = '';
  errorBox.classList.add('hidden');
}

function resetDownloadButtons() {
  downloadTxtBtn.classList.add('hidden');
  downloadDocxBtn.classList.add('hidden');
}

function triggerPicker() {
  fileInput.click();
}

function buildTimeline(transcript) {
  if (!transcript || !transcript.trim()) {
    timeline.innerHTML = '<div class="timeline-empty">Your transcript sections will appear here.</div>';
    return;
  }

  const blocks = transcript
    .split(/\n{2,}|\n(?=(?:Speaker|Key ideas|Important terms|Summary|Introduction|Conclusion))/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);

  if (blocks.length === 0) {
    timeline.innerHTML = '<div class="timeline-empty">No transcript segments available.</div>';
    return;
  }

  timeline.innerHTML = blocks
    .map((block, index) => {
      const title = block.split(/\s+/).slice(0, 5).join(' ');
      const summary = block.length > 140 ? `${block.slice(0, 140)}...` : block;
      return `
        <div class="timeline-item">
          <span class="timeline-step">Section ${index + 1}</span>
          <h4>${title || 'Transcript section'}</h4>
          <p>${summary}</p>
        </div>
      `;
    })
    .join('');
}

dropzone.addEventListener('click', triggerPicker);
dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    triggerPicker();
  }
});

['dragenter', 'dragover'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', (event) => {
  const files = event.dataTransfer.files;
  if (!files || files.length === 0) return;

  fileInput.files = files;
  const file = files[0];
  dropzone.innerHTML = `<div class="drop-icon">✓</div><strong>${file.name}</strong><span>Ready to process</span>`;
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  dropzone.innerHTML = `<div class="drop-icon">✓</div><strong>${file.name}</strong><span>Ready to process</span>`;
});

async function downloadFile(filename, format) {
  const response = await fetch('/api/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript: currentTranscript, format })
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.detail || 'Could not create the download file.');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  clearError();
  resetDownloadButtons();

  const selectedFile = fileInput.files?.[0];
  if (!selectedFile) {
    setError('Please choose an MP4 file before generating a transcript.');
    return;
  }

  if (!selectedFile.name.toLowerCase().endsWith('.mp4')) {
    setError('Only MP4 files are supported.');
    return;
  }

  submitBtn.disabled = true;
  const formData = new FormData();
  formData.append('file', selectedFile);
  formData.append('mode', modeSelect.value);
  formData.append('language', languageSelect.value);

  resultBox.textContent = 'Uploading and processing your video...';
  buildTimeline('');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/transcribe', true);

  xhr.upload.onprogress = (event) => {
    if (!event.lengthComputable) return;
    const percent = Math.min(78, Math.round((event.loaded / event.total) * 78));
    setLoadingState('Uploading video...', percent);
  };

  xhr.onreadystatechange = () => {
    if (xhr.readyState === 2) {
      setLoadingState('Extracting audio...', 80);
    }

    if (xhr.readyState === 3) {
      setLoadingState('Processing with Gemini...', 88);
    }

    if (xhr.readyState === 4) {
      submitBtn.disabled = false;

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          currentTranscript = data.transcript || '';
          resultBox.textContent = currentTranscript;
          buildTimeline(currentTranscript);
          setLoadingState('Transcript ready.', 100);
          downloadTxtBtn.classList.remove('hidden');
          downloadDocxBtn.classList.remove('hidden');
        } catch (error) {
          console.error(error);
          resultBox.textContent = 'Your transcript will appear here.';
          setError('The server returned invalid response data.');
          setLoadingState('Error', 0);
        }
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          setError(data.detail || 'Failed to generate transcript.');
        } catch {
          setError('Failed to generate transcript.');
        }

        resultBox.textContent = 'Your transcript will appear here.';
        setLoadingState('Error', 0);
      }
    }
  };

  xhr.onloadstart = () => {
    setLoadingState('Uploading video...', 10);
  };

  xhr.onerror = () => {
    setError('Network error while connecting to the server.');
    resultBox.textContent = 'Your transcript will appear here.';
    setLoadingState('Error', 0);
    submitBtn.disabled = false;
  };

  xhr.send(formData);
});

downloadTxtBtn.addEventListener('click', async () => {
  try {
    await downloadFile('transcript.txt', 'txt');
  } catch (error) {
    setError(error.message || 'Could not download the text file.');
  }
});

downloadDocxBtn.addEventListener('click', async () => {
  try {
    await downloadFile('transcript.docx', 'docx');
  } catch (error) {
    setError(error.message || 'Could not download the DOCX file.');
  }
});
