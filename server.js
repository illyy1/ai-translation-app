import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Document, Packer, Paragraph } from 'docx';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.GEMINI_API_KEY;
const geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

if (!apiKey) {
  console.warn('Warning: GEMINI_API_KEY is not set. Add it to your .env file before running transcription.');
}

ffmpeg.setFfmpegPath(ffmpegPath);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-transcript-'));
      cb(null, tempDir);
    },
    filename: (_, file, cb) => {
      const safeName = file.originalname.replace(/\s+/g, '_');
      cb(null, safeName);
    }
  }),
  limits: { fileSize: 100 * 1024 * 1024 }
});

function buildPrompt(mode, language) {
  const normalizedMode = (mode || 'formal').toLowerCase();
  const normalizedLanguage = (language || 'English').trim() || 'English';

  const base = `You are a highly accurate transcription assistant. Produce a verbatim transcript of the audio while preserving meaning, speaker turns, punctuation, and hesitations where relevant. If there is any unclear language, use [unclear] rather than guessing. The transcript must be written in ${normalizedLanguage}.`;

  if (normalizedMode === 'academic') {
    return `${base}\n\nFormatting instructions: convert the transcript into a clear student-friendly study guide in ${normalizedLanguage}. Simplify dense wording, preserve the core meaning, highlight key concepts, and structure the output with headings like 'Key ideas', 'Important terms', and 'Summary'.`;
  }

  return `${base}\n\nFormatting instructions: format the transcript in a polished professional style suitable for legal, business, or formal documentation. Use clear headings, standard capitalization, and precise terminology. When multiple speakers are present, label them as 'Speaker 1', 'Speaker 2', and so on.`;
}

function extractAudio(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioChannels(1)
      .audioCodec('pcm_s16le')
      .audioFrequency(16000)
      .save(outputPath)
      .on('end', resolve)
      .on('error', reject);
  });
}

async function transcribeAudio(audioPath, mode, language) {
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Add it to your .env file before using the app.');
  }

  const audioBuffer = fs.readFileSync(audioPath);
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error('The extracted audio file is empty.');
  }

  const safeModel = geminiModel || 'gemini-2.0-flash';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: safeModel });
  const base64Audio = audioBuffer.toString('base64');

  console.log('Audio diagnostics:', {
    audioPath,
    bytes: audioBuffer.length,
    model: safeModel,
    mimeType: 'audio/wav'
  });

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        { text: buildPrompt(mode, language) },
        {
          inlineData: {
            mimeType: 'audio/wav',
            data: base64Audio
          }
        }
      ]
    }]
  });

  let text = '';

  try {
    text = result?.response?.text ? result.response.text() : '';
  } catch (error) {
    console.error('Gemini text extraction failed:', error);
  }

  if (!text || !text.trim()) {
    const parsed = result?.response?.candidates
      ?.map((candidate) => candidate?.content?.parts?.map((part) => part?.text || '').join('') || '')
      .join('\n')
      .trim();

    const promptFeedback = result?.response?.promptFeedback || null;
    const finishReason = result?.response?.candidates?.[0]?.finishReason || 'unknown';

    if (parsed) {
      text = parsed;
    } else {
      throw new Error(
        `Gemini returned no transcript text. Finish reason: ${finishReason}. Prompt feedback: ${JSON.stringify(promptFeedback || {})}`
      );
    }
  }

  return text.trim();
}

async function buildDocxBuffer(text) {
  const doc = new Document({
    sections: [{
      properties: {},
      children: text.split(/\n+/).map((line) => new Paragraph({ text: line || ' ' }))
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

app.get('/api/health', (_, res) => {
  res.json({ ok: true, message: 'Transcript API is running.' });
});

app.post('/api/transcribe', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ detail: 'No file uploaded.' });
    }

    const fileName = req.file.originalname || 'upload.mp4';
    if (!fileName.toLowerCase().endsWith('.mp4')) {
      return res.status(400).json({ detail: 'Only MP4 files are supported.' });
    }

    const uploadPath = req.file.path;
    const outputDir = path.join(os.tmpdir(), `audio-${uuidv4()}`);
    fs.mkdirSync(outputDir, { recursive: true });

    const audioPath = path.join(outputDir, 'audio.wav');

    await extractAudio(uploadPath, audioPath);
    const transcript = await transcribeAudio(audioPath, req.body.mode || 'formal', req.body.language || 'English');

    fs.rmSync(uploadPath, { force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });

    return res.json({
      transcript,
      mode: req.body.mode || 'formal',
      language: req.body.language || 'English'
    });
  } catch (error) {
    console.error('Transcription error:', error);
    const message = error?.message || 'Failed to process the uploaded video.';

    if (message.includes('No such file') || message.includes('Invalid data') || message.includes('ffmpeg')) {
      return res.status(400).json({ detail: 'Could not extract audio from the uploaded MP4. Please check the file and try again.' });
    }

    return res.status(500).json({ detail: message });
  }
});

app.post('/api/download', express.json(), async (req, res) => {
  try {
    const { transcript = '', format = 'txt' } = req.body || {};
    if (!transcript.trim()) {
      return res.status(400).json({ detail: 'Transcript is empty.' });
    }

    if (format === 'docx') {
      const buffer = await buildDocxBuffer(transcript);
      res.setHeader('Content-Disposition', 'attachment; filename="transcript.docx"');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      return res.send(buffer);
    }

    res.setHeader('Content-Disposition', 'attachment; filename="transcript.txt"');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(transcript);
  } catch (error) {
    console.error('Download error:', error);
    return res.status(500).json({ detail: 'Failed to generate the download file.' });
  }
});

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
