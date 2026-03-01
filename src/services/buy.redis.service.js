import { prisma } from "../config/db.js";
import { redisClient } from "../config/redis.js";
import metricsService from "../services/metrics.service.js";
import fs from "fs";
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_TTL = 3600; // 1 hr

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scriptPath = path.resolve(__dirname, '../../lua/decrementScript.lua');
const  luaDecrementScript = fs.readFileSync(scriptPath, 'utf8');

const createError = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const buyItem = async (userId, productId) => {
    try {
        if (!userId) throw createError(400, "userId is required");
        if (!productId) throw createError(400, "productId is required");

        const key = `product:${productId}`;

        const redisResult = await redisClient.eval(luaDecrementScript, {
            keys: [key],
            arguments: []
        });

        if (redisResult === -2) {
            metricsService.orderCounter.inc({ status: 'FAILED' });
            throw createError(400, "Out of Stock");
        }

        if (redisResult >= 0) {
            try {
                const [updatedProduct, placedOrder] = await prisma.$transaction([
                    prisma.product.update({
                        where: { id: productId },
                        data: { stock: { decrement: 1 } }
                    }),
                    prisma.order.create({
                        data: {
                            userId,
                            productId,
                            status: 'CONFIRMED'
                        }
                    })
                ]);

                metricsService.orderCounter.inc({ status: 'CONFIRMED' });
                
                return { 
                    updatedProduct, 
                    placedOrder
                };

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

            return await buyItem(userId, productId);
        }

    } catch (err) {
        if (err.status !== 404) {
             metricsService.orderCounter.inc({ status: 'FAILED' });
        }
        throw err;
    }
};

export const buyServiceRedis = {
    buyItem
};
