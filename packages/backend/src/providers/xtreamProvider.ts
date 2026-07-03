import { parseEPG } from '../parsers/epgParser';
import { validatePublicUrl } from '../utils/validateUrl';
import env from '../config/env';

async function withTimeout(url: string, options: any, ms: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchData(addonInstance: any) {
    const { config } = addonInstance;
    const {
        xtreamUrl,
        xtreamUsername,
        xtreamPassword
    } = config;

    if (!xtreamUrl || !xtreamUsername || !xtreamPassword) {
        throw new Error('Xtream credentials incomplete');
    }

    await validatePublicUrl(xtreamUrl);
    const base = `${xtreamUrl}/player_api.php?username=${encodeURIComponent(xtreamUsername)}&password=${encodeURIComponent(xtreamPassword)}`;

    const liveHeaders: Record<string, string> = {};
    if (addonInstance.xtreamEtag) liveHeaders['If-None-Match'] = addonInstance.xtreamEtag;

    const [liveResp, liveCatsResp, vodResp, vodCatsResp, seriesResp, seriesCatsResp] = await Promise.all([
        withTimeout(`${base}&action=get_live_streams`, { headers: liveHeaders }, env.FETCH_TIMEOUT_MS),
        withTimeout(`${base}&action=get_live_categories`, {}, env.FETCH_TIMEOUT_MS).catch(() => null),
        withTimeout(`${base}&action=get_vod_streams`, {}, env.FETCH_TIMEOUT_MS).catch(() => null),
        withTimeout(`${base}&action=get_vod_categories`, {}, env.FETCH_TIMEOUT_MS).catch(() => null),
        withTimeout(`${base}&action=get_series`, {}, env.FETCH_TIMEOUT_MS).catch(() => null),
        withTimeout(`${base}&action=get_series_categories`, {}, env.FETCH_TIMEOUT_MS).catch(() => null)
    ]);

    if (liveResp.status === 304) {
        addonInstance.log?.debug('Xtream 304 Not Modified — skipping update');
        return;
    }
    if (!liveResp.ok) throw new Error('Xtream live streams fetch failed');

    addonInstance.xtreamEtag = liveResp.headers.get('etag') ?? null;

    addonInstance.channels = [];
    addonInstance.movies = [];
    addonInstance.movieMap = new Map();
    addonInstance.series = [];
    addonInstance.seriesMap = new Map();
    addonInstance.epgData = {};

    const live = await liveResp.json();

    let liveCatMap: Record<string, string> = {};
    try {
        if (liveCatsResp && liveCatsResp.ok) {
            const arr = await liveCatsResp.json();
            if (Array.isArray(arr)) {
                for (const c of arr) {
                    if (c && c.category_id && c.category_name)
                        liveCatMap[c.category_id] = c.category_name;
                }
            }
        }
    } catch { /* ignore */ }

    addonInstance.channels = (Array.isArray(live) ? live : []).map((s: any) => {
        const cat = liveCatMap[s.category_id] || s.category_name || s.category_id || 'Live';
        return {
            id: `xc${addonInstance.idPrefix}_${s.stream_id}`,
            name: s.name,
            type: 'tv',
            url: `${xtreamUrl}/live/${xtreamUsername}/${xtreamPassword}/${s.stream_id}.m3u8`,
            logo: s.stream_icon,
            category: cat,
            epg_channel_id: s.epg_channel_id,
            attributes: {
                'tvg-logo': s.stream_icon,
                'tvg-id': s.epg_channel_id,
                'group-title': cat
            }
        };
    });

    let vodCatMap: Record<string, string> = {};
    try {
        if (vodCatsResp && vodCatsResp.ok) {
            const arr = await vodCatsResp.json();
            if (Array.isArray(arr)) {
                for (const c of arr) {
                    if (c && c.category_id && c.category_name)
                        vodCatMap[c.category_id] = c.category_name;
                }
            }
        }
    } catch { /* ignore */ }

    let vod: any[] = [];
    try {
        if (vodResp && vodResp.ok) {
            const parsed = await vodResp.json();
            vod = Array.isArray(parsed) ? parsed : [];
        }
    } catch { /* ignore */ }

    addonInstance.movies = vod.map((s: any) => {
        const cat = vodCatMap[s.category_id] || s.category_name || s.category_id || 'Movie';
        const ext = s.container_extension || 'mp4';
        return {
            id: `xc${addonInstance.idPrefix}_m_${s.stream_id}`,
            name: s.name,
            type: 'movie',
            url: `${xtreamUrl}/movie/${xtreamUsername}/${xtreamPassword}/${s.stream_id}.${ext}`,
            logo: s.stream_icon,
            category: cat,
            attributes: {
                'tvg-logo': s.stream_icon,
                'group-title': cat
            }
        };
    });

    addonInstance.movieMap = new Map(addonInstance.movies.map((m: any) => [m.id, m]));

    let seriesCatMap: Record<string, string> = {};
    try {
        if (seriesCatsResp && seriesCatsResp.ok) {
            const arr = await seriesCatsResp.json();
            if (Array.isArray(arr)) {
                for (const c of arr) {
                    if (c && c.category_id && c.category_name)
                        seriesCatMap[c.category_id] = c.category_name;
                }
            }
        }
    } catch { /* ignore */ }

    let seriesData: any[] = [];
    try {
        if (seriesResp && seriesResp.ok) {
            const parsed = await seriesResp.json();
            seriesData = Array.isArray(parsed) ? parsed : [];
        }
    } catch { /* ignore */ }

    addonInstance.series = seriesData.map((s: any) => {
        const cat = seriesCatMap[s.category_id] || s.category_name || s.category_id || 'Series';
        return {
            id: `xc${addonInstance.idPrefix}_s_${s.series_id}`,
            seriesId: s.series_id,
            name: s.name,
            type: 'series',
            logo: s.cover,
            category: cat,
            attributes: {
                'tvg-logo': s.cover,
                'group-title': cat
            }
        };
    });

    addonInstance.seriesMap = new Map(addonInstance.series.map((s: any) => [s.id, s]));

    if (config.enableEpg) {
        const customEpgUrl = config.epgUrl && typeof config.epgUrl === 'string' && config.epgUrl.trim() ? config.epgUrl.trim() : null;
        const epgSource = customEpgUrl
            ? customEpgUrl
            : `${xtreamUrl}/xmltv.php?username=${encodeURIComponent(xtreamUsername)}&password=${encodeURIComponent(xtreamPassword)}`;

        const now = Date.now();
        const epgStale = !addonInstance.lastEpgUpdate ||
            (now - addonInstance.lastEpgUpdate > env.EPG_UPDATE_INTERVAL_MS);

        if (epgStale) {
            try {
                if (customEpgUrl) await validatePublicUrl(epgSource);
                const epgResp = await withTimeout(epgSource, {}, env.EPG_FETCH_TIMEOUT_MS);
                if (epgResp.ok) {
                    const contentLength = parseInt(epgResp.headers.get('content-length') ?? '0', 10);
                    if (contentLength > env.EPG_MAX_BYTES) {
                        const sizeMb = (contentLength / 1024 / 1024).toFixed(1);
                        addonInstance.log?.warn(`[EPG] Content-Length too large (${sizeMb} MB), skipping download`);
                    } else {
                        const epgContent = await epgResp.text();
                        addonInstance.epgData = await parseEPG(epgContent, addonInstance.log);
                        addonInstance.lastEpgUpdate = Date.now();
                    }
                }
            } catch {
                // Ignore EPG errors
            }
        } else {
            addonInstance.log?.debug('EPG skip (interval not elapsed)', {
                ms: now - (addonInstance.lastEpgUpdate ?? 0)
            });
        }
    }
}

export async function fetchSeriesInfo(addonInstance: any, seriesId: string) {
    const { config } = addonInstance;
    const { xtreamUrl, xtreamUsername, xtreamPassword } = config;
    if (!xtreamUrl || !xtreamUsername || !xtreamPassword) {
        throw new Error('Xtream credentials incomplete');
    }
    await validatePublicUrl(xtreamUrl);
    const base = `${xtreamUrl}/player_api.php?username=${encodeURIComponent(xtreamUsername)}&password=${encodeURIComponent(xtreamPassword)}`;
    const url = `${base}&action=get_series_info&series_id=${seriesId}`;
    const resp = await withTimeout(url, {}, env.FETCH_TIMEOUT_MS);
    if (!resp.ok) throw new Error(`Xtream series info fetch failed: HTTP ${resp.status}`);
    return await resp.json();
}

export function normalizeSeriesVideos(details: any, seriesId: string, idPrefix: string): any[] {
    const videos: any[] = [];
    if (!details || !details.episodes) return videos;

    const episodesData = details.episodes;

    const getEpId = (ep: any): string => {
        const val = ep.id ?? ep.stream_id ?? ep.episode_id ?? ep.episodeId;
        return val !== undefined && val !== null ? val.toString().trim() : '';
    };

    const getSeasonNum = (ep: any, fallbackSeason: number): number => {
        const s = ep.season ?? ep.season_num ?? ep.season_number;
        if (s !== undefined && s !== null) {
            const parsed = parseInt(s, 10);
            if (!isNaN(parsed)) return parsed;
        }
        return fallbackSeason;
    };

    const getEpisodeNum = (ep: any): number => {
        const e = ep.episode_num ?? ep.episode ?? ep.episodeId;
        if (e !== undefined && e !== null) {
            const parsed = parseInt(e, 10);
            if (!isNaN(parsed)) return parsed;
        }
        return 0;
    };

    if (Array.isArray(episodesData)) {
        for (const ep of episodesData) {
            const epId = getEpId(ep);
            if (!epId) continue;
            const season = getSeasonNum(ep, 1);
            const episode = getEpisodeNum(ep);
            videos.push({
                id: `xc${idPrefix}_s_${seriesId}_e_${epId}`,
                episodeStreamId: epId,
                season,
                episode,
                title: ep.title || `Season ${season} - Episode ${episode}`,
                released: ep.info?.releasedate || undefined,
                container_extension: ep.container_extension || 'mp4'
            });
        }
    } else if (typeof episodesData === 'object') {
        for (const sKey of Object.keys(episodesData)) {
            const fallbackSeason = parseInt(sKey, 10) || 1;
            const episodesList = episodesData[sKey];
            if (Array.isArray(episodesList)) {
                for (const ep of episodesList) {
                    const epId = getEpId(ep);
                    if (!epId) continue;
                    const season = getSeasonNum(ep, fallbackSeason);
                    const episode = getEpisodeNum(ep);
                    videos.push({
                        id: `xc${idPrefix}_s_${seriesId}_e_${epId}`,
                        episodeStreamId: epId,
                        season,
                        episode,
                        title: ep.title || `Season ${season} - Episode ${episode}`,
                        released: ep.info?.releasedate || undefined,
                        container_extension: ep.container_extension || 'mp4'
                    });
                }
            }
        }
    }

    videos.sort((a, b) => a.season - b.season || a.episode - b.episode);
    return videos;
}

const episodeCache = new WeakMap<object, Map<string, any>>();

function getEpisodeMap(details: any): Map<string, any> {
    let map = episodeCache.get(details);
    if (!map) {
        map = new Map<string, any>();
        const normalizedVideos = normalizeSeriesVideos(details, '', '');
        for (const video of normalizedVideos) {
            if (video.episodeStreamId) {
                map.set(video.episodeStreamId, video);
            }
        }
        episodeCache.set(details, map);
    }
    return map;
}

export async function resolveSeriesStream(addonInstance: any, seriesId: string, episodeStreamId: string): Promise<{ url: string; title: string }> {
    const details = await addonInstance.getSeriesInfoCached(seriesId);
    if (!details || !details.episodes) {
        throw new Error(`Series details not found for seriesId: ${seriesId}`);
    }

    const episodeMap = getEpisodeMap(details);
    const episode = episodeMap.get(episodeStreamId);
    if (!episode) {
        throw new Error(`Episode not found: ${episodeStreamId}`);
    }

    const ext = episode.container_extension || 'mp4';
    const { xtreamUrl, xtreamUsername, xtreamPassword } = addonInstance.config;
    const streamUrl = `${xtreamUrl}/series/${xtreamUsername}/${xtreamPassword}/${episodeStreamId}.${ext}`;

    const seriesName = details.info?.name || 'Series';
    const seasonStr = episode.season.toString().padStart(2, '0');
    const epStr = episode.episode.toString().padStart(2, '0');

    const epTitle = episode.title;
    const isGeneric = epTitle && (
        epTitle === `Episode ${episode.episode}` || 
        epTitle === `Season ${episode.season} - Episode ${episode.episode}` ||
        epTitle === `Season ${episode.season} - Episode ${episode.episode_num}`
    );
    const titleSuffix = epTitle && !isGeneric ? ` - ${epTitle}` : '';
    const title = `${seriesName} - S${seasonStr}E${epStr}${titleSuffix}`;

    return {
        url: streamUrl,
        title
    };
}
