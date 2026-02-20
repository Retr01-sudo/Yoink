import { prisma } from "../config/db.js";

const buyItem = async (userId,productId)=>{
    try{

        if (!productId) throw new Error("productId is required");
        // if (!userId) throw new Error("userId is required");

        const product = await prisma.product.findUnique({
            where:{
                id: productId
            }
        })

        if(!productId){
            throw new Error("Product not found");
        }

        if(product.stock<=0){
            throw new Error("Out of stock");
        }

        const newStock = product.stock - 1;

        const updatedProduct = await prisma.product.update({
            where:{
                id: productId
            },
            data: {
                stock: newStock
            }
        });
        return updatedProduct;
    }
    catch(err){
        throw  err
    }
}

export const buyService = {
    buyItem
}
