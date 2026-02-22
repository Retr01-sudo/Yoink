import metricsService from "../services/metrics.service.js";

const trackLatency = (req, res, next) => {
    const end = metricsService.startHttpTimer();

    // Save the parsed path immediately before it enters routers
    const parsedPath = new URL(req.originalUrl || req.url || req.path, `http://${req.headers.host}`).pathname;

    res.on('finish', () => {
        // Express populates req.route and req.baseUrl after this middleware runs.
        let routePath = parsedPath;

        // If successfully matched a specific route and it's not just a root level fallback, use that
        if (req.route && req.route.path && req.route.path !== '/') {
            routePath = `${req.baseUrl}${req.route.path}`;
        } else if (req.baseUrl && req.baseUrl !== '/') {
            // Sometimes only baseUrl survives
            routePath = req.baseUrl;
        }

        // Ensure we don't end up with an empty string or double slashes
        if (!routePath || routePath === '') {
            routePath = '/';
        }

        end({
            method: req.method,
            route: routePath,
            status_code: res.statusCode
        });
    });
    next();
};

export { trackLatency };
