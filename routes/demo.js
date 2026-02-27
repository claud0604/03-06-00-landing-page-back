/**
 * Demo Diagnosis API — Gemini (text-only) for personal color analysis
 * Receives pre-extracted face measurement data (from client-side MediaPipe).
 * No images are received or stored. Stateless — no MongoDB, no S3.
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

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

// ─── Anonymous stats storage ───
const DATA_DIR = path.join(__dirname, '..', 'data');
const STATS_FILE = path.join(DATA_DIR, 'demo-stats.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveAnonymousStats(data) {
    try {
        let stats = [];
        if (fs.existsSync(STATS_FILE)) {
            stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
        }
        stats.push(data);
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
    } catch (e) {
        console.error('Stats save failed:', e.message);
    }
}

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

// ─── Diagnosis prompt (text-only, data-based) ───
const DEMO_DIAGNOSIS_PROMPT = `
# APL Personal Color Demo Diagnosis (Data-Based)

You are a professional personal color consultant with expertise backed by 12,000+ real consultation records.

You will receive PRECISE MEASUREMENT DATA extracted from a client's photo using Google MediaPipe Face Landmarker (478 landmarks) and Canvas pixel analysis. No photo is provided — diagnose purely from the measured values.

## Input Data Description
- skinColor: RGB/HSL averaged from 6 facial points (cheeks, forehead)
  - HSL hue interpretation: 0-40 or 340-360 = warm undertone, 180-280 = cool undertone
  - HSL saturation: higher = more vivid/clear skin
  - HSL lightness: higher = brighter/lighter skin
- hairColor: RGB/HSL sampled above forehead
- eyeColor: RGB/HSL from iris center (if available)
- backgroundColor: RGB from photo corners (for lighting context — adjust readings if background is strongly colored)
- faceProportions: Ratios normalized to cheekbone width (1.0)
  - foreheadRatio: forehead width / cheekbone width
  - jawRatio: jaw width / cheekbone width
  - heightRatio: face height / cheekbone width
- contrast.skinHair: Euclidean RGB distance between skin and hair (higher = more contrast)
- contrast.skinEye: Euclidean RGB distance between skin and eye
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

        console.log(`Demo diagnosis from ${clientIP} (data-only, age: ${age || 'N/A'}, gender: ${gender || 'N/A'}, tz: ${timezone || 'N/A'})`);

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

        prompt += `Background: RGB(${faceAnalysis.backgroundColor.rgb.r}, ${faceAnalysis.backgroundColor.rgb.g}, ${faceAnalysis.backgroundColor.rgb.b})\n`;

        prompt += `\nFace Proportions (normalized to cheekbone width = 1.0):\n`;
        prompt += `- Forehead ratio: ${faceAnalysis.faceProportions.foreheadRatio}\n`;
        prompt += `- Jaw ratio: ${faceAnalysis.faceProportions.jawRatio}\n`;
        prompt += `- Height ratio: ${faceAnalysis.faceProportions.heightRatio}\n`;

        if (faceAnalysis.contrast) {
            prompt += `\nContrast (Euclidean RGB distance):\n`;
            prompt += `- Skin ↔ Hair: ${faceAnalysis.contrast.skinHair}\n`;
            if (faceAnalysis.contrast.skinEye != null) {
                prompt += `- Skin ↔ Eye: ${faceAnalysis.contrast.skinEye}\n`;
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

        prompt += '\n\nBased on the precise measurements above, provide your professional diagnosis. Respond with JSON only.';

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

        // Save anonymous stats (no personal data, no images)
        saveAnonymousStats({
            timestamp: new Date().toISOString(),
            age: age || null,
            gender: gender || null,
            timezone: timezone || null,
            lang: lang || null,
            region: timezoneToRegion(timezone),
            skinHsl: faceAnalysis.skinColor.hsl,
            result: {
                personalColor: diagnosis.personalColor,
                seasonGroup: diagnosis.seasonGroup,
                faceShape: diagnosis.faceShape,
                bodyType: diagnosis.bodyType || null
            }
        });

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
 * Returns aggregated anonymous demo statistics
 */
router.get('/stats', (req, res) => {
    try {
        if (!fs.existsSync(STATS_FILE)) {
            return res.json({ success: true, total: 0, stats: [] });
        }
        const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));

        // Aggregate by region and personal color
        const byRegion = {};
        const byColor = {};
        const byFaceShape = {};

        stats.forEach(s => {
            const r = s.region || 'unknown';
            byRegion[r] = (byRegion[r] || 0) + 1;
            if (s.result) {
                const pc = s.result.personalColor || 'unknown';
                byColor[pc] = (byColor[pc] || 0) + 1;
                const fs2 = s.result.faceShape || 'unknown';
                byFaceShape[fs2] = (byFaceShape[fs2] || 0) + 1;
            }
        });

        res.json({
            success: true,
            total: stats.length,
            byRegion,
            byColor,
            byFaceShape
        });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to read stats.' });
    }
});

module.exports = router;
