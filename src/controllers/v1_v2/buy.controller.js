import { buyServiceNaive } from "../../services/buy.naive.service.js";
import { buyServiceAtomic } from "../../services/buy.atomic.service.js"

const createOrder = async (req, res, next) => {
    const userId = req.body.userId;
    const productId = req.body.productId;
    try {
        if (req.path.includes("/v1/buy")) {
            const orderStatus = await buyServiceNaive.buyItem(userId, productId);
            res.status(201).json(orderStatus);
        }
        else if (req.path.includes("/v2/buy")) {
            const orderStatus = await buyServiceAtomic.buyItem(userId, productId);
            res.status(201).json(orderStatus);
        }
    }
    catch (err) {
        next(err);
    }
}

export const buyController = {
    createOrder
};
