# Vivid Transcript Studio

A JavaScript-based web app that accepts an MP4 upload, extracts the audio locally, and uses Gemini to generate a transcript in the selected language and output mode.

## Features

- Drag-and-drop MP4 upload
- Local audio extraction with FFmpeg
- Gemini 1.5 Flash transcription
- Formal/legal or academic/student output modes
- Transcript language selection
- TXT and DOCX export
- Responsive UI with vibrant cool-tone styling

## Setup

1. Install Node.js 18+
2. Install FFmpeg and confirm it is available on your PATH
3. Create a `.env` file from `.env.example`

Example:

```env
GEMINI_API_KEY=your_api_key_here
PORT=3000
```

## Install dependencies

```bash
npm install
```

No extra npm packages are required beyond the dependencies already listed in package.json. The app uses Express, Multer, Dotenv, Gemini SDK, FFmpeg, and DOCX support already included in the project.

> If your machine does not have a system FFmpeg binary available, install FFmpeg separately and make sure it is on your PATH.

## Run the app

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## Project layout

- `server.js` — Express API and Gemini integration
- `public/index.html` — frontend markup
- `public/styles.css` — UI styling
- `public/app.js` — client-side logic

