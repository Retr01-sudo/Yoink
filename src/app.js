import express from "express";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import redis from "redis";

dotenv.config({ path: new URL('../.env', import.meta.url).pathname }); //it manually sets location of env but how??

const pool = new pg.Pool({ connectionString:process.env.DATABASE_URL });

const redis_client = redis.createClient({ url: process.env.REDIS_URL });

redis_client.on('error', (err) => console.log('Redis Client Error:', err));

redis_client.on('connect', () => console.log('Connecting to Redis...'));

redis_client.on('ready', () => console.log('Redis is live and ready!'));

redis_client.connect();

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

await prisma.$connect();


const app = express();
const isDev = process.env.NODE_ENV !== "prodution";

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Helmet Security
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "ws:", "wss:", "http:", "https:"],
            fontSrc: ["'self'", "data:", "https:"],
            objectSrc: ["'none'"],
        },
    },
    hsts: !isDev && {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
    },
}));

// CORS Configuration
const corsOptions = {
    origin: isDev
        ? ["http://localhost:5173", "http://localhost:3000"]
        : process.env.ALLOWED_ORIGINS?.split(",") || [],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.options("/{*path}", cors(corsOptions));

app.get("/health", async (req, res) => {
    const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || "development",
        services: {}
    }

    let start = Date.now();
    try {
        await pool.query('SELECT 1;');
        health.services.postgres = { status: 'up', responseTime: `${Date.now() - start}ms` }
    }
    catch (error) {
        health.status = 'degraded'
        health.services.postgres = { status: 'down', error: error.message }
    }

    start = Date.now();
    try {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Redis ping timed out')), 3000));
        await Promise.race([redis_client.ping(), timeout]);
        health.services.redis = { status: 'up', responseTime: `${Date.now() - start}ms` }
    }
    catch (error) {
        health.status = 'degraded'
        health.services.redis = { status: 'down', error: error.message }
    }

    health.pool = {
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
    }

    const statusCode = health.status === "ok" ? 200 : 503;
    res.status(statusCode).json(health);
});

// import buyRoutes from "./routes/buy.routes.js";
// import stockRoutes from "./routes/stock.routes.js";
// import waitlistRoutes from "./routes/waitlist.routes.js";
//
// app.use("/api/buy", buyRoutes);
// app.use("/api/stock", stockRoutes);
// app.use("/api/waitlist", waitlistRoutes);

app.use((err, req, res, next) => {
    console.error("Error:", err);

    // CORS errors
    if (err.message === "Not allowed by CORS") {
        return res.status(403).json({
            error: "CORS Error",
            message: "Origin not allowed",
        });
    }

    // Default error
    res.status(err.status || 500).json({
        error: err.name || "Internal Server Error",
        message: err.message || "Something went wrong",
        ...(isDev && { stack: err.stack }), // Show stack trace only in dev
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

export default app;
