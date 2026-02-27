/**
 * Demo Diagnosis API - Gemini Vision for quick personal color analysis
 * No MongoDB, no S3 - just receive image, call Gemini, return result
 */
const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Gemini setup
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;

if (GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE') {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    console.log('Gemini API initialized');
} else {
    console.warn('GEMINI_API_KEY not set. Demo diagnosis disabled.');
}

// Simple in-memory rate limiter
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 10;
const RATE_LIMIT_WINDOW = (parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES) || 60) * 60 * 1000;

function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now - record.windowStart > RATE_LIMIT_WINDOW) {
        rateLimitMap.set(ip, { windowStart: now, count: 1 });
        return true;
    }

    if (record.count >= RATE_LIMIT_MAX) {
        return false;
    }

    record.count++;
    return true;
}

// Clean up rate limit map periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimitMap) {
        if (now - record.windowStart > RATE_LIMIT_WINDOW) {
            rateLimitMap.delete(ip);
        }
    }
}, 10 * 60 * 1000);

/**
 * Demo diagnosis prompt (simplified version)
 */
const DEMO_DIAGNOSIS_PROMPT = `
# APL Personal Color Demo Diagnosis

You are a professional personal color consultant. Analyze the provided face photo and diagnose:
1. Personal Color (one of 14 season types)
2. Face Shape (one of 7 types)

## Personal Color - 14 Season Types

### SPRING (Warm + Bright/Vivid)
- Spring Light: Peach base, transparent bright skin, light brown eyes
- Spring Bright: Very bright and vivid skin, clear bright eyes
- Spring Soft: Muted feel, soft calm brown eyes
- Spring Clear: Transparent clean skin, vivid clear eyes

### SUMMER (Cool + Bright/Soft)
- Summer Light: Clear clean cool tone skin, soft calm brown eyes
- Summer Bright: Cool and vivid skin, bright clear eyes
- Summer Mute: Warm-cool balance, deep calm eyes

### AUTUMN (Warm + Deep/Muted)
- Autumn Mute: Subtle yellow undertone, soft muted feel
- Autumn Deep: Deep rich warm tone, dark brown eyes
- Autumn Strong: Intense warmth, dark strong eyes

### WINTER (Cool + Vivid/Deep)
- Winter Clear: Transparent clean cool tone, clear vivid black eyes
- Winter Strong: Bright cool tone, high contrast, sharp black eyes
- Winter Cool Deep: Cool deep tone, deep strong eyes
- Winter Soft: Soft cool tone, subtle brown-gray eyes

## Face Shape - 7 Types
1. Oval: Balanced forehead-cheekbone-jawline
2. Round: Overall soft curves, wider proportions
3. Square: Angular forehead and jawline
4. Oblong: Vertically elongated
5. Heart: Wide forehead, pointed chin
6. Diamond: Widest at cheekbones
7. Inverted Triangle: Wide forehead, narrow chin

## Response Format (JSON)

**IMPORTANT: Respond ONLY with pure JSON. No code blocks, no markdown.**

{
  "personalColor": "Spring Light",
  "seasonGroup": "Spring",
  "personalColorDetail": "Your skin has a transparent, bright peach base undertone...",
  "personalColorCharacteristics": {
    "hue": "Warm",
    "value": "High",
    "chroma": "Medium",
    "contrast": "Low"
  },
  "faceShape": "Oval",
  "faceShapeDetail": "Balanced forehead, cheekbones, and jawline...",
  "bestColors": ["Peach", "Coral", "Ivory", "Light Beige", "Soft Yellow"],
  "avoidColors": ["Black", "Cool Gray", "Neon", "Dark Brown"],
  "stylingTip": "A brief 1-2 sentence styling recommendation based on personal color and face shape."
}
`;

/**
 * POST /api/demo/diagnose
 * Receive base64 image, call Gemini, return diagnosis
 *
 * Body: { image: "base64string", mimeType: "image/jpeg" }
 */
router.post('/diagnose', async (req, res) => {
    try {
        // Rate limit check
        const clientIP = req.ip || req.connection.remoteAddress;
        if (!checkRateLimit(clientIP)) {
            return res.status(429).json({
                success: false,
                message: 'Too many requests. Please try again later.'
            });
        }

        // Check Gemini availability
        if (!genAI) {
            return res.status(503).json({
                success: false,
                message: 'AI service is not configured.'
            });
        }

        const { image, mimeType } = req.body;

        if (!image) {
            return res.status(400).json({
                success: false,
                message: 'Image data is required.'
            });
        }

        const imageMimeType = mimeType || 'image/jpeg';

        console.log(`Demo diagnosis request from ${clientIP} (${(image.length * 0.75 / 1024).toFixed(0)} KB)`);

        // Call Gemini Vision
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

        const result = await model.generateContent([
            DEMO_DIAGNOSIS_PROMPT + '\n\nAnalyze the photo below and provide the diagnosis. Respond with JSON only.',
            {
                inlineData: {
                    data: image,
                    mimeType: imageMimeType
                }
            }
        ]);

        const rawResponse = result.response.text();
        console.log(`Gemini response: ${rawResponse.length} chars`);

        // Parse JSON
        let diagnosis;
        try {
            diagnosis = JSON.parse(rawResponse);
        } catch (parseError) {
            let jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/);
            if (!jsonMatch) jsonMatch = rawResponse.match(/```\s*([\s\S]*?)\s*```/);
            if (!jsonMatch) jsonMatch = rawResponse.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                const jsonString = jsonMatch[1] || jsonMatch[0];
                try {
                    diagnosis = JSON.parse(jsonString);
                } catch (e) {
                    throw new Error(`JSON parse failed: ${parseError.message}`);
                }
            } else {
                throw new Error(`JSON parse failed: ${parseError.message}`);
            }
        }

        console.log(`Demo result: ${diagnosis.personalColor}, ${diagnosis.faceShape}`);

        res.json({
            success: true,
            diagnosis: {
                personalColor: diagnosis.personalColor,
                seasonGroup: diagnosis.seasonGroup,
                personalColorDetail: diagnosis.personalColorDetail,
                personalColorCharacteristics: diagnosis.personalColorCharacteristics,
                faceShape: diagnosis.faceShape,
                faceShapeDetail: diagnosis.faceShapeDetail,
                bestColors: diagnosis.bestColors,
                avoidColors: diagnosis.avoidColors,
                stylingTip: diagnosis.stylingTip
            },
            isDemo: true
        });

    } catch (error) {
        console.error('Demo diagnosis error:', error.message);
        res.status(500).json({
            success: false,
            message: 'AI diagnosis failed. Please try again.'
        });
    }
});

/**
 * GET /api/demo/status
 * Check if demo service is available
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        available: !!genAI,
        model: 'gemini-2.5-flash'
    });
});

module.exports = router;
