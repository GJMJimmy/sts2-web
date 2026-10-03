import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('mobile rendering at startup', () => {
  it.each([
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5, true],
    ['iPad', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', 'iPad', 5, true],
    ['iPad desktop mode', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 5, true],
    ['Android phone', 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile', 'Linux armv8l', 5, true],
    ['Android tablet', 'Mozilla/5.0 (Linux; Android 15; Pixel Tablet)', 'Linux armv8l', 5, true],
    ['Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 'MacIntel', 0, false],
    ['Windows touch laptop', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 10, false],
    ['Linux desktop', 'Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64', 0, false],
  ])('%s chooses the expected resolution cap', async (_name, userAgent, platform, maxTouchPoints, mobile) => {
    vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints });
    vi.stubGlobal('window', { devicePixelRatio: 3 });
    const { mobileRendering, renderResolution } = await import('../../app/src/render/quality');
    expect(mobileRendering).toBe(mobile);
    expect(renderResolution()).toBe(mobile ? 1 : 2);
    // A cap must not upscale displays already below it.
    window.devicePixelRatio = 0.75;
    expect(renderResolution()).toBe(0.75);
  });
});
