// Watch-history API for whatshouldwewatch — replaces per-browser localStorage
// with a single shared source of truth in Workers KV, keyed one JSON blob
// per show: `seen:<show>` -> { "s1e1": {s,e}, "s1e2": {s,e}, ... }.
//
// Routes:
//   GET    /seen                        -> { show: {s#e#: {s,e}, ...}, ... } for every show
//   GET    /seen/:show                  -> {s#e#: {s,e}, ...} for one show
//   DELETE /seen/:show                  -> clear a show's history
//   PUT    /seen/:show/:season/:episode -> mark one episode watched
//   DELETE /seen/:show/:season/:episode -> unmark one episode

const ALLOWED_ORIGIN = 'https://whatshouldwewatch.geekvoice.net';
const SHOWS = new Set(['seinfeld', 'familyguy', 'simpsons', 'southpark', 'koth', 'laworder']);

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
    };
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
}

async function getShowMap(env, show) {
    const raw = await env.SEEN_KV.get(`seen:${show}`);
    return raw ? JSON.parse(raw) : {};
}

async function putShowMap(env, show, map) {
    await env.SEEN_KV.put(`seen:${show}`, JSON.stringify(map));
}

export default {
    async fetch(request, env) {
        const { pathname } = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders() });
        }

        if (request.method === 'GET' && pathname === '/seen') {
            const result = {};
            await Promise.all([...SHOWS].map(async show => {
                result[show] = await getShowMap(env, show);
            }));
            return json(result);
        }

        const parts = pathname.split('/').filter(Boolean); // ['seen', show, season?, episode?]
        if (parts[0] !== 'seen' || !parts[1] || !SHOWS.has(parts[1])) {
            return json({ error: 'not found' }, 404);
        }
        const show = parts[1];

        if (request.method === 'GET' && parts.length === 2) {
            return json(await getShowMap(env, show));
        }

        if (request.method === 'DELETE' && parts.length === 2) {
            await putShowMap(env, show, {});
            return json({});
        }

        if (parts.length === 4) {
            const season = Number(parts[2]);
            const episode = Number(parts[3]);
            if (!Number.isInteger(season) || !Number.isInteger(episode)) {
                return json({ error: 'invalid season/episode' }, 400);
            }
            const map = await getShowMap(env, show);
            const key = `s${season}e${episode}`;

            if (request.method === 'PUT') {
                map[key] = { s: season, e: episode };
                await putShowMap(env, show, map);
                return json(map);
            }
            if (request.method === 'DELETE') {
                delete map[key];
                await putShowMap(env, show, map);
                return json(map);
            }
        }

        return json({ error: 'not found' }, 404);
    },
};
