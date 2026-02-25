import { prisma } from "../config/db.js";
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

        const orderInfo = await prisma.$transaction(async(tx)=>{

            const product = await tx.product.findUnique({
                where: { id: productId }
            });

            if (!product) throw createError(404, "Product not found");

            const updatedResult = await tx.product.updateMany({
                where:{
                    id: productId,
                    stock: {gte: 1}
                },
                data:{
                    stock: {decrement: 1}
            }
            });

            if(updatedResult.count === 0){
                throw createError(400, "Out of stock");
            }

            const placedOrder = await tx.order.create({
                data:{
                    productId: productId,
                    userId: userId,
                    status: "CONFIRMED"
                }
            })

            const updatedProduct = await tx.product.findUnique({
                where: {
                    id: productId
                }
            })

            return {placedOrder, updatedProduct}
        })

        // Track metrics after successful order
        metricsService.orderCounter.inc({ status: 'CONFIRMED' });
        metricsService.inventoryGauge.set({ product_id: productId }, orderInfo.updatedProduct.stock);

        return { updatedProduct: orderInfo.updatedProduct, placedOrder: orderInfo.placedOrder };

    } catch (err) {
        // Also track failed orders
        if (err.status !== 404) {
            metricsService.orderCounter.inc({ status: 'FAILED' });
        }
        throw err;
    }
};

export const buyServiceAtomic = { buyItem };
