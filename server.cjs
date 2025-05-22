const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const dotenv = require('dotenv');
const nlp = require('compromise');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const chatRouter = require('./routes/chatRouter.cjs');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'upload/'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Gemini LLM Setup
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash-lite",
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0.5,
  maxRetries: 2,
});

// Stop words to exclude irrelevant words
const stopWords = new Set([
  "the", "and", "skills", "experience", "contact", "page", "resume", "name", "email",
  "address", "phone", "summary", "curriculum", "vitae", "linkedin", "github", "www", "com",
  "section", "education", "projects", "work", "organization", "institute", "also", "with", "this",
  "that", "from", "for", "are", "you", "your", "has", "have"
]);

function extractNouns(text) {
  const doc = nlp(text);
  const nouns = doc.nouns().out("array");

  const freqMap = {};
  nouns.forEach(word => {
    word = word.toLowerCase();
    if (word.length > 2 && !stopWords.has(word)) {
      freqMap[word] = (freqMap[word] || 0) + 1;
    }
  });

  const sorted = Object.entries(freqMap)
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);

  return sorted.slice(0, 30); // top 30 nouns
}

// Ping route
app.get('/ping', (req, res) => {
  res.status(200).json({ message: 'Server is live!' });
});

// Upload resume route with enhanced keyword extraction
app.post('/upload-resume', upload.single('resume'), async (req, res) => {
  try {
    const filePath = req.file.path;
    const fileBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(fileBuffer);
    const text = data.text;

    

    // Extract top noun keywords using compromise and stopword filter
    const nounKeywords = extractNouns(text);

    // Prepare prompt for Gemini to filter relevant keywords
    const messages = [
  {
    role: "system",
    content: "You are a helpful assistant extracting relevant job-related keywords from the text. You also extract name and personal details of applicant from resume."
  },
  {
    role: "user",
    content: `Apart from name and personal data Select the top 10 most relevant job-related keywords from the list below. 
Only include technologies, skills, certifications, job titles, and tools. 
Exclude generic words. Return the keywords as a comma-separated list.

${nounKeywords.join(", ")}`
  }
];

const response = await llm.predictMessages(messages);
const rawKeywords = response.content || response.text || response;

    // Parse Gemini output into array of keywords
    const finalKeywords = rawKeywords
      .split(",")
      .map(k => k.trim())
      .filter(k => k.length > 0);

    // Cleanup uploaded file
    fs.unlinkSync(filePath);

    res.status(200).json({ keywords: finalKeywords });
  } catch (error) {
    console.error("Resume upload error:", error);
    res.status(500).json({ error: 'Failed to process the resume' });
  }
});

// AI Interviewer Chat Routes
app.use('/', chatRouter);

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
