import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, rendererWebPreferences } from './security';

describe('main layer security baseline', () => {
  it('isolates the renderer context and disables node integration', () => {
    expect(rendererWebPreferences.contextIsolation).toBe(true);
    expect(rendererWebPreferences.nodeIntegration).toBe(false);
    expect(rendererWebPreferences.sandbox).toBe(true);
  });

  it('disables background throttling', () => {
    expect(rendererWebPreferences.backgroundThrottling).toBe(false);
  });

  it('declares a restrictive content security policy', () => {
    expect(contentSecurityPolicy).toContain("default-src 'self'");
    expect(contentSecurityPolicy).toContain("script-src 'self'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("connect-src 'self'");
  });
});
