// Runs the real app with a throwaway userData folder (set before main.js reads it).
import { DIST } from './_env.mjs';
import { app } from 'electron';
app.setPath('userData', process.env.FM_USERDATA);
await import(DIST + 'main.js');
