import env from '../config/env';

export function redactSensitive(val: any): any {
    if (typeof val === 'string') {
        let redacted = val;
        // Redact query parameter credentials (e.g. username=foo or password=bar)
        redacted = redacted.replace(/([?&])(username|password|password_md5)=[^&]*/gi, '$1$2=[REDACTED]');
        // Redact inline path credentials (e.g. /series/username/password/ or /get.php/username/password/)
        redacted = redacted.replace(/(https?:\/\/[^/]+\/(?:series|movie|live|get\.php)\/)([^/]+)\/([^/]+)/gi, '$1[REDACTED]/[REDACTED]');
        return redacted;
    }
    if (Array.isArray(val)) {
        return val.map(redactSensitive);
    }
    if (val !== null && typeof val === 'object') {
        const res: any = {};
        for (const k of Object.keys(val)) {
            if (k.toLowerCase().includes('username') || k.toLowerCase().includes('password') || k.toLowerCase().includes('secret') || k.toLowerCase().includes('token')) {
                res[k] = '[REDACTED]';
            } else {
                res[k] = redactSensitive(val[k]);
            }
        }
        return res;
    }
    return val;
}

export function makeLogger(component?: string) {
    const prefix = component ? ` [${component}]` : '';
    const ts = () => new Date().toISOString();
    return {
        debug: (...a: any[]) => { if (env.DEBUG) console.log(`${ts()} [DEBUG]${prefix}`, ...a.map(redactSensitive)); },
        info:  (...a: any[]) => console.log(`${ts()} [INFO]${prefix}`, ...a.map(redactSensitive)),
        warn:  (...a: any[]) => console.warn(`${ts()} [WARN]${prefix}`, ...a.map(redactSensitive)),
        error: (...a: any[]) => console.error(`${ts()} [ERROR]${prefix}`, ...a.map(redactSensitive)),
    };
}
