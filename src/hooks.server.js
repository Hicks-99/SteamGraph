import * as db from '$lib/server/database.js';

export const init = async () => {
    await db.init();
}