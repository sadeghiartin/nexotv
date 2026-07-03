export interface ParsedId {
    type: 'channel' | 'movie' | 'series' | 'episode' | 'unknown';
    idPrefix?: string;
    seriesId?: string;
    episodeId?: string;
    movieId?: string;
    channelId?: string;
}

export function parseId(id: string): ParsedId {
    if (typeof id !== 'string') {
        return { type: 'unknown' };
    }
    const prefixMatch = id.match(/^(xc|io|m3)([a-zA-Z0-9]*)_/);
    if (!prefixMatch) {
        return { type: 'unknown' };
    }
    const idPrefix = prefixMatch[2];

    if (id.includes('_s_') && id.includes('_e_')) {
        const match = id.match(/_s_([^_]+)_e_([^_]+)$/);
        if (!match) {
            return { type: 'unknown' };
        }
        return {
            type: 'episode',
            idPrefix,
            seriesId: match[1],
            episodeId: match[2]
        };
    }

    if (id.includes('_s_')) {
        const match = id.match(/_s_([^_]+)$/);
        if (!match) {
            return { type: 'unknown' };
        }
        return {
            type: 'series',
            idPrefix,
            seriesId: match[1]
        };
    }

    if (id.includes('_m_')) {
        const match = id.match(/_m_([^_]+)$/);
        if (!match) {
            return { type: 'unknown' };
        }
        return {
            type: 'movie',
            idPrefix,
            movieId: match[1]
        };
    }

    const channelMatch = id.match(/^(?:xc|io|m3)[a-zA-Z0-9]*_(.+)$/);
    if (!channelMatch) {
        return { type: 'unknown' };
    }
    return {
        type: 'channel',
        idPrefix,
        channelId: channelMatch[1]
    };
}
