import { Worker } from "bullmq";
import { prisma } from "../../config/db.js";
import metricsService from "../../services/metrics.service.js";
import { redisClient } from "../../config/redis.js";
import http from "http";

let count = 1;

const connection = {
    host: 'localhost',
    port: 6379
}

// Start a lightweight metrics server for this worker on port defined by env
const METRICS_PORT = process.env.DLQWORKER_METRICS_PORT;
http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
        res.setHeader('Content-Type', metricsService.getMetricsContentType());
        res.end(await metricsService.getMetrics());
    } else {
        res.statusCode = 404;
        res.end('Not Found');
    }
}).listen(METRICS_PORT, '0.0.0.0', () => {
    console.log(`📊 DLQWorker metrics available on http://0.0.0.0:${METRICS_PORT}/metrics`);
});

const worker = new Worker('failed_orders',async(job)=>{
    const { userId, productId } = job.data;
    
    await redisClient.incr(`product:${productId}`);
    
    metricsService.orderCounter.inc({ status: 'ROLLBACK_SUCCESSFUL' });
    console.log(`Rollback successful for product: ${productId} (Job: ${job.id})`);
    count = count + 1;
},
    {connection}
);

worker.on('failed',(job,error)=>{
    console.log(`job with id: ${job.id} failed with error\n`);
    console.log(error);
    metricsService.orderCounter.inc({ status: 'ROLLBACK_FAILED' });
});

process.on("SIGTERM",async()=>await worker.close());
