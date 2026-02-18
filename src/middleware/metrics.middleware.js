import metricsService from "../services/metrics.service.js";

const trackLatency = (req, res, next) => {
    const end = metricsService.startHttpTimer();
    res.on('finish', () => {
        end({ 
            method: req.method, 
            route: req.route ? req.route.path : req.path,
            status_code: res.statusCode 
        });
    });
    next();
};

export  {trackLatency};
