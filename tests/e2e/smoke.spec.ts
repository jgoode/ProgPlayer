import { _electron as electron, expect, test } from '@playwright/test';

import type { ElectronApplication, Page } from '@playwright/test';

/** Launches the built app. */
async function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NODE_ENV: 'production' },
  });
}

/** Waits for the app to report its version. */
async function waitForReady(window: Page): Promise<void> {
  await expect(window.getByTestId('app-version')).toHaveText('PracticePlayer 0.1.0');
}

test('the app window opens with the PracticePlayer title', async () => {
  const app = await launch();

  try {
    const window = await app.firstWindow();
    await expect(window).toHaveTitle('PracticePlayer');
    await expect(window.getByRole('heading', { name: 'PracticePlayer' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the minimal preload API answers the example call', async () => {
  const app = await launch();

  try {
    const window = await app.firstWindow();
    await waitForReady(window);
  } finally {
    await app.close();
  }
});

test('the minimal UI offers the key, scale, tempo and preset controls', async () => {
  const app = await launch();

  try {
    const window = await app.firstWindow();
    await waitForReady(window);

    await expect(window.getByLabel('Key')).toBeVisible();
    await expect(window.getByLabel('Scale')).toBeVisible();
    await expect(window.getByLabel('Tempo')).toBeVisible();
    await expect(window.getByLabel('Preset')).toBeVisible();
    await expect(window.getByRole('button', { name: 'Play' })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(window.getByTestId('playback-position')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the bundled preset library loads', async () => {
  const app = await launch();

  try {
    const window = await app.firstWindow();
    await waitForReady(window);

    const preset = window.getByLabel('Preset');
    await expect(preset.locator('option')).not.toHaveCount(0);
    await expect(preset.locator('option').first()).toHaveAttribute('value', 'r1');
  } finally {
    await app.close();
  }
});

test('the app makes no network request outside the bundled assets', async () => {
  const app = await launch();

  try {
    const window = await app.firstWindow();
    await waitForReady(window);

    const external: string[] = [];
    window.on('request', (request) => {
      const url = request.url();
      if (
        !url.startsWith('file://') &&
        !url.startsWith('app-asset://') &&
        !url.startsWith('devtools://')
      ) {
        external.push(url);
      }
    });

    await window.getByLabel('Tempo').fill('100');
    await window.waitForTimeout(500);

    expect(external).toEqual([]);
  } finally {
    await app.close();
  }
});

test('the playback starts, the position advances and the stop button works', async () => {
  const app = await launch();

  try {
    const window = await app.firstWindow();
    await waitForReady(window);

    const errors: string[] = [];
    window.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });

    await window.getByRole('button', { name: 'Play' }).click();

    // The playback must start: the status changes and the stop button
    // becomes usable.
    await expect(window.getByTestId('playback-status')).toHaveText('Playing', { timeout: 30_000 });
    await expect(window.getByRole('button', { name: 'Stop' })).toBeEnabled();

    // The position readout must advance past the count-in.
    await expect(window.getByTestId('playback-position')).not.toHaveText('Count-in', {
      timeout: 30_000,
    });

    // The scheduler must be scheduling events.
    await expect(window.getByTestId('playback-metrics')).not.toContainText('Scheduled 0,', {
      timeout: 30_000,
    });

    await window.getByRole('button', { name: 'Stop' }).click();
    await expect(window.getByTestId('playback-status')).toHaveText('Stopped');

    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
