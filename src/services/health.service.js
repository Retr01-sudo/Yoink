import { pool } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import dotenv from "dotenv";

dotenv.config();

const checkHealthStatus = async () => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
        services: {},
        pool: {}
    };

    //check postgres
    let start = Date.now();
    try {
        await pool.query('SELECT 1;');
        health.services.postgres = { status: 'up', responseTime: `${Date.now() - start}ms` };
    } catch (error) {
        health.status = 'degraded';
        health.services.postgres = { status: 'down', error: error.message };
    }

    //check redis
    start = Date.now();
    try {
        //add timeout to prevent unresponsiveness
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timed out')), 3000));
        await Promise.race([redisClient.ping(), timeout]);
        health.services.redis = { status: 'up', responseTime: `${Date.now() - start}ms` };
    } catch (error) {
        health.status = 'degraded';
        health.services.redis = { status: 'down', error: error.message };
    }
    
    //Postgres pool info
    health.pool = {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
    };

    return health;
};

export const healthService = {
    checkHealthStatus
};
