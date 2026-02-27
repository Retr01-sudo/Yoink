import { buyServiceRedis } from "../../services/buy.redis.service.js";

const createOrder = async (req,res,next)=>{
    const userId = req.body.userId;
    const productId = req.body.productId;
    try{
        const orderStatus = await buyServiceRedis.buyItem(userId,productId);
        res.status(202).json(orderStatus);
    }
    catch(err){
        next(err);
    }
}

export const buyController = {
    createOrder
};
