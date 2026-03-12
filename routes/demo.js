/**
 * Demo Diagnosis API — Hybrid: Internal Classifier + Gemini 3.1 Flash Lite
 * Receives pre-extracted face measurement data (from client-side MediaPipe).
 * No images are received or stored. Results saved to MongoDB.
 *
 * Flow:
 *   1. Internal classifier determines type deterministically (LAB-based rules)
 *   2. Gemini 3.1 Flash Lite writes professional description text
 *   3. Combined result returned to client
 */
const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const DemoData = require('../models/DemoData');
const { fullDiagnosis, labUtils } = require('../services/apl-color-classifier');

// ─── Gemini setup ───
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;

if (GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_API_KEY_HERE') {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    console.log('Gemini API initialized (gemini-3.1-flash-lite)');
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
        case 'ko': return 'Respond entirely in Korean (\ud55c\uad6d\uc5b4).';
        case 'ja': return 'Respond entirely in Japanese (\u65e5\u672c\u8a9e).';
        case 'zh': return 'Respond entirely in Chinese (\u4e2d\u6587).';
        default: return 'Respond in English.';
    }
}

function labStr(color) {
    if (color && color.lab) return `LAB(${color.lab.l}, ${color.lab.a}, ${color.lab.b})`;
    if (color && color.rgb) return `RGB(${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})`;
    return 'N/A';
}

// ─── Hybrid Prompt: Internal type decided, Gemini writes description only ───
function buildHybridPrompt(internalResult, faceAnalysis, bodyAnalysis, age, gender, lang) {
    const pc = internalResult.personalColor;
    const bgCorr = internalResult.backgroundCorrection;
    const face = internalResult.faceShape;
    const body = internalResult.bodyType;

    let prompt = `# APL Personal Color Diagnosis — Description Writer

You are a professional personal color consultant. Our internal classification engine has already determined the customer's diagnosis based on LAB color science.

Your job is to write professional, detailed descriptions for the diagnosis results.

## Internal Classification Results (ALREADY DETERMINED — do NOT change these)

- Personal Color Type: ${pc.type}
- Season Group: ${pc.season}
- Characteristics: Hue=${pc.characteristics.hue}, Value=${pc.characteristics.value}, Chroma=${pc.characteristics.chroma}, Contrast=${pc.characteristics.contrast}
- Confidence: ${pc.confidence}
- Alternate Types: ${pc.alternates.map(a => `${a.type} (${a.confidence})`).join(', ')}
`;

    if (face) {
        prompt += `- Face Shape: ${face.type} (confidence: ${face.confidence})\n`;
    }
    if (body) {
        prompt += `- Body Type: ${body.type} (confidence: ${body.confidence})\n`;
    }

    prompt += `\n## Measurement Data\n`;
    prompt += `Skin Color: ${labStr(faceAnalysis.skinColor)}\n`;
    prompt += `Hair Color: ${labStr(faceAnalysis.hairColor)}\n`;
    if (faceAnalysis.eyeColor) prompt += `Eye Color: ${labStr(faceAnalysis.eyeColor)}\n`;
    if (faceAnalysis.eyebrowColor) prompt += `Eyebrow Color: ${labStr(faceAnalysis.eyebrowColor)}\n`;
    if (faceAnalysis.lipColor) prompt += `Lip Color: ${labStr(faceAnalysis.lipColor)}\n`;
    if (faceAnalysis.neckColor) prompt += `Neck Color: ${labStr(faceAnalysis.neckColor)}\n`;

    if (bgCorr && bgCorr.adjustments) {
        prompt += `\nBackground Correction Applied: dL=${bgCorr.adjustments.dL}, dA=${bgCorr.adjustments.dA}, dB=${bgCorr.adjustments.dB}\n`;
        prompt += `Corrected Skin: LAB(${bgCorr.corrected.l}, ${bgCorr.corrected.a}, ${bgCorr.corrected.b})\n`;
    }

    if (faceAnalysis.contrast) {
        prompt += `\nContrast: Skin\u2194Hair=${faceAnalysis.contrast.skinHair}`;
        if (faceAnalysis.contrast.skinEye != null) prompt += `, Skin\u2194Eye=${faceAnalysis.contrast.skinEye}`;
        if (faceAnalysis.contrast.skinLip != null) prompt += `, Skin\u2194Lip=${faceAnalysis.contrast.skinLip}`;
        prompt += '\n';
    }

    if (faceAnalysis.faceProportions) {
        prompt += `\nFace Proportions: forehead=${faceAnalysis.faceProportions.foreheadRatio}, jaw=${faceAnalysis.faceProportions.jawRatio}, height=${faceAnalysis.faceProportions.heightRatio}\n`;
    }

    if (bodyAnalysis && bodyAnalysis.bodyProportions) {
        prompt += `Body: shoulderHip=${bodyAnalysis.bodyProportions.shoulderHipRatio}\n`;
    }

    if (age) prompt += `\nAge: ${age}`;
    if (gender) prompt += `\nGender: ${gender}`;

    prompt += `\n\n${getLangInstruction(lang)}

## Your Task

Write professional descriptions for the pre-determined diagnosis. Use the measurement data to back your explanations.

The "personalColorDetail" field MUST follow this EXACT format:
Section 1: "\u25fc\ufe0e \uce21\uc815\uac12 (Lab)" followed by line break, then each color on its own line with L*/a*/b* values separated by " / "
Section 2: After two line breaks, "\u25fc\ufe0e \uc124\uba85" followed by line break, then professional explanation

IMPORTANT: Respond ONLY with pure JSON. No code blocks, no markdown.

{
  "personalColorDetail": "\u25fc\ufe0e \uce21\uc815\uac12 (Lab)\\n- \ud53c\ubd80: ...\\n...\\n\\n\u25fc\ufe0e \uc124\uba85\\n...",
  "faceShapeDetail": "...",
  "bodyTypeDetail": "..." or null,
  "bestColors": ["Color1", "Color2", "Color3", "Color4", "Color5"],
  "avoidColors": ["Color1", "Color2", "Color3", "Color4"],
  "stylingTip": "A brief 1-2 sentence recommendation."
}`;

    return prompt;
}

// ─── Full Prompt: Gemini decides everything (fallback for low confidence) ───
function buildFullPrompt(faceAnalysis, bodyAnalysis, age, gender, lang) {
    let prompt = DEMO_DIAGNOSIS_PROMPT;

    prompt += '\n\n## Client Measurement Data (all colors in CIELAB)\n';

    prompt += `Skin Color: ${labStr(faceAnalysis.skinColor)}\n`;
    prompt += `Hair Color: ${labStr(faceAnalysis.hairColor)}\n`;
    if (faceAnalysis.eyeColor) prompt += `Eye Color: ${labStr(faceAnalysis.eyeColor)}\n`;
    if (faceAnalysis.eyebrowColor) prompt += `Eyebrow Color: ${labStr(faceAnalysis.eyebrowColor)}\n`;
    if (faceAnalysis.lipColor) prompt += `Lip Color: ${labStr(faceAnalysis.lipColor)}\n`;
    if (faceAnalysis.neckColor) prompt += `Neck Color: ${labStr(faceAnalysis.neckColor)}\n`;
    if (faceAnalysis.backgroundColor && faceAnalysis.backgroundColor.rgb) {
        prompt += `Background: RGB(${faceAnalysis.backgroundColor.rgb.r}, ${faceAnalysis.backgroundColor.rgb.g}, ${faceAnalysis.backgroundColor.rgb.b})\n`;
    }

    prompt += `\nFace Proportions (normalized to cheekbone width = 1.0):\n`;
    prompt += `- Forehead ratio: ${faceAnalysis.faceProportions.foreheadRatio}\n`;
    prompt += `- Jaw ratio: ${faceAnalysis.faceProportions.jawRatio}\n`;
    prompt += `- Height ratio: ${faceAnalysis.faceProportions.heightRatio}\n`;

    if (faceAnalysis.contrast) {
        prompt += `\nContrast (Euclidean RGB distance):\n`;
        prompt += `- Skin \u2194 Hair: ${faceAnalysis.contrast.skinHair}\n`;
        if (faceAnalysis.contrast.skinEye != null) prompt += `- Skin \u2194 Eye: ${faceAnalysis.contrast.skinEye}\n`;
        if (faceAnalysis.contrast.skinLip != null) prompt += `- Skin \u2194 Lip: ${faceAnalysis.contrast.skinLip}\n`;
        if (faceAnalysis.contrast.skinNeck != null) prompt += `- Skin \u2194 Neck: ${faceAnalysis.contrast.skinNeck}\n`;
    }

    if (bodyAnalysis && bodyAnalysis.bodyProportions) {
        prompt += `\nBody Proportions:\n`;
        prompt += `- Shoulder/Hip ratio: ${bodyAnalysis.bodyProportions.shoulderHipRatio}\n`;
    } else {
        prompt += '\n\nNo body measurement data provided. Set bodyType and bodyTypeDetail to null.\n';
    }

    if (age) prompt += `\nCustomer age: ${age}`;
    if (gender) prompt += `\nCustomer gender: ${gender}`;

    prompt += `\n\n${getLangInstruction(lang)}`;
    prompt += '\nBased on the precise measurements above, provide your professional diagnosis. Respond with JSON only.';

    return prompt;
}

// ─── Diagnosis prompt (kept as fallback for low-confidence cases) ───
const DEMO_DIAGNOSIS_PROMPT = `
# APL Personal Color Demo Diagnosis (Data-Based)

You are a professional personal color consultant with expertise backed by 12,000+ real consultation records.

You will receive PRECISE MEASUREMENT DATA extracted from a client's photo using Google MediaPipe Face Landmarker (478 landmarks), Image Segmenter, and Canvas pixel analysis. No photo is provided \u2014 diagnose purely from the measured values.

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
  - skinHair: skin \u2194 hair contrast
  - skinEye: skin \u2194 eye contrast
  - skinLip: skin \u2194 lip contrast (higher = more vivid lips relative to skin)
  - skinNeck: skin \u2194 neck contrast (should be low; high value suggests lighting inconsistency)
- bodyProportions (if available):
  - shoulderHipRatio: shoulder width / hip width

## Personal Color \u2014 14 Season Types

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
- Winter Deep: Cool deep tone (L*<50, a*<5), deep strong eyes
- Winter Soft: Soft cool tone (low a*, low b*), subtle brown-gray eyes

## Face Shape \u2014 7 Types (use faceProportions)
1. Oval: heightRatio 1.3-1.5, foreheadRatio ~0.85-0.95, jawRatio ~0.75-0.85
2. Round: heightRatio <1.3, foreheadRatio ~0.9, jawRatio ~0.85-0.95
3. Square: heightRatio 1.2-1.4, jawRatio >0.9 (wide jaw)
4. Oblong: heightRatio >1.5
5. Heart: foreheadRatio >0.95, jawRatio <0.7
6. Diamond: foreheadRatio <0.8, jawRatio <0.8 (widest at cheekbones)
7. Inverted Triangle: foreheadRatio >1.0, jawRatio <0.75

## Body Type \u2014 5 Types (use bodyProportions)
1. Straight: shoulderHipRatio >1.1
2. Wave: shoulderHipRatio <0.95
3. Natural: shoulderHipRatio 0.95-1.1 (balanced, angular)
4. Apple: shoulderHipRatio >1.0 (upper body dominant)
5. Hourglass: shoulderHipRatio 0.95-1.05 (balanced)

## Response Format (JSON)

**IMPORTANT: Respond ONLY with pure JSON. No code blocks, no markdown.**

The "personalColorDetail" field MUST follow this EXACT two-part format with proper line breaks:

Section 1: "\u25fc\ufe0e \uce21\uc815\uac12 (Lab)" followed by line break, then each color on its own line with L*/a*/b* values separated by " / "
Section 2: After two line breaks, "\u25fc\ufe0e \uc124\uba85" followed by line break, then professional explanation in natural language

IMPORTANT formatting rules:
- Each measurement line MUST end with \\n
- Between \uce21\uc815\uac12 section and \uc124\uba85 section, use \\n\\n (double line break)
- Color values: just numbers separated by " / " (no L*, a*, b* labels per line)
- Apply the same structure regardless of language. Use \u25fc\ufe0e as section markers.
- For "faceShapeDetail" and "bodyTypeDetail", use plain explanation text only.

{
  "personalColor": "Spring Light",
  "seasonGroup": "Spring",
  "personalColorDetail": "\u25fc\ufe0e \uce21\uc815\uac12 (Lab)\\n- \ud53c\ubd80: 72.5 / 8.2 / 18.3\\n...\\n\\n\u25fc\ufe0e \uc124\uba85\\n...",
  "personalColorCharacteristics": {
    "hue": "Warm",
    "value": "High",
    "chroma": "Medium",
    "contrast": "Low"
  },
  "faceShape": "Oval",
  "faceShapeDetail": "...",
  "bodyType": "Wave",
  "bodyTypeDetail": "...",
  "bestColors": ["Peach", "Coral", "Ivory", "Light Beige", "Soft Yellow"],
  "avoidColors": ["Black", "Cool Gray", "Neon", "Dark Brown"],
  "stylingTip": "A brief 1-2 sentence styling recommendation."
}

If no body measurement data is provided, set bodyType and bodyTypeDetail to null.
Reference the actual measured values in your explanations to show data-backed reasoning.
`;

/**
 * POST /api/demo/diagnose
 * Hybrid: Internal classifier + Gemini 3.1 Flash Lite description
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

        console.log(`Demo diagnosis from ${clientIP} (hybrid mode, age: ${age || 'N/A'}, gender: ${gender || 'N/A'}, lang: ${lang || 'N/A'})`);

        // ──────────────────────────────────────────────
        // STEP 1: Internal classifier (deterministic)
        // ──────────────────────────────────────────────
        const classifierInput = {
            skinColor: faceAnalysis.skinColor || null,
            hairColor: faceAnalysis.hairColor || null,
            eyeColor: faceAnalysis.eyeColor || null,
            eyebrowColor: faceAnalysis.eyebrowColor || null,
            contrast: faceAnalysis.contrast || null,
            backgroundColor: faceAnalysis.backgroundColor || null,
            neckColor: faceAnalysis.neckColor || null,
            faceProportions: faceAnalysis.faceProportions || null,
            bodyProportions: bodyAnalysis ? bodyAnalysis.bodyProportions : null
        };

        // Convert background RGB to LAB if only RGB is available
        if (classifierInput.backgroundColor && !classifierInput.backgroundColor.lab && classifierInput.backgroundColor.rgb) {
            const { r, g, b } = classifierInput.backgroundColor.rgb;
            classifierInput.backgroundColor = { lab: labUtils.rgbToLab(r, g, b), rgb: classifierInput.backgroundColor.rgb };
        }

        let internalResult = null;
        try {
            internalResult = fullDiagnosis(classifierInput);
            console.log(`Internal classifier: ${internalResult.personalColor.type} (confidence: ${internalResult.personalColor.confidence}), strategy: ${internalResult.strategy}`);
        } catch (classifyError) {
            console.warn('Internal classifier failed, falling back to Gemini-only:', classifyError.message);
        }

        // ──────────────────────────────────────────────
        // STEP 2: Gemini 3.1 Flash Lite (description writer)
        // ──────────────────────────────────────────────
        let prompt;
        const useInternalType = internalResult && internalResult.strategy !== 'gemini';

        if (useInternalType) {
            prompt = buildHybridPrompt(internalResult, faceAnalysis, bodyAnalysis, age, gender, lang);
        } else {
            prompt = buildFullPrompt(faceAnalysis, bodyAnalysis, age, gender, lang);
        }

        const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
        const result = await model.generateContent(prompt);
        const rawResponse = result.response.text();
        console.log(`Gemini response: ${rawResponse.length} chars (mode: ${useInternalType ? 'hybrid' : 'full'})`);

        // Parse JSON
        let geminiDiagnosis;
        try {
            geminiDiagnosis = JSON.parse(rawResponse);
        } catch (parseError) {
            let jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/);
            if (!jsonMatch) jsonMatch = rawResponse.match(/```\s*([\s\S]*?)\s*```/);
            if (!jsonMatch) jsonMatch = rawResponse.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                const jsonString = jsonMatch[1] || jsonMatch[0];
                try {
                    geminiDiagnosis = JSON.parse(jsonString);
                } catch (e) {
                    throw new Error(`JSON parse failed: ${parseError.message}`);
                }
            } else {
                throw new Error(`JSON parse failed: ${parseError.message}`);
            }
        }

        // ──────────────────────────────────────────────
        // STEP 3: Merge internal + Gemini results
        // ──────────────────────────────────────────────
        const diagnosis = {};

        if (useInternalType) {
            diagnosis.personalColor = internalResult.personalColor.type;
            diagnosis.seasonGroup = internalResult.personalColor.season;
            diagnosis.personalColorCharacteristics = internalResult.personalColor.characteristics;
            diagnosis.faceShape = internalResult.faceShape ? internalResult.faceShape.type : geminiDiagnosis.faceShape;
            diagnosis.bodyType = internalResult.bodyType ? internalResult.bodyType.type : (geminiDiagnosis.bodyType || null);
        } else {
            diagnosis.personalColor = geminiDiagnosis.personalColor;
            diagnosis.seasonGroup = geminiDiagnosis.seasonGroup;
            diagnosis.personalColorCharacteristics = geminiDiagnosis.personalColorCharacteristics;
            diagnosis.faceShape = geminiDiagnosis.faceShape;
            diagnosis.bodyType = geminiDiagnosis.bodyType || null;
        }

        // Description text always from Gemini
        diagnosis.personalColorDetail = geminiDiagnosis.personalColorDetail;
        diagnosis.faceShapeDetail = geminiDiagnosis.faceShapeDetail;
        diagnosis.bodyTypeDetail = geminiDiagnosis.bodyTypeDetail || null;
        diagnosis.bestColors = geminiDiagnosis.bestColors;
        diagnosis.avoidColors = geminiDiagnosis.avoidColors;
        diagnosis.stylingTip = geminiDiagnosis.stylingTip;

        console.log(`Demo result: ${diagnosis.personalColor}, ${diagnosis.faceShape}${diagnosis.bodyType ? ', ' + diagnosis.bodyType : ''} (${useInternalType ? 'internal' : 'gemini'})`);

        // Send response
        res.json({
            success: true,
            diagnosis: {
                personalColor: diagnosis.personalColor,
                seasonGroup: diagnosis.seasonGroup,
                personalColorDetail: diagnosis.personalColorDetail,
                personalColorCharacteristics: diagnosis.personalColorCharacteristics,
                faceShape: diagnosis.faceShape,
                faceShapeDetail: diagnosis.faceShapeDetail,
                bodyType: diagnosis.bodyType,
                bodyTypeDetail: diagnosis.bodyTypeDetail,
                bestColors: diagnosis.bestColors,
                avoidColors: diagnosis.avoidColors,
                stylingTip: diagnosis.stylingTip
            },
            isDemo: true,
            classificationSource: useInternalType ? 'internal' : 'gemini',
            confidence: internalResult ? internalResult.confidence.overall : null
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
                bodyType: diagnosis.bodyType,
                bodyTypeDetail: diagnosis.bodyTypeDetail,
                bestColors: diagnosis.bestColors,
                avoidColors: diagnosis.avoidColors,
                stylingTip: diagnosis.stylingTip
            },
            internalClassification: internalResult ? {
                personalColor: internalResult.personalColor,
                faceShape: internalResult.faceShape,
                bodyType: internalResult.bodyType,
                backgroundCorrection: internalResult.backgroundCorrection,
                confidence: internalResult.confidence,
                strategy: internalResult.strategy
            } : null,
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
 * POST /api/demo/classify
 * Internal classification only (no Gemini) — lightweight, fast, for testing
 */
router.post('/classify', (req, res) => {
    try {
        const { faceAnalysis, bodyAnalysis } = req.body;

        if (!faceAnalysis || !faceAnalysis.skinColor || !faceAnalysis.skinColor.lab) {
            return res.status(400).json({ success: false, message: 'faceAnalysis.skinColor.lab is required.' });
        }

        const classifierInput = {
            skinColor: faceAnalysis.skinColor || null,
            hairColor: faceAnalysis.hairColor || null,
            eyeColor: faceAnalysis.eyeColor || null,
            eyebrowColor: faceAnalysis.eyebrowColor || null,
            contrast: faceAnalysis.contrast || null,
            backgroundColor: faceAnalysis.backgroundColor || null,
            neckColor: faceAnalysis.neckColor || null,
            faceProportions: faceAnalysis.faceProportions || null,
            bodyProportions: bodyAnalysis ? bodyAnalysis.bodyProportions : null
        };

        // Convert background RGB to LAB if needed
        if (classifierInput.backgroundColor && !classifierInput.backgroundColor.lab && classifierInput.backgroundColor.rgb) {
            const { r, g, b } = classifierInput.backgroundColor.rgb;
            classifierInput.backgroundColor = { lab: labUtils.rgbToLab(r, g, b), rgb: classifierInput.backgroundColor.rgb };
        }

        const result = fullDiagnosis(classifierInput);

        res.json({ success: true, result });
    } catch (error) {
        console.error('Classify error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/demo/status
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        available: !!genAI,
        model: 'gemini-3.1-flash-lite',
        mode: 'hybrid'
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
