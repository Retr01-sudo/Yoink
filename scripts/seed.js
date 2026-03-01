import { randomUUID } from "crypto";
import { prisma } from "../src/config/db.js";
import  fs  from "fs";
import path from "path";
import { redisClient } from "../src/config/redis.js"; 

const cleanup = async () => {
    console.log("Cleaning up old data...");
    try{
        await prisma.order.deleteMany();
        await prisma.product.deleteMany();
        await prisma.user.deleteMany();
        console.log("Cleanup done!");
    }
    catch(err){
        throw err;
    }
};

const addUsers = async (numberOfUsers) => {
    try {
        for (let i = 0; i < numberOfUsers; i++) {
            await prisma.user.create({
                data: {
                    id: randomUUID(),
                    name: `testUser${i + 1}`,
                    email: `testuser${i + 1}@gmail.com`
                }
            });
        }
    }
    catch (err) {
        throw err;
    }
};

const productNames = [
    "Wireless Headphones", "Mechanical Keyboard", "USB-C Hub",
    "Webcam HD", "Monitor Stand", "Mouse Pad XL",
    "Laptop Stand", "LED Desk Lamp", "Portable Charger", "Bluetooth Speaker"
];

const addProducts = async (numberOfProducts) => {
    try {
        for (let i = 0; i < numberOfProducts; i++) {
            await prisma.product.create({
                data: {
                    id: randomUUID(),
                    name: productNames[i % productNames.length],
                    price: parseFloat((Math.random() * 200 + 10).toFixed(2)), // $10 - $210
                    // stock: Math.floor(Math.random() * 20) + 1,               // 1  - 100
                    stock: 1_00_00_000
                }
            });
        }
    }
    catch (err) {
        throw err;
    }
};

const seed = async () => {
    try {
        await cleanup();
        const numberOfUsers=3000;
        console.log("Seeding users...");
        await addUsers(numberOfUsers);
        console.log("Users seeded successfully");

        console.log("Seeding products...");
        await addProducts(10);
        console.log("Products seeded successfully");

        // --- k6 Export Logic Start ---
        console.log("Exporting IDs for k6 spike testing...");

        // Fetch the inserted data from the database
        const users = await prisma.user.findMany({ select: { id: true } });
        // const products = await prisma.product.findMany({ 
        //     select: { id: true, name: true, stock: true } 
        // });
        const product = await prisma.product.findFirst({
            where: {
                name: "Mechanical Keyboard"
            },
            select:
            {
                id: true,
                name: true,
                stock: true
            }
        })

        const k6Data = {
            userIds: users.map(u => u.id),
            product: product
            // products: products // Exporting full product details to make selection easier in k6
        };

        // Ensure the benchmarks/k6 directory exists before writing
        const dirPath = path.resolve('./benchmarks/k6');
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        const filePath = path.join(dirPath, 'data.json');
        fs.writeFileSync(filePath, JSON.stringify(k6Data, null, 2));
        
        console.log(`Successfully exported ${users.length} users and product with name:${product.name} and stock: ${product.stock} to ${filePath}`);
    }
    catch (err) {
        throw err;
    }
    finally {
        await prisma.$disconnect();
        if (redisClient) {
            await redisClient.quit(); 
        }
        process.exit(0);
    }
};

seed();
