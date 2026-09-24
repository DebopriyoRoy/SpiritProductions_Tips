import { SquareProvider } from './types';
import { SquareClient } from './client';
import { DemoProvider } from './demo';

/**
 * One token covers both locations, so there is a single provider and the
 * location is always passed in as a filter.
 */
export function getProvider(): SquareProvider {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  return token ? new SquareClient(token) : new DemoProvider();
}

export * from './types';
