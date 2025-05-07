import * as fs from 'fs';
import * as steam from '$lib/server/steam.js';
import * as db from '$lib/server/database.js';

/**
 * Syncs the Steam tags and apps with the database.
 */
export async function syncWithSteam() {
    console.log('Syncing with Steam...');
    await syncSteamTags();
    await syncSteamApps();
    console.log('Syncing with Steam done');
}

/**
 * Syncs the Steam tags with the database.
 */
async function syncSteamTags() {
    let data = await getDataJson();

    let tagList: { tags?: { id: number; name: string }[]; tagHash?: number } = {};
    if (data.lastTagHash) {
        tagList = await steam.getTagList(data.lastTagHash);
    } else {
        tagList = await steam.getTagList();
    }

    if (tagList.tags?.length === 0) {
        console.log('No new Steam tags found');
        return;
    }

    if (!(await db.insertOrUpdateTags(tagList.tags))) return;

    data.lastTagHash = tagList.tagHash;

    await setDataJson(data);

    console.log('Steam tags synced');
}

/**
 * Syncs the Steam apps with the database.
 */
async function syncSteamApps() {
    let data = await getDataJson();

    let appList: { apps?: { appId: number; name: string }[]; time?: number } = {};
    if (data.lastAppTime) {
        appList = await steam.getSteamApps(data.lastAppTime);
    } else {
        console.log(
            'Looks like this is the first time syncing all apps with Steam. This may take a while.'
        );
        appList = await steam.getSteamApps();
        console.log(
            `Syncing details from ${appList.apps.length} apps. This will take a long time.`
        );
    }

    if (appList.apps?.length === 0) {
        console.log('No new or updated Steam apps found');
        return;
    }

    const appDetails = await steam.getSteamAppDetails(appList.apps.map((app) => app.appId));

    if (!(await db.insertOrUpdateApps(appDetails))) return;

    data.lastAppTime = appList.time;

    await setDataJson(data);

    console.log('Steam apps synced');
}

/**
 * Gets the data from the data.json file.
 * If the file does not exist, it returns an empty object.
 */
async function getDataJson() {
    try {
        const file = await fs.promises.readFile('data.json', 'utf-8');
        return JSON.parse(file);
    } catch {
        return {};
    }
}

/**
 * Sets the data in the data.json file.
 * If the file does not exist, it will be created.
 */
async function setDataJson(data: any) {
    try {
        await fs.promises.writeFile('data.json', JSON.stringify(data));
    } catch (error) {
        console.error('Failed to write data.json:', error);
    }
}
