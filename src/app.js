import express from "express";
import helmet from "helmet";
import cors from "cors";
import { helmetOptions, corsOptions } from "./config/security.js";
import healthRoute from "./routes/health.js";
import errorHandler from "./middleware/errorHandler.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const isDev = process.env.NODE_ENV !== "production";

app.use(express.json({ limit: "10mb" }));

app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(helmet(helmetOptions));

app.use(cors(corsOptions));

app.options("/{*path}", cors(corsOptions));

app.use("/health", healthRoute);

app.use(errorHandler);

export default app;
