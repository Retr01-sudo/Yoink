import dotenv from "dotenv";

dotenv.config();

const isDev = process.env.NODE_ENV !== "production";

const helmetOptions = {
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
}

const corsOptions = {
    origin: isDev
        ? ["http://localhost:5173", "http://localhost:3000"]
        : process.env.ALLOWED_ORIGINS?.split(",") || [],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
};

export {helmetOptions, corsOptions};
