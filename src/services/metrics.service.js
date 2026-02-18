import { Registry } from "prom-client";
import client from "prom-client";

class MetricsService {
    constructor() {
        this.register = new Registry();
        client.collectDefaultMetrics({ register: this.register });


        this.httpRequestDuration = new client.Histogram({
            name: 'http_request_duration_seconds',
            help: 'Duration of HTTP requests in seconds',
            labelNames: ['method', 'route', 'status_code'],
            buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.5, 1, 2.5],
            registers: [this.register]
        });

        this.inventoryGauge = new client.Gauge({
            name: 'inventory_stock_level',
            help: 'Current stock level of items',
            labelNames: ['product_id'],
            registers: [this.register]
        });

        this.orderCounter = new client.Counter({
            name: 'total_orders',
            help: 'total number of orders processed',
            labelNames: ['status'],
            registers: [this.register]
        });
    }

    async getMetricsContentType() {
        return this.register.contentType;
    }

    async getMetrics() {
        return await this.register.metrics();
    }

    startHttpTimer() {
        return this.httpRequestDuration.startTimer();
    }
}

export default new MetricsService();
