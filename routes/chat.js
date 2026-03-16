/**
 * AI Beauty Consultation Chat — Landing Page
 * Public endpoint for demo visitors to ask about personal color & styling
 */
const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const API_KEY = process.env.GEMINI_API_KEY;

const SYSTEM_PROMPT = `You are an AI beauty consultant for APL COLOR, a professional personal color and image consulting service backed by 12,000+ real consultation records.

You help visitors understand personal color analysis and beauty styling. You can answer questions about:
- What personal color analysis is and how it works
- The 4 seasonal types (Spring, Summer, Autumn, Winter) and their sub-tones
- How face shape affects styling choices (eyebrows, glasses, accessories)
- Color recommendations for different skin tones
- How body type influences fashion styling
- What APL COLOR's AI diagnosis service includes

Your personality:
- Friendly, approachable, and professional
- Use clear and simple language (avoid jargon unless asked)
- Give specific, actionable examples when possible
- Encourage visitors to try the demo diagnosis
- Keep responses concise (2-3 paragraphs max)
- Respond in the language the visitor writes in (Korean, English, Japanese, Chinese)

You are NOT a replacement for a professional colorist — you help people understand the basics and see the value of expert consultation.`;

router.post('/', async (req, res) => {
    try {
        const { message, history = [] } = req.body;

        if (!message) {
            return res.status(400).json({ success: false, message: 'message is required.' });
        }

        if (!API_KEY) {
            return res.status(500).json({ success: false, message: 'API key not configured.' });
        }

        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: SYSTEM_PROMPT
        });

        const chatHistory = history.map(h => ({
            role: h.role === 'user' ? 'user' : 'model',
            parts: [{ text: h.text }]
        }));

        const chat = model.startChat({ history: chatHistory });
        const result = await chat.sendMessage(message);
        const reply = result.response.text();

        console.log(`[Chat] msg="${message.substring(0, 50)}...", reply=${reply.length}chars`);

        res.json({ success: true, data: { reply } });

    } catch (error) {
        console.error('[Chat] Error:', error.message);
        res.status(500).json({ success: false, message: 'AI service temporarily unavailable.' });
    }
});

module.exports = router;
