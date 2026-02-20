import { prisma } from "../config/db.js";

const buyItem = async (userId,productId)=>{
    try{

        if (!productId) throw new Error("productId is required");
        if (!userId) throw new Error("userId is required");

        const product = await prisma.product.findUnique({
            where:{
                id: productId
            }
        })

        if(!product){
            throw new Error("Product not found");
        }

        if(product.stock<=0){
            throw new Error("Out of stock");
        }

const [updatedProduct, placedOrder] = await prisma.$transaction([
            prisma.product.update({
                where: {
                    id: productId
                },
                data: {
                    stock: product.stock - 1
                }
            }),
            prisma.order.create({
                data: {
                    id: randomUUID(),
                    userId: userId,
                    productId: productId,
                    status: "CONFIRMED",
                }
            })
        ]);

        return {updatedProduct, placedOrder};
    }
    catch(err){
        throw  err
    }
}

export const buyService = {
    buyItem
}
