/**
 * Demo Diagnosis API — Gemini (text-only) for personal color analysis
 * Receives pre-extracted face measurement data (from client-side MediaPipe).
 * No images are received or stored. Results saved to MongoDB.
 */
const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const DemoData = require('../models/DemoData');

// ─── Gemini setup ───
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;

if (GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE') {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    console.log('Gemini API initialized');
} else {
    console.warn('GEMINI_API_KEY not set. Demo diagnosis disabled.');
}

// ─── Rate limiter ───
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
    if (record.count >= RATE_LIMIT_MAX) return false;
    record.count++;
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimitMap) {
        if (now - record.windowStart > RATE_LIMIT_WINDOW) rateLimitMap.delete(ip);
    }
}, 10 * 60 * 1000);

// ─── Helpers ───
function timezoneToRegion(tz) {
    if (!tz) return 'unknown';
    if (/^Asia\/(Seoul|Tokyo)/.test(tz)) return 'East Asia';
    if (/^Asia\/(Shanghai|Hong_Kong|Taipei|Chongqing|Macau)/.test(tz)) return 'East Asia';
    if (/^Asia\/(Bangkok|Ho_Chi_Minh|Jakarta|Singapore|Manila|Kuala_Lumpur)/.test(tz)) return 'Southeast Asia';
    if (/^Asia\//.test(tz)) return 'Asia';
    if (/^Europe\//.test(tz)) return 'Europe';
    if (/^America\//.test(tz)) return 'Americas';
    if (/^Africa\//.test(tz)) return 'Africa';
    if (/^(Australia|Pacific)\//.test(tz)) return 'Oceania';
    return 'Other';
}

function generateSessionId() {
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T.Z]/g, '').slice(0, 17);
    const rand = Math.random().toString(36).slice(2, 8);
    return `DEMO-${ts}-${rand}`;
}

function getLangInstruction(lang) {
    if (!lang) return 'Respond in English.';
    const code = lang.toLowerCase().slice(0, 2);
    switch (code) {
        case 'ko': return 'Respond entirely in Korean (한국어).';
        case 'ja': return 'Respond entirely in Japanese (日本語).';
        case 'zh': return 'Respond entirely in Chinese (中文).';
        default: return 'Respond in English.';
    }
}

// ─── Diagnosis prompt (text-only, data-based) ───
const DEMO_DIAGNOSIS_PROMPT = `
# APL Personal Color Demo Diagnosis (Data-Based)

You are a professional personal color consultant with expertise backed by 12,000+ real consultation records.

You will receive PRECISE MEASUREMENT DATA extracted from a client's photo using Google MediaPipe Face Landmarker (478 landmarks), Image Segmenter, and Canvas pixel analysis. No photo is provided — diagnose purely from the measured values.

## Input Data Description
- skinColor: RGB/HSL averaged from 8 facial points (cheeks, forehead, nose bridge, chin)
  - HSL hue interpretation: 0-40 or 340-360 = warm undertone, 180-280 = cool undertone
  - HSL saturation: higher = more vivid/clear skin
  - HSL lightness: higher = brighter/lighter skin
- hairColor: RGB/HSL from hair region (Image Segmentation mask or forehead fallback)
- eyeColor: RGB/HSL from iris center (if available)
- eyebrowColor: RGB/HSL averaged from 8 eyebrow landmark points
- lipColor: RGB/HSL averaged from 4 lip landmark points
- neckColor: RGB/HSL from 3 points below chin
- backgroundColor: RGB from background region (top + sides, body-filtered)
- faceProportions: Ratios normalized to cheekbone width (1.0)
  - foreheadRatio: forehead width / cheekbone width
  - jawRatio: jaw width / cheekbone width
  - heightRatio: face height / cheekbone width
- contrast: Euclidean RGB distance
  - skinHair: skin ↔ hair contrast
  - skinEye: skin ↔ eye contrast
  - skinLip: skin ↔ lip contrast (higher = more vivid lips relative to skin)
  - skinNeck: skin ↔ neck contrast (should be low; high value suggests lighting inconsistency)
- bodyProportions (if available):
  - shoulderHipRatio: shoulder width / hip width

## Personal Color — 14 Season Types

### SPRING (Warm + Bright/Vivid)
- Spring Light: Peach base, transparent bright skin (L>65, hue<35), light brown eyes
- Spring Bright: Very bright and vivid skin (S>40), clear bright eyes
- Spring Soft: Muted feel (S<35), soft calm brown eyes
- Spring Clear: Transparent clean skin, vivid clear eyes, medium-high contrast

### SUMMER (Cool + Bright/Soft)
- Summer Light: Clear clean cool tone skin (hue>300 or hue<15 with low S), soft eyes
- Summer Bright: Cool and vivid skin, bright clear eyes
- Summer Mute: Warm-cool balance, deep calm eyes, low saturation

### AUTUMN (Warm + Deep/Muted)
- Autumn Mute: Subtle yellow undertone (hue 25-40), soft muted feel (S<30)
- Autumn Deep: Deep rich warm tone (L<50), dark brown eyes, high contrast
- Autumn Strong: Intense warmth, dark strong eyes

### WINTER (Cool + Vivid/Deep)
- Winter Clear: Transparent clean cool tone, clear vivid black eyes, very high contrast
- Winter Strong: Bright cool tone, high contrast (skinHair>120), sharp black eyes
- Winter Cool Deep: Cool deep tone (L<45), deep strong eyes
- Winter Soft: Soft cool tone, subtle brown-gray eyes

## Face Shape — 7 Types (use faceProportions)
1. Oval: heightRatio 1.3-1.5, foreheadRatio ~0.85-0.95, jawRatio ~0.75-0.85
2. Round: heightRatio <1.3, foreheadRatio ~0.9, jawRatio ~0.85-0.95
3. Square: heightRatio 1.2-1.4, jawRatio >0.9 (wide jaw)
4. Oblong: heightRatio >1.5
5. Heart: foreheadRatio >0.95, jawRatio <0.7
6. Diamond: foreheadRatio <0.8, jawRatio <0.8 (widest at cheekbones)
7. Inverted Triangle: foreheadRatio >1.0, jawRatio <0.75

## Body Type — 5 Types (use bodyProportions)
1. Straight: shoulderHipRatio >1.1
2. Wave: shoulderHipRatio <0.95
3. Natural: shoulderHipRatio 0.95-1.1 (balanced, angular)
4. Apple: shoulderHipRatio >1.0 (upper body dominant)
5. Hourglass: shoulderHipRatio 0.95-1.05 (balanced)

## Response Format (JSON)

**IMPORTANT: Respond ONLY with pure JSON. No code blocks, no markdown.**

{
  "personalColor": "Spring Light",
  "seasonGroup": "Spring",
  "personalColorDetail": "Based on your skin measurements (HSL hue 28, saturation 42%, lightness 68%), your skin has a warm, bright peach undertone...",
  "personalColorCharacteristics": {
    "hue": "Warm",
    "value": "High",
    "chroma": "Medium",
    "contrast": "Low"
  },
  "faceShape": "Oval",
  "faceShapeDetail": "Your face proportions show balanced width ratios (forehead 0.88, jaw 0.79) with a height ratio of 1.38...",
  "bodyType": "Wave",
  "bodyTypeDetail": "Your shoulder-to-hip ratio of 0.91 indicates...",
  "bestColors": ["Peach", "Coral", "Ivory", "Light Beige", "Soft Yellow"],
  "avoidColors": ["Black", "Cool Gray", "Neon", "Dark Brown"],
  "stylingTip": "A brief 1-2 sentence styling recommendation."
}

If no body measurement data is provided, set bodyType and bodyTypeDetail to null.
Reference the actual measured values in your explanations to show data-backed reasoning.
`;

/**
 * POST /api/demo/diagnose
 * Receive extracted face/body measurement data (JSON only, no images)
 */
router.post('/diagnose', async (req, res) => {
    try {
        const clientIP = req.ip || req.connection.remoteAddress;
        if (!checkRateLimit(clientIP)) {
            return res.status(429).json({ success: false, message: 'Too many requests. Please try again later.' });
        }

        if (!genAI) {
            return res.status(503).json({ success: false, message: 'AI service is not configured.' });
        }

        const { faceAnalysis, bodyAnalysis, age, gender, timezone, lang } = req.body;

        if (!faceAnalysis || faceAnalysis.error) {
            return res.status(400).json({ success: false, message: 'Face analysis data is required.' });
        }

        console.log(`Demo diagnosis from ${clientIP} (data-only, age: ${age || 'N/A'}, gender: ${gender || 'N/A'}, lang: ${lang || 'N/A'})`);

        // Build text prompt with measurement data
        let prompt = DEMO_DIAGNOSIS_PROMPT;

        prompt += '\n\n## Client Measurement Data\n';
        prompt += `Skin Color: RGB(${faceAnalysis.skinColor.rgb.r}, ${faceAnalysis.skinColor.rgb.g}, ${faceAnalysis.skinColor.rgb.b})`;
        prompt += ` / HSL(${faceAnalysis.skinColor.hsl.h}, ${faceAnalysis.skinColor.hsl.s}%, ${faceAnalysis.skinColor.hsl.l}%)\n`;
        prompt += `Hair Color: RGB(${faceAnalysis.hairColor.rgb.r}, ${faceAnalysis.hairColor.rgb.g}, ${faceAnalysis.hairColor.rgb.b})`;
        prompt += ` / HSL(${faceAnalysis.hairColor.hsl.h}, ${faceAnalysis.hairColor.hsl.s}%, ${faceAnalysis.hairColor.hsl.l}%)\n`;

        if (faceAnalysis.eyeColor) {
            prompt += `Eye Color: RGB(${faceAnalysis.eyeColor.rgb.r}, ${faceAnalysis.eyeColor.rgb.g}, ${faceAnalysis.eyeColor.rgb.b})`;
            prompt += ` / HSL(${faceAnalysis.eyeColor.hsl.h}, ${faceAnalysis.eyeColor.hsl.s}%, ${faceAnalysis.eyeColor.hsl.l}%)\n`;
        }

        if (faceAnalysis.eyebrowColor) {
            prompt += `Eyebrow Color: RGB(${faceAnalysis.eyebrowColor.rgb.r}, ${faceAnalysis.eyebrowColor.rgb.g}, ${faceAnalysis.eyebrowColor.rgb.b})`;
            prompt += ` / HSL(${faceAnalysis.eyebrowColor.hsl.h}, ${faceAnalysis.eyebrowColor.hsl.s}%, ${faceAnalysis.eyebrowColor.hsl.l}%)\n`;
        }

        if (faceAnalysis.lipColor) {
            prompt += `Lip Color: RGB(${faceAnalysis.lipColor.rgb.r}, ${faceAnalysis.lipColor.rgb.g}, ${faceAnalysis.lipColor.rgb.b})`;
            prompt += ` / HSL(${faceAnalysis.lipColor.hsl.h}, ${faceAnalysis.lipColor.hsl.s}%, ${faceAnalysis.lipColor.hsl.l}%)\n`;
        }

        if (faceAnalysis.neckColor) {
            prompt += `Neck Color: RGB(${faceAnalysis.neckColor.rgb.r}, ${faceAnalysis.neckColor.rgb.g}, ${faceAnalysis.neckColor.rgb.b})`;
            prompt += ` / HSL(${faceAnalysis.neckColor.hsl.h}, ${faceAnalysis.neckColor.hsl.s}%, ${faceAnalysis.neckColor.hsl.l}%)\n`;
        }

        prompt += `Background: RGB(${faceAnalysis.backgroundColor.rgb.r}, ${faceAnalysis.backgroundColor.rgb.g}, ${faceAnalysis.backgroundColor.rgb.b})\n`;

        prompt += `\nFace Proportions (normalized to cheekbone width = 1.0):\n`;
        prompt += `- Forehead ratio: ${faceAnalysis.faceProportions.foreheadRatio}\n`;
        prompt += `- Jaw ratio: ${faceAnalysis.faceProportions.jawRatio}\n`;
        prompt += `- Height ratio: ${faceAnalysis.faceProportions.heightRatio}\n`;

        if (faceAnalysis.contrast) {
            prompt += `\nContrast (Euclidean RGB distance):\n`;
            prompt += `- Skin \u2194 Hair: ${faceAnalysis.contrast.skinHair}\n`;
            if (faceAnalysis.contrast.skinEye != null) {
                prompt += `- Skin \u2194 Eye: ${faceAnalysis.contrast.skinEye}\n`;
            }
            if (faceAnalysis.contrast.skinLip != null) {
                prompt += `- Skin \u2194 Lip: ${faceAnalysis.contrast.skinLip}\n`;
            }
            if (faceAnalysis.contrast.skinNeck != null) {
                prompt += `- Skin \u2194 Neck: ${faceAnalysis.contrast.skinNeck}\n`;
            }
        }

        if (bodyAnalysis && bodyAnalysis.bodyProportions) {
            prompt += `\nBody Proportions:\n`;
            prompt += `- Shoulder/Hip ratio: ${bodyAnalysis.bodyProportions.shoulderHipRatio}\n`;
        } else {
            prompt += '\n\nNo body measurement data provided. Set bodyType and bodyTypeDetail to null.\n';
        }

        if (age) prompt += `\nCustomer age: ${age}`;
        if (gender) prompt += `\nCustomer gender: ${gender}`;

        // Language instruction
        prompt += `\n\n${getLangInstruction(lang)}`;
        prompt += '\nBased on the precise measurements above, provide your professional diagnosis. Respond with JSON only.';

        // Call Gemini — TEXT ONLY (no image)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        const result = await model.generateContent(prompt);
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

        console.log(`Demo result: ${diagnosis.personalColor}, ${diagnosis.faceShape}${diagnosis.bodyType ? ', ' + diagnosis.bodyType : ''}`);

        // Send response first
        res.json({
            success: true,
            diagnosis: {
                personalColor: diagnosis.personalColor,
                seasonGroup: diagnosis.seasonGroup,
                personalColorDetail: diagnosis.personalColorDetail,
                personalColorCharacteristics: diagnosis.personalColorCharacteristics,
                faceShape: diagnosis.faceShape,
                faceShapeDetail: diagnosis.faceShapeDetail,
                bodyType: diagnosis.bodyType || null,
                bodyTypeDetail: diagnosis.bodyTypeDetail || null,
                bestColors: diagnosis.bestColors,
                avoidColors: diagnosis.avoidColors,
                stylingTip: diagnosis.stylingTip
            },
            isDemo: true
        });

        // Save to MongoDB asynchronously (non-blocking)
        DemoData.create({
            sessionId: generateSessionId(),
            age: age ? parseInt(age) : null,
            gender: gender || null,
            timezone: timezone || null,
            region: timezoneToRegion(timezone),
            lang: lang || null,
            colors: {
                skin: faceAnalysis.skinColor ? { rgb: faceAnalysis.skinColor.rgb, hsl: faceAnalysis.skinColor.hsl } : undefined,
                hair: faceAnalysis.hairColor ? { rgb: faceAnalysis.hairColor.rgb, hsl: faceAnalysis.hairColor.hsl } : undefined,
                eyebrow: faceAnalysis.eyebrowColor ? { rgb: faceAnalysis.eyebrowColor.rgb, hsl: faceAnalysis.eyebrowColor.hsl } : undefined,
                eye: faceAnalysis.eyeColor ? { rgb: faceAnalysis.eyeColor.rgb, hsl: faceAnalysis.eyeColor.hsl } : undefined,
                lip: faceAnalysis.lipColor ? { rgb: faceAnalysis.lipColor.rgb, hsl: faceAnalysis.lipColor.hsl } : undefined,
                neck: faceAnalysis.neckColor ? { rgb: faceAnalysis.neckColor.rgb, hsl: faceAnalysis.neckColor.hsl } : undefined,
                background: faceAnalysis.backgroundColor ? { rgb: faceAnalysis.backgroundColor.rgb } : undefined
            },
            faceProportions: faceAnalysis.faceProportions || undefined,
            bodyProportions: bodyAnalysis ? bodyAnalysis.bodyProportions : undefined,
            contrast: faceAnalysis.contrast || undefined,
            diagnosis: {
                personalColor: diagnosis.personalColor,
                seasonGroup: diagnosis.seasonGroup,
                personalColorDetail: diagnosis.personalColorDetail,
                faceShape: diagnosis.faceShape,
                faceShapeDetail: diagnosis.faceShapeDetail,
                bodyType: diagnosis.bodyType || null,
                bodyTypeDetail: diagnosis.bodyTypeDetail || null,
                bestColors: diagnosis.bestColors,
                avoidColors: diagnosis.avoidColors,
                stylingTip: diagnosis.stylingTip
            },
            segmentationUsed: faceAnalysis.segmentationUsed || false
        }).then(() => {
            console.log('Demo data saved to MongoDB');
        }).catch(err => {
            console.error('MongoDB save failed:', err.message);
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
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        available: !!genAI,
        model: 'gemini-2.5-flash',
        mode: 'data-only'
    });
});

/**
 * GET /api/demo/stats
 * Returns aggregated demo statistics from MongoDB
 */
router.get('/stats', async (req, res) => {
    try {
        const total = await DemoData.countDocuments();

        const byColor = await DemoData.aggregate([
            { $group: { _id: '$diagnosis.personalColor', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        const byFaceShape = await DemoData.aggregate([
            { $group: { _id: '$diagnosis.faceShape', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        const byRegion = await DemoData.aggregate([
            { $group: { _id: '$region', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        res.json({
            success: true,
            total,
            byColor: Object.fromEntries(byColor.map(i => [i._id || 'unknown', i.count])),
            byFaceShape: Object.fromEntries(byFaceShape.map(i => [i._id || 'unknown', i.count])),
            byRegion: Object.fromEntries(byRegion.map(i => [i._id || 'unknown', i.count]))
        });
    } catch (e) {
        console.error('Stats error:', e.message);
        res.status(500).json({ success: false, message: 'Failed to read stats.' });
    }
});

module.exports = router;
