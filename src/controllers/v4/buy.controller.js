import { buyServiceQueue } from "../../services/buy.queue.service.js";

const createOrder = async (req, res, next) => {
    const userId = req.body.userId;
    const productId = req.body.productId;
    try {
        const orderStatus = await buyServiceQueue.buyItem(userId, productId);
        // V4 requires 202 Accepted because the order is being processed asynchronously
        res.status(202).json(orderStatus);
    } catch (err) {
        next(err);
    }
};

export const buyController = {
    createOrder
};
