const express = require('express');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const { ChatPromptTemplate } = require('@langchain/core/prompts');
const dotenv = require('dotenv');
dotenv.config();
const router = express.Router();
const nlp = require("compromise");
const {basePrompt} = require('../prompts/prompts.js');

// In-memory storage for chat history and resume keywords
const userChatHistory = {}; // { sessionId: [{ role, content }, ...] }
const resumeKeywordsMap = {}; // { sessionId: ["keyword1", "keyword2", ...] }

// Gemini setup
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.0-flash-lite",
  apiKey: process.env.GOOGLE_API_KEY,
  temperature: 0.7,
  maxRetries: 2,
});

/* Custom system prompt
const SYSTEM_PROMPT = `You are an AI interviewer conducting a technical interview based on the user's resume and conversation.
Ask relevant, thoughtful, and progressive questions. Begin by greeting the user and asking for an introduction.
Then ask interview-style questions based on the resume keywords provided. Keep questions short and clear.`;*/

// Utility to build the full prompt
function buildPrompt(history, keywords) {
  return ChatPromptTemplate.fromMessages([
    ["system", basePrompt(keywords)], // ✅ FIXED: called function, removed extra '}'
    ...history.map(msg => [msg.role === "human" ? "user" : "assistant", msg.content])
  ]);
}

// Handle chat messages
router.post('/chat', async (req, res) => {
  const { message, sessionId } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ error: "Missing session ID or message" });
  }

  // Initialize session data if needed
  userChatHistory[sessionId] = userChatHistory[sessionId] || [];
  resumeKeywordsMap[sessionId] = resumeKeywordsMap[sessionId] || [];

  // Add user's message to history
  userChatHistory[sessionId].push({ role: "human", content: message });

  try {
    // Defensive: ensure keywords array is not empty
    if (!Array.isArray(resumeKeywordsMap[sessionId]) || resumeKeywordsMap[sessionId].length === 0) {
      console.warn(`Warning: Keywords for session ${sessionId} empty or invalid. Using fallback ["general"].`);
      resumeKeywordsMap[sessionId] = ["general"];
    }

    // Build prompt with history and resume keywords
    const prompt = buildPrompt(userChatHistory[sessionId], resumeKeywordsMap[sessionId]);
    console.log("Prompt object:", prompt);
    console.log("Prompt type:", typeof prompt);

     console.log("DEBUG: basePrompt output:");
    console.log(basePrompt(resumeKeywordsMap[sessionId]));  // Show the raw prompt string
    
    console.log("DEBUG: Prompt object from buildPrompt:");
    console.log(prompt);

    const messages = await prompt.formatMessages({});
    console.log("Formatted messages returned from prompt.formatMessages():", messages);
    console.log("Is 'messages' an array?", Array.isArray(messages));

    if (!Array.isArray(messages)) {
      throw new Error("Expected 'messages' from prompt.formatMessages to be an array");
    }

    // Log each message's keys and types for debugging
    messages.forEach((msg, idx) => {
      console.log(`Message[${idx}]:`, msg);
      if (typeof msg !== 'object' || !('role' in msg) || !('content' in msg)) {
        console.warn(`Message at index ${idx} is malformed:`, msg);
      } else {
        console.log(`  role: ${typeof msg.role} (${msg.role}), content: ${typeof msg.content} (${msg.content.substring(0, 30)}...)`);
      }
    });

    // Now call Gemini LLM
    const aiResponse = await llm.predictMessages(messages);
    console.log("AI response:", aiResponse);

    // Add AI response to history
    userChatHistory[sessionId].push({ role: "ai", content: aiResponse.content });

    res.json({ response: aiResponse.content });
  } catch (error) {
    console.error("AI Chat Error:", error);
    res.status(500).json({ error: "Failed to get AI response", details: error.message });
  }
});

// Set keywords per session
router.post('/set-keywords', (req, res) => {
  const { sessionId, keywords } = req.body;

  if (!sessionId || !Array.isArray(keywords)) {
    console.warn("Invalid input for /set-keywords:", req.body);
    return res.status(400).json({ error: "Invalid input" });
  }

  resumeKeywordsMap[sessionId] = keywords
    .map(k => k.trim().toLowerCase())
    .filter(k => k.length > 0);

  console.log(`Keywords set for session ${sessionId}:`, resumeKeywordsMap[sessionId]);
  res.json({ success: true });
});
// Stop words to exclude common irrelevant words
const stopWords = new Set([
  "the", "and", "skills", "experience", "contact", "page", "resume", "name", "email",
  "address", "phone", "summary", "curriculum", "vitae", "linkedin", "github", "www", "com",
  "section", "education", "projects", "work", "organization", "institute"
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

  return sorted.slice(0, 30); // get top 30 candidates
}

module.exports = router;
