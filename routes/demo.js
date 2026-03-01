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
All colors are provided in CIELAB (L*, a*, b*) color space:
  - L* (Lightness): 0=black, 100=white
  - a*: negative=green, positive=red. Higher a* = more redness/warmth
  - b*: negative=blue, positive=yellow. Higher b* = more yellow/warm undertone
  - Warm undertone: a*>5 and b*>15. Cool undertone: a*<5 and b*<10

- skinColor: LAB averaged from 10 facial points (cheeks, forehead L/R, nose bridge, chin)
- hairColor: LAB from hair region (Image Segmentation mask, grid-distributed sampling)
- eyeColor: LAB from iris center (if available)
- eyebrowColor: LAB from 4 darkest eyebrow landmark points (out of 8 sampled)
- lipColor: LAB averaged from 4 lip landmark points
- neckColor: LAB from 3 horizontal points below chin
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
- Spring Light: Bright warm skin (L*>65, a*>5, b*>15), light brown eyes
- Spring Bright: Very bright vivid skin (L*>60, high b*), clear bright eyes
- Spring Soft: Muted warm feel (L*>60, low a* and b*), soft calm brown eyes
- Spring Clear: Clean warm skin, vivid clear eyes, medium-high contrast

### SUMMER (Cool + Bright/Soft)
- Summer Light: Clear cool tone skin (L*>65, a*<5, b*<12), soft eyes
- Summer Bright: Cool and vivid skin (low b*, moderate a*), bright clear eyes
- Summer Mute: Warm-cool balance, deep calm eyes, low chroma (a* and b* near 0)

### AUTUMN (Warm + Deep/Muted)
- Autumn Mute: Yellow undertone (b*>15, a*<8), soft muted feel (L*55-70)
- Autumn Deep: Deep rich warm tone (L*<55, b*>15), dark brown eyes, high contrast
- Autumn Strong: Intense warmth (high a* and b*), dark strong eyes

### WINTER (Cool + Vivid/Deep)
- Winter Clear: Cool clear tone (a*<5, b*<10), vivid black eyes, very high contrast
- Winter Strong: Bright cool tone, high contrast (skinHair>120), sharp black eyes
- Winter Cool Deep: Cool deep tone (L*<50, a*<5), deep strong eyes
- Winter Soft: Soft cool tone (low a*, low b*), subtle brown-gray eyes

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

The "personalColorDetail" field MUST follow this EXACT two-part format with proper line breaks:

Section 1: "◼︎ 측정값 (Lab)" followed by line break, then each color on its own line with L*/a*/b* values separated by " / "
Section 2: After two line breaks, "◼︎ 설명" followed by line break, then professional explanation in natural language

Example personalColorDetail (Korean, adapt labels to response language):
"◼︎ 측정값 (Lab)\n- 피부: 72.5 / 8.2 / 18.3\n- 헤어: 12.3 / 1.5 / -0.8\n- 눈: 15.2 / 3.1 / 2.0\n- 눈썹: 18.5 / 2.3 / 3.1\n- 입술: 45.2 / 22.1 / 8.5\n- 목: 70.1 / 7.8 / 16.2\n- 대비: 피부↔헤어 268, 피부↔눈 262\n\n◼︎ 설명\n고객님의 피부는 밝고 따뜻한 톤(L*72.5)으로 황색기(b*18.3)와 적색기(a*8.2)가 적절히 조화된 웜 언더톤입니다. 헤어와 눈 색상이 매우 어두워 피부와의 대비가 높은 것이 특징입니다..."

IMPORTANT formatting rules:
- Each measurement line MUST end with \\n
- Between 측정값 section and 설명 section, use \\n\\n (double line break)
- Color values: just numbers separated by " / " (no L*, a*, b* labels per line — the title already says Lab)
- Apply the same structure regardless of language. Use ◼︎ as section markers.
- For "faceShapeDetail" and "bodyTypeDetail", use plain explanation text only (no measurement section).

{
  "personalColor": "Spring Light",
  "seasonGroup": "Spring",
  "personalColorDetail": "◼︎ 측정값 (Lab)\n- 피부: 72.5 / 8.2 / 18.3\n- 헤어: 12.3 / 1.5 / -0.8\n...\n\n◼︎ 설명\n...",
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

        prompt += '\n\n## Client Measurement Data (all colors in CIELAB)\n';

        const labStr = (color) => {
            if (color && color.lab) return `LAB(${color.lab.l}, ${color.lab.a}, ${color.lab.b})`;
            return `RGB(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`;
        };

        prompt += `Skin Color: ${labStr(faceAnalysis.skinColor)}\n`;
        prompt += `Hair Color: ${labStr(faceAnalysis.hairColor)}\n`;
        if (faceAnalysis.eyeColor) prompt += `Eye Color: ${labStr(faceAnalysis.eyeColor)}\n`;
        if (faceAnalysis.eyebrowColor) prompt += `Eyebrow Color: ${labStr(faceAnalysis.eyebrowColor)}\n`;
        if (faceAnalysis.lipColor) prompt += `Lip Color: ${labStr(faceAnalysis.lipColor)}\n`;
        if (faceAnalysis.neckColor) prompt += `Neck Color: ${labStr(faceAnalysis.neckColor)}\n`;
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
                skin: faceAnalysis.skinColor ? { rgb: faceAnalysis.skinColor.rgb, hsl: faceAnalysis.skinColor.hsl, lab: faceAnalysis.skinColor.lab } : undefined,
                hair: faceAnalysis.hairColor ? { rgb: faceAnalysis.hairColor.rgb, hsl: faceAnalysis.hairColor.hsl, lab: faceAnalysis.hairColor.lab } : undefined,
                eyebrow: faceAnalysis.eyebrowColor ? { rgb: faceAnalysis.eyebrowColor.rgb, hsl: faceAnalysis.eyebrowColor.hsl, lab: faceAnalysis.eyebrowColor.lab } : undefined,
                eye: faceAnalysis.eyeColor ? { rgb: faceAnalysis.eyeColor.rgb, hsl: faceAnalysis.eyeColor.hsl, lab: faceAnalysis.eyeColor.lab } : undefined,
                lip: faceAnalysis.lipColor ? { rgb: faceAnalysis.lipColor.rgb, hsl: faceAnalysis.lipColor.hsl, lab: faceAnalysis.lipColor.lab } : undefined,
                neck: faceAnalysis.neckColor ? { rgb: faceAnalysis.neckColor.rgb, hsl: faceAnalysis.neckColor.hsl, lab: faceAnalysis.neckColor.lab } : undefined,
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
