import { STEAM_API_KEY } from '$env/static/private';

/**
 * Fetches the list of Steam apps from the Steam API.
 * This function will keep fetching until all apps are retrieved.
 * Fetching is done in chunks of 50,000 apps at a time.
 * If lastTime is provided, it will only fetch apps that have been updated since that time.
 * Default is 0, which will fetch all apps.
 * If Steam API returns no results, the lastTime will be returned as a saftey measure.
 *
 * WARNING: This will consume API calls
 *
 * @throws {Error} - If the fetch fails or the response is not ok.
 */
export async function getSteamApps(
    lastTime: number = 0
): Promise<{ apps: { appId: number; name: string }[]; time: number }> {
    let moreResults = true;
    let lastAppId = 0;
    const apps = [];
    const time = Date.now();

    while (moreResults) {
        const response = await fetch(
            'https://api.steampowered.com/IStoreService/GetAppList/v1/?' +
                new URLSearchParams({
                    key: STEAM_API_KEY,
                    if_modified_since: lastTime?.toString(),
                    last_appid: lastAppId.toString(),
                    max_results: '50000'
                }).toString()
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch Steam apps: ${response.statusText}`);
        }
        const data = await response.json();
        apps.push(...(data.response?.apps ?? []));

        if (data.response?.apps?.length === 0) {
            return {
                apps: [],
                time: lastTime
            };
        }

        if (data.response.have_more_results) {
            lastAppId = data.response.last_appid;
        } else {
            moreResults = false;
        }
    }
    return {
        apps:
            apps?.map((app) => {
                return {
                    appId: app.appid,
                    name: app.name
                };
            }) ?? [],
        time
    };
}

/**
 * Fetches the details of Steam apps from the Steam API.
 * This function will fetch the details in chunks of 250 apps at a time.
 * It will return only the apps that are available for the US region.
 *
 * WARNING: This will consume a lot of API calls
 *
 * @throws {Error} - If the fetch fails or the response is not ok.
 */
export async function getSteamAppDetails(
    appIds: number[]
): Promise<
    { appId: number; name: string; description: string; tags: { id: number; weight: number }[] }[]
> {
    const apps = [];
    const chunks = [];
    for (let i = 0; i < appIds.length; i += 250) {
        chunks.push(appIds.slice(i, i + 250));
    }

    for (const chunk of chunks) {
        const response = await fetch(
            'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?' +
                new URLSearchParams({
                    key: STEAM_API_KEY,
                    input_json: JSON.stringify({
                        ids: chunk.map((appId: number) => ({ appid: appId })),
                        context: {
                            country_code: 'US'
                        },
                        data_request: {
                            include_basic_info: true,
                            include_full_description: true,
                            include_tag_count: 100
                        }
                    })
                }).toString()
        );
        if (!response.ok) {
            throw new Error(`Failed to fetch Steam app details: ${response.statusText}`);
        }
        const data = await response.json();

        data.response.store_items = data.response.store_items.filter(
            (item: { unvailable_for_country_restriction?: boolean }) =>
                !item.unvailable_for_country_restriction
        );

        apps.push(...data.response.store_items);
    }

    return apps.map((item) => {
        return {
            appId: item.appid,
            name: item.name,
            description: item.full_description,
            tags:
                item.tags?.map((tag: { tagid: number; weight: number }) => {
                    return {
                        id: tag.tagid,
                        weight: tag.weight
                    };
                }) ?? []
        };
    });
}

/**
 * Fetches the list of Steam tags from the Steam API.
 * If lastTagHash is provided, it will only fetch retrieve tags if the hash has changed.
 * Default is 0, which will fetch all tags.
 *
 * WARNING: This will consume a API call
 *
 * @throws {Error} - If the fetch fails or the response is not ok.
 */
export async function getTagList(
    lastTagHash: number = 0
): Promise<{ tags: { id: number; name: string }[]; tagHash: number }> {
    const response = await fetch(
        'https://api.steampowered.com/IStoreService/GetTagList/v1/?' +
            new URLSearchParams({
                key: STEAM_API_KEY,
                language: 'english',
                have_version_hash: lastTagHash.toString()
            }).toString()
    );

    if (!response.ok) {
        throw new Error(`Failed to fetch Steam tag list: ${response.statusText}`);
    }

    const data = await response.json();

    return {
        tags:
            data.response.tags?.map((tag: { tagid: number; name: string }) => {
                return {
                    id: tag.tagid,
                    name: tag.name
                };
            }) ?? [],
        tagHash: data.response.version_hash
    };
}

/**
 * Fetches the number of players currently playing a Steam app.
 * This function will return 0 if the app is not found or if the response is not ok.
 */
export async function getPlayerCount(appId: number): Promise<number> {
    const response = await fetch(
        'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?' +
            new URLSearchParams({
                appid: appId.toString()
            }).toString()
    );
    if (!response.ok) return 0;

    const data = await response.json();
    return data.response.player_count ?? 0;
}
