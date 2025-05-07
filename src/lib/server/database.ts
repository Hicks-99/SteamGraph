import { Pool } from 'pg';
import * as jobs from '$lib/server/jobs.js';

import {
    POSTGRES_USER,
    POSTGRES_PASSWORD,
    POSTGRES_IP,
    POSTGRES_PORT,
    DATABASE_NAME
} from '$env/static/private';

const pool = new Pool({
    user: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    host: POSTGRES_IP,
    port: Number.parseInt(POSTGRES_PORT),
    database: DATABASE_NAME
});

/**
 * Initializes the database connection and creates the database and tables if they don't exist.
 * If the database or tables already exist, it will be ignored.
 * Creates a new pool to check if the database exists and while be closed after the check.
 * After that, it will start the sync with Steam.
 *
 * If an error occurs while creating the database or tables, it will log the error and exit the process.
 * Should only be called once at the start of the application.
 */
export async function init() {
    console.log('DB: Init');

    if (!(await checkDatabase())) {
        pool.end();
        process.exit(1);
    }
    console.log('DB: Database ready');

    (async () => {
        await jobs.syncWithSteam();
    })();
}

/**
 * Checks if the database and tables exists and creates it if it doesn't.
 * If the database or tables already exist, it will be ignored.
 * Creates a new pool to check if the database exists and while be closed after the check.
 * Returns true if the operation was successful, otherwise it will return false.
 */
export async function checkDatabase(): Promise<boolean> {
    const dbPool = new Pool({
        user: POSTGRES_USER,
        password: POSTGRES_PASSWORD,
        host: POSTGRES_IP,
        port: Number.parseInt(POSTGRES_PORT)
    });
    try {
        const dbExists = await dbPool.query(
            `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)`,
            [DATABASE_NAME]
        );

        if (!dbExists.rows[0].exists) {
            console.log('DB: Database does not exist, creating it');
            await dbPool.query(`CREATE DATABASE ${DATABASE_NAME}`);
        }

        await pool.query(`CREATE TABLE IF NOT EXISTS app (
            app_id INTEGER PRIMARY KEY,
            name TEXT,
            description TEXT,
            color TEXT DEFAULT '#000000',
            player_count INTEGER DEFAULT 0
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS tags (
            tag_id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS app_tags (
            app_id INTEGER REFERENCES app(app_id),
            tag_id INTEGER REFERENCES tags(tag_id),
            weight INTEGER NOT NULL,
            PRIMARY KEY (app_id, tag_id)
        )`);
        return true;
    } catch (error) {
        console.error('Error checking database:', error);
        return false;
    } finally {
        dbPool.end();
    }
}

/**
 * Insert tags in a single transaction into the database.
 * If the tag already exists, it will be updated.
 * Returns true if the operation was successful, otherwise it will return false.
 */
export async function insertOrUpdateTags(tags: { id: number; name: string }[]): Promise<boolean> {
    const query = `
        INSERT INTO tags (tag_id, name)
        SELECT * FROM UNNEST ($1::int[], $2::text[])
        ON CONFLICT (tag_id) 
        DO UPDATE SET 
            name = EXCLUDED.name
    `;

    try {
        await pool.query(query, [tags.map((tag) => tag.id), tags.map((tag) => tag.name)]);

        return true;
    } catch (error) {
        console.error('Error inserting or updating tags:', error);
        return false;
    }
}

/**
 * Insert apps in a single transaction into the database.
 * If the app already exists, it will be updated.
 * Returns true if the operation was successful, otherwise it will ROLLBACK the transaction and return false.
 */
export async function insertOrUpdateApps(
    apps: {
        appId: number;
        name: string;
        description: string;
        tags: { id: number; weight: number }[];
        color?: string;
        playerCount?: number;
    }[]
): Promise<boolean> {
    const appQuery = `
        INSERT INTO app (app_id, name, description, color, player_count)
        SELECT * FROM UNNEST ($1::int[], $2::text[], $3::text[], $4::text[], $5::int[])
        ON CONFLICT (app_id) 
        DO UPDATE SET 
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            color = EXCLUDED.color,
            player_count = EXCLUDED.player_count
    `;

    const tagsQuery = `
        INSERT INTO app_tags (app_id, tag_id, weight)
        SELECT * FROM UNNEST ($1::int[], $2::int[], $3::int[])
        ON CONFLICT (app_id, tag_id)
        DO UPDATE SET 
            weight = EXCLUDED.weight
    `;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(appQuery, [
            apps.map((app) => app.appId),
            apps.map((app) => app.name),
            apps.map((app) => app.description),
            apps.map((app) => app.color),
            apps.map((app) => app.playerCount)
        ]);

        await client.query(tagsQuery, [
            apps.flatMap((app) => app.tags.map(() => app.appId)),
            apps.flatMap((app) => app.tags.map((tag) => tag.id)),
            apps.flatMap((app) => app.tags.map((tag) => tag.weight))
        ]);

        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error inserting or updating apps:', error);
        return false;
    } finally {
        client.release();
    }
}

/**
 * Retrieves all nodes from the database to be used in the frontend.
 * Return could be empty if the query fails.
 */
export async function getNodes(): Promise<
    {
        id: number;
        name: string;
        description: string;
        color: string;
        playerCount: number;
        tags: { id: number; name: string; weight: number }[];
    }[]
> {
    try {
        const response = await pool.query(`
            SELECT 
                app.app_id, 
                app.name, 
                app.description, 
                app.color, 
                app.player_count, 
                json_agg(json_build_object('id', tags.tag_id, 'name', tags.name, 'weight', app_tags.weight)) AS tags
            FROM app AS app
            LEFT JOIN app_tags AS app_tags ON app.app_id = app_tags.app_id
            LEFT JOIN tags AS tags ON app_tags.tag_id = tags.tag_id
            GROUP BY app.app_id
        `);
        return response.rows.map((row) => {
            return {
                id: row.app_id,
                name: row.name,
                description: row.description,
                color: row.color,
                playerCount: row.player_count,
                tags: row.tags ?? []
            };
        });
    } catch (error) {
        console.error('Error fetching nodes:', error);
        return [];
    }
}
