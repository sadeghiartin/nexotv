import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mocks before module load
vi.mock('../../src/config/env', () => ({
  default: {
    DEBUG: false,
    CACHE_ENABLED: true,
    CACHE_TTL_MS: 21600000,
    MAX_CACHE_ENTRIES: 300,
    IPTV_ORG_CACHE_TTL_MS: 21600000,
    M3U_CACHE_TTL_MS: 21600000,
    DATA_MEMORY_TTL_MS: 300000,
    UPDATE_INTERVAL_MS: 14400000,
    SQLITE_PATH: ':memory:',
  },
  repoRoot: '/tmp',
}));

const mockCacheStore = new Map<string, any>();
vi.mock('../../src/utils/sqliteCache', () => ({
  init: vi.fn(),
  get: vi.fn((key: string) => mockCacheStore.get(key) ?? null),
  set: vi.fn((key: string, val: any) => mockCacheStore.set(key, val)),
  setRaw: vi.fn(),
  getRaw: vi.fn(() => null),
  del: vi.fn((key: string) => mockCacheStore.delete(key)),
  close: vi.fn(),
}));

const { mockFetchSeriesInfo } = vi.hoisted(() => ({
  mockFetchSeriesInfo: vi.fn(),
}));

vi.mock('../../src/providers/xtreamProvider', async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    fetchData: vi.fn(),
    fetchSeriesInfo: mockFetchSeriesInfo,
  };
});

import { parseId } from '../../src/addon/idParser';
import { M3UEPGAddon } from '../../src/addon/M3UEPGAddon';

describe('Series Playback Implementation', () => {
  beforeEach(() => {
    mockCacheStore.clear();
    mockFetchSeriesInfo.mockReset();
  });

  describe('idParser', () => {
    it('parses series episode IDs correctly', () => {
      const parsed = parseId('xcprefix_s_123_e_4567');
      expect(parsed.type).toBe('episode');
      expect(parsed.idPrefix).toBe('prefix');
      expect(parsed.seriesId).toBe('123');
      expect(parsed.episodeId).toBe('4567');
    });

    it('parses series catalog IDs correctly', () => {
      const parsed = parseId('xcprefix_s_123');
      expect(parsed.type).toBe('series');
      expect(parsed.idPrefix).toBe('prefix');
      expect(parsed.seriesId).toBe('123');
    });

    it('parses movie VOD IDs correctly', () => {
      const parsed = parseId('xcprefix_m_789');
      expect(parsed.type).toBe('movie');
      expect(parsed.idPrefix).toBe('prefix');
      expect(parsed.movieId).toBe('789');
    });

    it('parses live channel IDs correctly', () => {
      const parsed = parseId('xcprefix_1234');
      expect(parsed.type).toBe('channel');
      expect(parsed.idPrefix).toBe('prefix');
      expect(parsed.channelId).toBe('1234');
    });

    it('safely handles null / non-string inputs without throwing', () => {
      expect(parseId(null as any).type).toBe('unknown');
      expect(parseId(undefined as any).type).toBe('unknown');
      expect(parseId({} as any).type).toBe('unknown');
    });

    it('returns unknown or maps channel according to parse rules for malformed test cases', () => {
      expect(parseId('xcabc_s_').type).toBe('unknown');
      expect(parseId('xcabc_s_123_e_').type).toBe('unknown');
      expect(parseId('').type).toBe('unknown');
      expect(parseId('random-string').type).toBe('unknown');

      // xcabc_bad has valid prefix "xcabc_" and is treated as channel according to parser rules
      const bad = parseId('xcabc_bad');
      expect(bad.type).toBe('channel');
      expect(bad.idPrefix).toBe('abc');
      expect(bad.channelId).toBe('bad');
    });
  });

  describe('getDetailedMeta with Series', () => {
    it('returns formatted series metadata including episodes list', async () => {
      const addon = new M3UEPGAddon({ provider: 'xtream', xtreamUrl: 'http://xtream', xtreamUsername: 'u', xtreamPassword: 'p' });
      addon.seriesMap.set(`xc${addon.idPrefix}_s_123`, { id: `xc${addon.idPrefix}_s_123`, seriesId: '123', name: 'Test Series', category: 'Action' });

      mockFetchSeriesInfo.mockResolvedValueOnce({
        info: {
          plot: 'Plot description',
          rating: '8.5',
        },
        episodes: {
          '1': [
            { id: '456', episode_num: 1, title: 'Episode 1' },
            { id: '457', episode_num: 2, title: 'Episode 2', info: { releasedate: '2026-07-02' } },
            { id: '', episode_num: 3, title: 'Invalid Episode' },
          ]
        }
      });

      const meta = await addon.getDetailedMeta(`xc${addon.idPrefix}_s_123`);
      expect(meta).not.toBeNull();
      expect(meta?.type).toBe('series');
      expect(meta?.name).toBe('Test Series');
      expect(meta?.description).toBe('Plot description');
      expect(meta?.rating).toBe(8.5);
      expect(meta?.videos).toHaveLength(2);
      expect(meta?.videos[0].id).toBe(`xc${addon.idPrefix}_s_123_e_456`);
      expect(meta?.videos[0].season).toBe(1);
      expect(meta?.videos[0].episode).toBe(1);
      expect(meta?.videos[0].title).toBe('Episode 1');
      expect(meta?.videos[1].released).toBe('2026-07-02');
    });

    it('returns formatted series metadata when episodes is a flat array with alternative fields', async () => {
      const addon = new M3UEPGAddon({ provider: 'xtream', xtreamUrl: 'http://xtream', xtreamUsername: 'u', xtreamPassword: 'p' });
      addon.seriesMap.set(`xc${addon.idPrefix}_s_123`, { id: `xc${addon.idPrefix}_s_123`, seriesId: '123', name: 'Test Series' });

      mockFetchSeriesInfo.mockResolvedValueOnce({
        info: { plot: 'Flat Array Plot' },
        episodes: [
          { episode_id: '901', season_num: 2, episodeId: '3', title: 'Flat Episode' }
        ]
      });

      const meta = await addon.getDetailedMeta(`xc${addon.idPrefix}_s_123`);
      expect(meta?.videos).toHaveLength(1);
      expect(meta?.videos[0].id).toBe(`xc${addon.idPrefix}_s_123_e_901`);
      expect(meta?.videos[0].season).toBe(2);
      expect(meta?.videos[0].episode).toBe(3);
      expect(meta?.videos[0].title).toBe('Flat Episode');
    });

    it('returns null/empty for invalid series ID', async () => {
      const addon = new M3UEPGAddon({ provider: 'xtream', xtreamUrl: 'http://xtream', xtreamUsername: 'u', xtreamPassword: 'p' });
      const meta = await addon.getDetailedMeta(`xc${addon.idPrefix}_s_invalid`);
      expect(meta).toBeNull();
    });

    it('calls fetchSeriesInfo once on cache miss, then hits cached SQLite storage on second call', async () => {
      const addon = new M3UEPGAddon({ provider: 'xtream', xtreamUrl: 'http://xtream', xtreamUsername: 'u', xtreamPassword: 'p' });
      addon.seriesMap.set(`xc${addon.idPrefix}_s_123`, { id: `xc${addon.idPrefix}_s_123`, seriesId: '123', name: 'Test Series' });

      mockFetchSeriesInfo.mockResolvedValueOnce({
        info: { plot: 'Fresh Plot' },
        episodes: {
          '1': [{ id: '456', episode_num: 1 }]
        }
      });

      // First call: cache miss, calls fetchSeriesInfo
      const meta1 = await addon.getDetailedMeta(`xc${addon.idPrefix}_s_123`);
      expect(meta1?.description).toBe('Fresh Plot');
      expect(mockFetchSeriesInfo).toHaveBeenCalledTimes(1);

      // Second call: cache hit, reads from sqliteCache, does not call fetchSeriesInfo again
      const meta2 = await addon.getDetailedMeta(`xc${addon.idPrefix}_s_123`);
      expect(meta2?.description).toBe('Fresh Plot');
      expect(mockFetchSeriesInfo).toHaveBeenCalledTimes(1);
    });
  });

  describe('getStreams with Episodes', () => {
    it('returns resolved episode playback URLs', async () => {
      const addon = new M3UEPGAddon({ provider: 'xtream', xtreamUrl: 'http://xtream', xtreamUsername: 'u', xtreamPassword: 'p' });
      addon.seriesMap.set(`xc${addon.idPrefix}_s_123`, { id: `xc${addon.idPrefix}_s_123`, seriesId: '123', name: 'Test Series' });

      const mockDetails = {
        info: { name: 'Test Series' },
        episodes: {
          '1': [{ id: '456', episode_num: 1 }]
        }
      };
      mockCacheStore.set(`addon:series_info:${addon.cacheKey}:123`, mockDetails);

      const streams = await addon.getStreams(`xc${addon.idPrefix}_s_123_e_456`);
      expect(streams).toHaveLength(1);
      expect(streams[0].url).toBe('http://xtream/series/u/p/456.mp4');
      expect(streams[0].title).toBe('Test Series - S01E01');
      expect(streams[0].behaviorHints?.notWebReady).toBe(true);
    });

    it('returns empty array for invalid episode ID', async () => {
      const addon = new M3UEPGAddon({ provider: 'xtream', xtreamUrl: 'http://xtream', xtreamUsername: 'u', xtreamPassword: 'p' });
      addon.seriesMap.set(`xc${addon.idPrefix}_s_123`, { id: `xc${addon.idPrefix}_s_123`, seriesId: '123', name: 'Test Series' });

      const mockDetails = {
        info: { name: 'Test Series' },
        episodes: {
          '1': [{ id: '456', episode_num: 1 }]
        }
      };
      mockCacheStore.set(`addon:series_info:${addon.cacheKey}:123`, mockDetails);

      const streams = await addon.getStreams(`xc${addon.idPrefix}_s_123_e_invalid`);
      expect(streams).toHaveLength(0);
    });

    it('preserves behaviorHints and proxyHeaders if seriesItem contains custom headers', async () => {
      const addon = new M3UEPGAddon({ provider: 'xtream', xtreamUrl: 'http://xtream', xtreamUsername: 'u', xtreamPassword: 'p' });
      addon.seriesMap.set(`xc${addon.idPrefix}_s_123`, {
        id: `xc${addon.idPrefix}_s_123`,
        seriesId: '123',
        name: 'Test Series',
        userAgent: 'CustomUA',
        referrer: 'CustomRef'
      });

      const mockDetails = {
        info: { name: 'Test Series' },
        episodes: {
          '1': [{ id: '456', episode_num: 1 }]
        }
      };
      mockCacheStore.set(`addon:series_info:${addon.cacheKey}:123`, mockDetails);

      const streams = await addon.getStreams(`xc${addon.idPrefix}_s_123_e_456`);
      expect(streams).toHaveLength(1);
      expect(streams[0].behaviorHints?.proxyHeaders?.request?.['User-Agent']).toBe('CustomUA');
      expect(streams[0].behaviorHints?.proxyHeaders?.request?.['Referer']).toBe('CustomRef');
    });

    it('preserves globalUserAgent in behaviorHints if seriesItem has no custom headers', async () => {
      const addon = new M3UEPGAddon({
        provider: 'xtream',
        xtreamUrl: 'http://xtream',
        xtreamUsername: 'u',
        xtreamPassword: 'p',
        globalUserAgent: 'GlobalUA'
      });
      addon.seriesMap.set(`xc${addon.idPrefix}_s_123`, {
        id: `xc${addon.idPrefix}_s_123`,
        seriesId: '123',
        name: 'Test Series'
      });

      const mockDetails = {
        info: { name: 'Test Series' },
        episodes: {
          '1': [{ id: '456', episode_num: 1 }]
        }
      };
      mockCacheStore.set(`addon:series_info:${addon.cacheKey}:123`, mockDetails);

      const streams = await addon.getStreams(`xc${addon.idPrefix}_s_123_e_456`);
      expect(streams).toHaveLength(1);
      expect(streams[0].behaviorHints?.proxyHeaders?.request?.['User-Agent']).toBe('GlobalUA');
    });
  });

  describe('xtreamProvider.resolveSeriesStream (real function)', () => {
    it('resolves stream URL with custom container extension and falls back to mp4', async () => {
      const addon = new M3UEPGAddon({ provider: 'xtream', xtreamUrl: 'http://xtream', xtreamUsername: 'u', xtreamPassword: 'p' });
      
      const mockDetails = {
        info: { name: 'Real Series' },
        episodes: {
          '1': [
            { id: '101', container_extension: 'mkv', episode_num: 1 },
            { id: '102', episode_num: 2 }
          ]
        }
      };

      mockCacheStore.set(`addon:series_info:${addon.cacheKey}:123`, mockDetails);

      const { resolveSeriesStream } = await import('../../src/providers/xtreamProvider');

      // Test with custom container_extension
      const res1 = await resolveSeriesStream(addon, '123', '101');
      expect(res1.url).toBe('http://xtream/series/u/p/101.mkv');
      expect(res1.title).toBe('Real Series - S01E01');

      // Test fallback to mp4
      const res2 = await resolveSeriesStream(addon, '123', '102');
      expect(res2.url).toBe('http://xtream/series/u/p/102.mp4');
      expect(res2.title).toBe('Real Series - S01E02');

      // Test invalid episode throws
      await expect(resolveSeriesStream(addon, '123', '999')).rejects.toThrow('Episode not found: 999');
    });

    it('reuses the same cached episode map on consecutive calls', async () => {
      const addon = new M3UEPGAddon({ provider: 'xtream', xtreamUrl: 'http://xtream', xtreamUsername: 'u', xtreamPassword: 'p' });
      
      const mockDetails = {
        info: { name: 'Real Series' },
        episodes: {
          '1': [
            { id: '101', episode_num: 1 }
          ]
        }
      };

      mockCacheStore.set(`addon:series_info:${addon.cacheKey}:123`, mockDetails);

      const { resolveSeriesStream } = await import('../../src/providers/xtreamProvider');

      const res1 = await resolveSeriesStream(addon, '123', '101');
      const res2 = await resolveSeriesStream(addon, '123', '101');
      expect(res1.url).toBe(res2.url);
      expect(res1.title).toBe(res2.title);
      // Ensures the raw mockDetails payload is not mutated or broken
      expect(mockDetails.episodes['1'][0].id).toBe('101');
    });
  });
});
