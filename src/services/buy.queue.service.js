import createError from 'http-errors';
import { prisma } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import metricsService from "../services/metrics.service.js";
import fs from "fs";
import path from 'path';
import { fileURLToPath } from 'url';
import { Queue } from "bullmq";

const DEFAULT_TTL = 3600; // 1 hr

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scriptPath = path.resolve(__dirname, '../../lua/decrementScript.lua');
const  luaDecrementScript = fs.readFileSync(scriptPath, 'utf8');

const order_queue = new Queue('orders',{
    defaultJobOptions: {
        attempts: 3,            // Retry 3 times on failure
        backoff: {
            type: 'exponential',  // 'fixed' | 'exponential'
            delay: 1000,          // Initial delay in ms
        },
        removeOnComplete: {
            age: 3600,            // Remove after 1 hour (seconds)
            count: 100,           // Keep last 100 completed jobs
        },
        removeOnFail: {
            age: 24 * 3600,       // Keep failed jobs for 24 hours
        },
        timeout: 30000,         // Job fails if not done in 30s
    },
});

async function addJob(userId,productId,stock){
    return await order_queue.add('createOrder',{userId: userId, productId: productId, stock: stock});
}

export const buyServiceQueue = {
    buyItem: async (userId, productId) => {
        try{
            if (!userId) throw createError(400, "userId is required");
            if (!productId) throw createError(400, "productId is required");

            const key = `product:${productId}`;

            const redisResult = await redisClient.eval(luaDecrementScript, {
                keys: [key],
                arguments: []
            });

            if (redisResult === -2) {
                metricsService.orderCounter.inc({ status: 'REJECTED' });
                throw createError(400, "Out of Stock");
            }

            if (redisResult >= 0) {
                try {
                    const job = await addJob(userId,productId,redisResult);
                    metricsService.orderCounter.inc({ status: 'ACCEPTED' });
                } catch (error) {
                    throw error;
                }
            }

            if (redisResult === -1) {
                const product = await prisma.product.findUnique({ 
                    where: { id: productId } 
                });

                if (!product || product.stock <= 0) {
                    throw createError(400, "Out of Stock");
                }

                await redisClient.set(key, product.stock, { 
                    NX: true, 
                    EX: DEFAULT_TTL 
                });

                return await buyServiceQueue.buyItem(userId, productId);
            }

        } catch (err) {
            if (err.status !== 404) {
                metricsService.orderCounter.inc({ status: 'REJECTED' });
            }
            throw err;
        }
        return { message: "Order accepted for processing" };
    }
};
