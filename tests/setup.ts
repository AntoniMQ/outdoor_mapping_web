import '@testing-library/jest-dom/vitest';
import { beforeEach, vi } from 'vitest';

process.env.APP_DATA_MODE ??= 'fixture';
process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_ENABLED = 'false';

beforeEach(() => {
  vi.restoreAllMocks();
});
