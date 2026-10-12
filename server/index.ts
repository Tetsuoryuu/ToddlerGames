import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as path from 'node:path';
import { pantryStore } from './pantryStore.ts';
import {
  evaluateSoupRecipe,
  geminiModels,
  generateSpeechWavBase64,
  isGeminiConfigured,
  spawnIngredientFromPrompt,
  summonCharacterFromPrompt,
  transcribeToddlerAudio,
  validateAndExtractToddlerSpeech,
} from './gemini.ts';
import type { CharacterItem, IngredientItem } from '../src/types.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json({ limit: '15mb' }));

// Serve generated PNG stickers from public/pantry
app.use(
  '/pantry',
  express.static(path.resolve(process.cwd(), 'public', 'pantry'))
);

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    geminiConfigured: isGeminiConfigured(),
    models: geminiModels,
  });
});

app.get('/api/pantry', (_req, res) => {
  res.json(pantryStore.getPantry());
});

app.post('/api/validate-speech', async (req, res) => {
  try {
    const transcript = String(req.body?.transcript || '').trim();
    const rawMode = String(req.body?.mode || 'ingredient').trim();
    const mode =
      rawMode === 'player_name' || rawMode === 'character'
        ? rawMode
        : 'ingredient';
    const validation = await validateAndExtractToddlerSpeech(transcript, mode);
    res.json(validation);
  } catch (err) {
    console.error('Error in /api/validate-speech:', err);
    res.json({
      isValid: false,
      extractedValue: '',
      reason: 'Validation error',
    });
  }
});

app.post('/api/summon-character', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    const playerName = String(req.body?.playerName || '').trim();
    const character = await summonCharacterFromPrompt(prompt, playerName);
    res.json({ character, pantry: pantryStore.getPantry() });
  } catch (err) {
    console.error('Error in /api/summon-character:', err);
    res.status(500).json({ error: 'Failed to summon character' });
  }
});

app.post('/api/spawn-ingredient', async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    const characterName = String(req.body?.characterName || '').trim();
    const playerName = String(req.body?.playerName || '').trim();
    const ingredient = await spawnIngredientFromPrompt(
      prompt,
      characterName,
      playerName
    );
    res.json({ ingredient, pantry: pantryStore.getPantry() });
  } catch (err) {
    console.error('Error in /api/spawn-ingredient:', err);
    res.status(500).json({ error: 'Failed to spawn ingredient' });
  }
});

app.post('/api/evaluate-soup', async (req, res) => {
  try {
    const character = req.body?.character as CharacterItem;
    const ingredients = (req.body?.ingredients || []) as IngredientItem[];
    const playerName = String(req.body?.playerName || '').trim();
    const evaluation = await evaluateSoupRecipe(
      character,
      ingredients,
      playerName
    );
    res.json({ evaluation });
  } catch (err) {
    console.error('Error in /api/evaluate-soup:', err);
    res.status(500).json({ error: 'Failed to evaluate soup' });
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const voiceName = String(req.body?.voiceName || 'Puck').trim();
    const style = String(
      req.body?.style || 'cheerful, expressive cartoon character for a 4-year-old'
    ).trim();

    const audioBase64 = await generateSpeechWavBase64(text, voiceName, style);
    res.json({ audioBase64 });
  } catch (err) {
    console.error('Error in /api/tts:', err);
    res.json({ audioBase64: null });
  }
});

app.post('/api/transcribe', async (req, res) => {
  try {
    const audioBase64 = String(req.body?.audioBase64 || '');
    const mimeType = String(req.body?.mimeType || 'audio/webm');
    const transcript = await transcribeToddlerAudio(audioBase64, mimeType);
    res.json({ transcript });
  } catch (err) {
    console.error('Error in /api/transcribe:', err);
    res.json({ transcript: '' });
  }
});

app.listen(PORT, () => {
  console.log(
    `🧙‍♂️ Silly Chef Magic Cauldron Server running on http://localhost:${PORT} (Gemini API Key Configured: ${isGeminiConfigured()}, @google/genai v2)`
  );
});
