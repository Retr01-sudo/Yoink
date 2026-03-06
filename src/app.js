import express from "express";
import helmet from "helmet";
import cors from "cors";
import { helmetOptions, corsOptions } from "./config/security.js";
import healthRouter from "./routes/health.route.js";
import errorHandler from "./middleware/errorHandler.js";
import dotenv from "dotenv";
import { trackLatency } from "./middleware/metrics.middleware.js";
import metricsRouter from "./routes/metrics.route.js";
import buyRouterV1V2 from "./routes/v1_v2/buy.route.js";
import buyRouterV3 from "./routes/v3/buy.route.js";
import buyRouterV4 from "./routes/v4/buy.route.js";

dotenv.config();

const app = express();

const isDev = process.env.NODE_ENV !== "production";

app.use(trackLatency);

app.use(express.json({ limit: "10mb" }));

app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(helmet(helmetOptions));

app.use(cors(corsOptions));

app.options("/{*path}", cors(corsOptions));

app.use("/metrics", metricsRouter);

app.use("/health", healthRouter);

app.use("/api", buyRouterV1V2);

app.use("/api/v3", buyRouterV3);

app.use("/api/v4", buyRouterV4);

app.use(errorHandler);

export default app;
