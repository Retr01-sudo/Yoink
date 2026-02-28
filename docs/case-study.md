# How I Broke My Flash Sale Backend (And Fixed It): A Yoink! Case Study

I built a Node.js e-commerce backend called Yoink! to simulate what happens during a massive flash sale. The goal was simple: handle 1,000 concurrent users trying to buy a product at the exact same millisecond without overselling.

To do this right, I knew I needed robust testing and observability. I used **k6** to simulate the concurrent load (Virtual Users or VUs), **Prometheus** to scrape application metrics, and **Grafana** to visualize everything. 

It sounds easy until you actually load test it. I learned the hard way that a system working perfectly for five users will completely collapse under a spike. Here is the step-by-step evolution of my architecture, the infrastructure hurdles I faced, and why I had to keep rebuilding.

## Early Infrastructure Hurdles

Before I even got to the race conditions, I had to figure out how to observe them. This taught me a lot about networking and middleware:

**The Docker Firewall Trap:** I deployed my app and Prometheus in Docker containers, but Prometheus couldn't reach my `/metrics` endpoint. After hours of scanning logs, I finally checked `ufw` and `nftables` rules. The host firewall was actively blocking connections from the `docker-compose` network. I had to add the Docker subnet as an exception in `ufw`. This was a major "aha" moment for me regarding Docker—I learned exactly how Docker network isolation works under the hood and why you shouldn't just lazily bind everything to the host network.

**The Case of the Missing Metrics:** Once I got Prometheus scraping, I noticed a frustrating issue in Grafana. When a request threw an error and hit my Express global error handler, the origin path was erased. All my errors were being lumped together as untagged 500s or 400s; I couldn't tell which route was failing. I fixed this by writing a custom metrics middleware that explicitly saved the original path to the request object *before* it hit any controllers, ensuring Prometheus could properly tag the route even if the request exploded later.

With observability finally in place, I started load testing.

## V1: The Naive Implementation

*[Placeholder: Insert V1 Architecture Diagram Image here. Flow: Client -> Node.js -> Read Postgres Stock -> Check > 0 -> Write Postgres Order]*

**What I built:** I started with the standard CRUD logic every developer learns first. Read the stock from Postgres, check if it's greater than 0, decrement the stock, and insert an order record.

**What broke:** I ran a k6 benchmark firing 1,000 concurrent users at the buy endpoint. The result? Pure chaos. The inventory had exactly `[Insert Starting Stock here]` units, but Postgres showed `[Insert actual order count from DBeaver when testing V1]` confirmed orders. It was a classic read-modify-write race condition. Thousands of requests hit the database simultaneously, read the stock as > 0, and fired off decrements. Postgres had no idea it was being lied to.

**What I learned:** Correctness under concurrency requires atomicity. If you read a value and write it back in separate, unisolated operations, you will oversell under load.

## V2: Atomic DB Transactions

*[Placeholder: Insert V2 Architecture Diagram Image here. Flow: Client -> Node.js -> Prisma updateMany (WHERE stock >= 1) -> DB]*

**What I built:** I pushed the concurrency control down to the database. I swapped the separate read and write queries for a single Prisma `updateMany` operation with a `WHERE stock >= 1` clause. This enforced atomicity at the DB engine level.

**What broke:** The overselling stopped, but the performance completely tanked. When I ran the k6 test again, 1,000 users fighting for a database connection to run that atomic update caused massive contention. My p95 latency blew past `[Insert custom k6_yoink_req_duration p(95) latency from k6 terminal when testing V2]`ms. The database became a severe bottleneck, and my `[Insert Event Loop Lag from Node.js Grafana Dashboard when testing V2]` run spiked heavily, showing the Node thread was overwhelmed. 

**What I learned:** Correctness isn't enough. A correct system that can't handle load isn't production-ready.

## V3 (Initial): Redis + Lua

*[Placeholder: Insert V3 Initial Architecture Diagram Image here. Flow: Client -> Node.js -> Redis (Lua decrement) -> IF success -> Synchronous Postgres Write]*

**What I built:** Postgres was too slow to handle the initial spike, so I moved the inventory management strictly to Redis. I wrote a Lua script to atomically decrement the stock in memory. Redis is insanely fast and can process these decrements sequentially at around 10,000 operations per second. Once the Lua script succeeded, the service made a synchronous write to Postgres to finalize the order.

**What broke:** I performed a preliminary check with a small load (less than 100 VUs). There was no problem, and latency dropped beautifully below 100ms. I thought I had cracked it. Then I increased the load to 1,000 VUs and the server instantly started throwing massive 500 errors. 

Prisma was screaming with a `P2037` error:
```text
Too many database connections opened: sorry, too many clients already
```
Because the requests cleared Redis so fast, all 1,000 requests tried to open a Prisma database connection simultaneously to write the order.

**The Bug I'm Most Proud Of Finding:** 
The database crash wasn't the biggest problem—it was the silent data divergence it caused. When I ran the benchmark with 10k stock and 1,000 concurrent users (`[Insert k6 reqs/s from Web Dashboard here]`), my Grafana "Current Inventory Stock" showed 0. But when I ran `SELECT count(*) FROM "Order";` in DBeaver, I only had `[Insert DBeaver Order count here]` orders. 

There were `[Insert number of missing units/divergence here]` units missing. Because it was an optimistic decrement with no DB write guarantee, those missing units decremented in Redis, failed at the Postgres connection bottleneck, and were permanently lost from the sale. 

**What I learned:** A fast system that loses data silently is worse than a slow system that doesn't.

## V3 (Improved): Redis + BullMQ Message Queue

*[Placeholder: Insert V4/Improved V3 Architecture Diagram Image here. Flow: Client -> Node.js -> Redis (Lua decrement) -> Push to BullMQ -> Return 202 to Client -> Worker pulls from Queue -> Safely Writes to Postgres]*

**What I built:** To bridge the gap between fast Redis and slow Postgres, I improved V3 by introducing a message queue using BullMQ. 

Now, the Lua script decrements Redis, but instead of writing to Postgres synchronously, I push a job to BullMQ and immediately return a 202 status code. I set up a worker process with a strict concurrency limit of 5. The worker pulls jobs off the queue and writes the orders safely to Postgres.

**Why it worked:** BullMQ acts as a buffer. The worker concurrency of 5 means we never exhaust the database connection pool—`P2037` errors disappeared entirely. My Node.js Active Handlers stayed completely stable at `[Insert Active Handlers count from Node.js Dashboard when testing V3 with MQ]`. 

If a transient error occurs, the job retries. Most importantly, if a job fails permanently after exhausting all retries, a Dead Letter Queue (DLQ) worker takes that failed job and increments the Redis stock back by 1, totally eliminating the data divergence.

## What I'd Do Differently If I Started Over

If I started this project over, I wouldn't assume that more database connections equal more throughput. Setting a Postgres pool size to 1,000 was a massive mistake that just thrashed the OS scheduler and consumed RAM, easily visible on my `[Insert Process Memory Usage from Node Dashboard]`. 

More importantly, I would never write a line of code or install a shiny new library without measuring the system first. I learned more by running k6 benchmarks and explicitly analyzing the observability data in Grafana than I did writing any actual code. In the future, I will let the metrics dictate the architecture, rather than guessing what the bottleneck might be.
