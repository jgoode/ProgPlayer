import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';

describe('renderer layer', () => {
  it('shows the PracticePlayer heading', () => {
    vi.stubGlobal('window', { ...window, practicePlayer: undefined });

    render(<App />);

    expect(screen.getByRole('heading', { name: 'PracticePlayer' })).toBeInTheDocument();
  });
});
