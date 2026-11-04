import { _electron as electron, expect, test } from '@playwright/test';

test('the app window opens with the PracticePlayer title', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' },
  });

  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle('PracticePlayer');
    await expect(window.getByRole('heading', { name: 'PracticePlayer' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the minimal preload API answers the example call', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' },
  });

  try {
    const window = await app.firstWindow();
    await expect(window.getByTestId('app-version')).toHaveText('PracticePlayer 0.1.0');
  } finally {
    await app.close();
  }
});
