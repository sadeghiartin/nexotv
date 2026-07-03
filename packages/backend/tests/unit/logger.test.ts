import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock env before importing logger
vi.mock('../../src/config/env', () => ({
  default: { DEBUG: false },
}));

import { makeLogger } from '../../src/utils/logger';

describe('makeLogger()', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefixes output with an ISO timestamp', () => {
    const log = makeLogger();
    log.info('hello');
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  });

  it('includes [INFO] level tag', () => {
    const log = makeLogger();
    log.info('hello');
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('[INFO]');
  });

  it('includes [COMPONENT] prefix when component is provided', () => {
    const log = makeLogger('EPG');
    log.info('parsing');
    const output = logSpy.mock.calls[0][0] as string;
    expect(output).toContain('[EPG]');
  });

  it('does not include a component tag when none is provided', () => {
    const log = makeLogger();
    log.info('hello');
    const output = logSpy.mock.calls[0][0] as string;
    const bracketGroups = (output.match(/\[[^\]]+\]/g) || []);
    expect(bracketGroups).toHaveLength(1); // only [INFO]
  });

  it('component tag appears after level tag', () => {
    const log = makeLogger('METRICS');
    log.warn('threshold');
    const output = warnSpy.mock.calls[0][0] as string;
    expect(output.indexOf('[WARN]')).toBeLessThan(output.indexOf('[METRICS]'));
  });

  it('debug is suppressed when DEBUG is false', () => {
    const log = makeLogger();
    log.debug('secret');
    expect(logSpy).not.toHaveBeenCalled();
  });

  describe('redactSensitive()', () => {
    it('redacts query parameter credentials in strings', () => {
      const log = makeLogger();
      log.info('Fetching https://provider.com/xmltv.php?username=myuser&password=mypassword&type=m3u');
      const output = logSpy.mock.calls[0][1] as string;
      expect(output).toBe('Fetching https://provider.com/xmltv.php?username=[REDACTED]&password=[REDACTED]&type=m3u');
    });

    it('redacts path credentials in series/movie stream URLs', () => {
      const log = makeLogger();
      log.info('Stream url is http://server:8080/series/myuser/mypassword/101.mkv');
      const output = logSpy.mock.calls[0][1] as string;
      expect(output).toBe('Stream url is http://server:8080/series/[REDACTED]/[REDACTED]/101.mkv');
    });

    it('recursively redacts credentials inside objects and arrays', () => {
      const log = makeLogger();
      log.info({
        url: 'http://server:8080/movie/myuser/mypassword/555.mp4',
        nested: {
          username: 'myuser',
          secretKey: 'mykey',
          cleanField: 'clean'
        },
        items: ['http://xmltv.php?password=123']
      });
      const obj = logSpy.mock.calls[0][1] as any;
      expect(obj.url).toBe('http://server:8080/movie/[REDACTED]/[REDACTED]/555.mp4');
      expect(obj.nested.username).toBe('[REDACTED]');
      expect(obj.nested.secretKey).toBe('[REDACTED]');
      expect(obj.nested.cleanField).toBe('clean');
      expect(obj.items[0]).toBe('http://xmltv.php?password=[REDACTED]');
    });
  });
});
