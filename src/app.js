import express from "express";
import helmet from "helmet";
import cors from "cors";
import { helmetOptions, corsOptions } from "./config/security.js";
import healthRoute from "./routes/health.route.js";
import errorHandler from "./middleware/errorHandler.js";
import dotenv from "dotenv";
import { trackLatency } from "./middleware/metrics.middleware.js";
import metricsRoute from "./routes/metrics.route.js";
import buyRoute from "./routes/buy.route.js";

dotenv.config();

const app = express();

const isDev = process.env.NODE_ENV !== "production";

app.use(trackLatency);

app.use(express.json({ limit: "10mb" }));

app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(helmet(helmetOptions));

app.use(cors(corsOptions));

app.options("/{*path}", cors(corsOptions));

app.use("/metrics", metricsRoute)

app.use("/health", healthRoute);

app.use("/buy",buyRoute);

app.use(errorHandler);

export default app;
