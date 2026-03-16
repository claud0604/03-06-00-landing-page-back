/**
 * AI Beauty Consultation Chat — Landing Page
 * Public endpoint for demo visitors to ask about personal color & styling
 */
const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const API_KEY = process.env.GEMINI_API_KEY;

const SYSTEM_PROMPT = `You are an AI beauty consultant for APL COLOR, a professional personal color and image consulting service backed by 12,000+ real consultation records.

You help visitors understand personal color analysis and beauty styling.

WHAT YOU CAN ANSWER (free knowledge):
- What personal color analysis is and how it works
- General explanation of the 4 seasonal types (Spring, Summer, Autumn, Winter)
- Why face shape matters for styling (general concepts)
- Why body type affects fashion choices (general concepts)
- What APL COLOR's diagnosis service includes and how it differs from standard AI
- General beauty/styling trends and terminology

WHAT YOU MUST NOT ANSWER (paid service territory):
- Specific sub-tone analysis (e.g., "Am I Spring Light or Spring Bright?") → redirect to diagnosis
- Specific product/cosmetic brand recommendations → "Our full diagnosis includes personalized product matching"
- Specific color codes or palettes for a person → "Get your exact palette through our professional diagnosis"
- Detailed face shape analysis from description → "Our AI can analyze your face shape precisely with a photo"
- Personalized styling plans → "This is exactly what our expert consultation provides"

REDIRECT STRATEGY:
When a visitor asks something in the paid territory, acknowledge their question warmly, give a brief general hint to show expertise, then guide them:
- "That's a great question! While I can share that [brief general insight], your exact [sub-tone/palette/product match] requires our professional AI diagnosis combined with expert review. Would you like to try our free demo first?"
- Never refuse rudely. Always give a small taste of value before redirecting.

Your personality:
- Friendly, approachable, and knowledgeable
- Use clear and simple language
- Show expertise through general insights (build trust)
- Naturally guide toward demo diagnosis or full service
- Keep responses concise (2-3 paragraphs max)
- Respond in the language the visitor writes in (Korean, English, Japanese, Chinese)`;

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
