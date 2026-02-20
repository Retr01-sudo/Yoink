import {buyService} from "../services/buy.service.js";

const createOrder = async (req,res,next)=>{
    const userId = req.body.userId;
    const productId = req.body.productId;
    try{
        const orderStatus = await buyService.buyItem(userId,productId);
        res.status(201).json(orderStatus);
    }
    catch(err){
        next(err);
    }
}

export const buyController = {
    createOrder
};
