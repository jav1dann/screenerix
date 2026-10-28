/**
 * Imported first by the offline test harnesses: server modules read SX_DATA_DIR when they load,
 * so it must point at a throwaway directory before any of them is imported (never `.data/`).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SX_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'sx-test-'));
