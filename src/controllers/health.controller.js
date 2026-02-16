import { healthService } from "../services/health.service.js";

const getHealthStatus = async (req, res, next) => {
    try {
        const health = await healthService.checkHealthStatus();
        const statusCode = health.status === "ok" ? 200 : 503;
        res.status(statusCode).json(health);
    } catch (error) {
        //pass errors to global error handler
        next(error);
    }
};

export const healthController = {
    getHealthStatus
};
