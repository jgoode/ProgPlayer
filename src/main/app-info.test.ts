import { describe, expect, it } from 'vitest';

import packageJson from '../../package.json';

describe('app info', () => {
  it('reports the product name and manifest version', () => {
    expect(packageJson.productName).toBe('PracticePlayer');
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
