import { prisma } from "../config/db.js";
import { randomUUID } from "crypto";
import metricsService from "../services/metrics.service.js";

const createError = (status, message) => {
    const err = new Error(message);
    err.status = status;
    return err;
};

const buyItem = async (userId, productId) => {
    try {
        if (!productId) throw createError(400, "productId is required");
        if (!userId) throw createError(400, "userId is required");

        const product = await prisma.product.findUnique({
            where: { id: productId }
        });

        if (!product) throw createError(404, "Product not found");
        if (product.stock <= 0) throw createError(400, "Out of stock");

        const [updatedProduct, placedOrder] = await prisma.$transaction([
            prisma.product.update({
                where: { id: productId },
                data: { stock: product.stock - 1 }
            }),
            prisma.order.create({
                data: {
                    id: randomUUID(),
                    userId,
                    productId,
                    status: "CONFIRMED",
                }
            })
        ]);

        // Track metrics after successful order
        metricsService.orderCounter.inc({ status: 'CONFIRMED' });
        metricsService.inventoryGauge.set({ product_id: productId }, updatedProduct.stock);

        return { updatedProduct, placedOrder };
    } catch (err) {
        // Also track failed orders
        if (err.status !== 404) {
            metricsService.orderCounter.inc({ status: 'FAILED' });
        }
        throw err;
    }
};

export const buyServiceNaive = { buyItem };
