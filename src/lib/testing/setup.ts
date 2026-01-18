import { vi, beforeEach } from 'vitest';

// Hier können wir globale Mocks definieren
// z.B. window.matchMedia für UI Komponenten
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Reset Mocks vor jedem Test
beforeEach(() => {
  vi.clearAllMocks();
});