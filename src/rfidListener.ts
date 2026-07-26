/**
 * RFID Global Key Listener
 *
 * Runs as a background process alongside the Express server.
 * Captures keystrokes from a USB RFID Keyboard Emulator reader.
 * When a card is tapped, the reader types the serial number + Enter.
 * This listener accumulates keystrokes and dispatches them to handleRfidCheckIn.
 *
 * Usage:
 *   npm run rfid:listen          (standalone)
 *   npm run dev:full             (server + listener together)
 */

import { handleRfidCheckIn } from './controllers/checkin.controller';

// ─── Dynamic import for node-global-key-listener (ESM/CJS compat) ───
let GlobalKeyboardListener: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  GlobalKeyboardListener = require('node-global-key-listener').GlobalKeyboardListener;
} catch {
  console.error('[RFID] node-global-key-listener is not installed. Run: npm install node-global-key-listener');
  process.exit(1);
}

// ─── Configuration ───
const BUFFER_TIMEOUT_MS = 2000;   // reset buffer if no keypress for 2s
const MAX_BUFFER_LENGTH = 32;     // safety cap to prevent infinite accumulation
const OPERATOR_NAME = 'RFID Reader'; // identifier for hardware-initiated check-ins

// ─── State ───
let keyBuffer = '';
let bufferTimer: ReturnType<typeof setTimeout> | null = null;

function resetBuffer(): void {
  keyBuffer = '';
  if (bufferTimer) {
    clearTimeout(bufferTimer);
    bufferTimer = null;
  }
}

function scheduleBufferReset(): void {
  if (bufferTimer) clearTimeout(bufferTimer);
  bufferTimer = setTimeout(() => {
    if (keyBuffer.length > 0) {
      console.log(`[RFID] Buffer timeout, discarding: "${keyBuffer}"`);
      resetBuffer();
    }
  }, BUFFER_TIMEOUT_MS);
}

async function processCard(rawSerial: string): Promise<void> {
  const serial = rawSerial.trim();

  if (serial.length === 0) return;

  console.log(`[RFID] Card detected: "${serial}"`);
  console.log(`[RFID] Processing check-in...`);

  try {
    const result = await handleRfidCheckIn(serial, OPERATOR_NAME);

    if (result.success) {
      console.log(`[RFID] ✓ ${result.message}`);
      console.log(`[RFID]   Participant : ${result.participant?.name} (${result.participant?.id})`);
      console.log(`[RFID]   Group       : ${result.participant?.group}`);
      console.log(`[RFID]   Time        : ${result.participant?.checkInTime}`);
    } else {
      console.log(`[RFID] ✗ ${result.message}`);
    }
  } catch (error: any) {
    console.error(`[RFID] Error processing card "${serial}":`, error.message);
  }

  console.log('[RFID] Waiting for next card...\n');
}

// ─── Main ───
export function startRfidListener(): void {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  RFID Desktop Reader — Global Key Listener  ║');
  console.log('║  Keyboard Emulator Mode                     ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('[RFID] Waiting for card... Tap your RFID card on the reader.\n');

  const listener = new GlobalKeyboardListener();

  listener.addListener((event: any) => {
    // Only process key-down events
    if (event.state !== 'DOWN') return;

    const key = event.name;

    // ─── Enter: process accumulated buffer ───
    if (key === 'Return' || key === 'Enter') {
      if (keyBuffer.length > 0) {
        processCard(keyBuffer);
        resetBuffer();
      }
      return;
    }

    // ─── Escape: manually reset buffer ───
    if (key === 'Escape') {
      if (keyBuffer.length > 0) {
        console.log(`[RFID] Buffer reset (Escape). Discarding: "${keyBuffer}"`);
        resetBuffer();
      }
      return;
    }

    // ─── Backspace: remove last char ───
    if (key === 'Backspace') {
      keyBuffer = keyBuffer.slice(0, -1);
      scheduleBufferReset();
      return;
    }

    // ─── Ignore non-printable / modifier keys ───
    const modifierKeys = [
      'LEFT CTRL', 'RIGHT CTRL', 'LEFT ALT', 'RIGHT ALT',
      'LEFT SHIFT', 'RIGHT SHIFT', 'LEFT META', 'RIGHT META',
      'CAPS LOCK', 'TAB', 'SPACE', 'DELETE', 'INSERT',
      'HOME', 'END', 'PAGE UP', 'PAGE DOWN',
      'UP ARROW', 'DOWN ARROW', 'LEFT ARROW', 'RIGHT ARROW',
      'NUM LOCK', 'PRINT SCREEN', 'SCROLL LOCK', 'PAUSE',
    ];
    if (modifierKeys.includes(key)) return;

    // ─── Map key name to character ───
    let char = key;

    // Digits
    if (key.startsWith('NUM ')) {
      char = key.replace('NUM ', '');
    }

    // Letters (GlobalKeyboardListener returns "A", "B", etc.)
    if (/^[A-Z]$/.test(char)) {
      char = char.toLowerCase();
    }

    // Only accumulate printable characters
    if (/^[a-zA-Z0-9]$/.test(char)) {
      if (keyBuffer.length < MAX_BUFFER_LENGTH) {
        keyBuffer += char;
        scheduleBufferReset();
      }
    }
  });
}
