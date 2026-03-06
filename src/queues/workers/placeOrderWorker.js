import { Worker } from "bullmq";
import { prisma } from "../../config/db.js";
import { Queue } from "bullmq";
import metricsService from "../../services/metrics.service.js";
import http from "http";

const connection = {
    host: 'localhost',
    port: 6379,
}

// Start a lightweight metrics server for this worker on port 3003
const METRICS_PORT = process.env.WORKER_METRICS_PORT;
http.createServer(async (req, res) => {
    if (req.url === '/metrics') {
        res.setHeader('Content-Type', metricsService.getMetricsContentType());
        res.end(await metricsService.getMetrics());
    } else {
        res.statusCode = 404;
        res.end('Not Found');
    }
}).listen(METRICS_PORT, '0.0.0.0', () => {
    console.log(`📊 PlaceOrderWorker metrics available on http://0.0.0.0:${METRICS_PORT}/metrics`);
});

const dlq = new Queue('failed_orders', {
    defaultJobOptions: {
        attempts: 10,            // Retry 10 times on failure
        backoff: {
            type: 'exponential',  // 'fixed' | 'exponential'
            delay: 5000,          // Initial delay in ms
        },
        removeOnComplete: {
            age: 3600,            // Remove after 1 hour (seconds)
            count: 100,           // Keep last 100 completed jobs
        },
        removeOnFail: {
            age: 24 * 3600,       // Keep failed jobs for 24 hours
        },
        timeout: 30000,         // Job fails if not done in 30s
    },
    connection
});

let count = 1;

const worker = new Worker('orders', async (job) => {
    const userId = job.data.userId;
    const productId = job.data.productId;
    try {
        const [updatedProduct, placedOrder] = await prisma.$transaction([
            prisma.product.update({
                where: {
                    id: productId,
                },
                data: {
                    stock: { decrement: 1 }
                }
            }),

            prisma.order.create({
                data: {
                    userId: userId,
                    productId: productId,
                    status: 'CONFIRMED'
                }
            })
        ]);
        metricsService.orderCounter.inc({ status: 'CONFIRMED' });
        console.log(`order count ${count}`);
        count = count + 1;
    }
    catch (error) {
        const maxAttempts = job.opts.attempts || 1;
        const isLastAttempt = job.attemptsMade === (maxAttempts - 1);

        if (isLastAttempt) {
            console.log(`Job ${job.id} exhausted all retries. Sending to DLQ.`);
            metricsService.orderCounter.inc({ status: 'FAILED' })
            await dlq.add('rollback_redis', { userId, productId, reason: 'Max retries reached' });
        }

        throw error;
    }
},
    {
        concurrency: 10,
        connection
    },
);

worker.on('failed', async (job, error) => {
    console.log(`job with id: ${job.id} failed with error\n`);
    console.log(error);
})

process.on('SIGTERM', async () => await worker.close());
