import dotenv from "dotenv";
import redis from "redis";

dotenv.config();

const redisClient = redis.createClient({
    url: process.env.REDIS_URL,
});

redisClient.on('error', (err) => console.log('Redis Client Error:', err));

redisClient.on('connect', () => console.log('Connecting to Redis...'));

redisClient.on('ready', () => console.log('Redis is live and ready!'));

redisClient.connect();

export { redisClient };
