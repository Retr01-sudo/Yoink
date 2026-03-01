# How I Broke My Flash Sale Backend (And Fixed It): A Yoink! Case Study

I built a Node.js e-commerce backend called Yoink! to simulate what happens during a massive flash sale. The goal was simple: handle 1,000 concurrent users trying to buy a product at the exact same millisecond without overselling.

To do this right, I knew I needed robust testing and observability. I used **k6** to simulate the concurrent load (Virtual Users or VUs), **Prometheus** to scrape application metrics, and **Grafana** to visualize everything. 

It sounds easy until you actually load test it. I learned the hard way that a system working perfectly for five users will completely collapse under a spike. Here is the step-by-step evolution of my architecture, the infrastructure hurdles I faced, and why I had to keep rebuilding.

## Early Infrastructure Hurdles

Before I even got to the race conditions, I had to figure out how to observe them. This taught me a lot about networking and middleware:

**The Docker Firewall Trap:** I deployed my app and Prometheus in Docker containers, but Prometheus couldn't reach my `/metrics` endpoint. After hours of scanning logs, I finally checked `ufw` and `nftables` rules. The host firewall was actively blocking connections from the `docker-compose` network. I had to add the Docker subnet as an exception in `ufw`. This was a major "aha" moment for me regarding Docker—I learned exactly how Docker network isolation works under the hood and why you shouldn't just lazily bind everything to the host network.

**The Case of the Missing Metrics:** Once I got Prometheus scraping, I noticed a frustrating issue in Grafana. When a request threw an error and hit my Express global error handler, the origin path was erased. All my errors were being lumped together as untagged 500s or 400s; I couldn't tell which route was failing. I fixed this by writing a custom metrics middleware that explicitly saved the original path to the request object *before* it hit any controllers, ensuring Prometheus could properly tag the route even if the request exploded later.

With observability finally in place, I started load testing.

---

## V1: The Naive Implementation

<img width="2000" height="624" alt="image" src="https://github.com/user-attachments/assets/d06b4058-789d-4de4-98ec-0b15c7dfdec3" />

**What I built:** I started with the standard CRUD logic every developer learns first. Read the stock from Postgres, check if it's greater than 0, decrement the stock, and insert an order record. The architecture is dead simple: every request hits the Node.js server, which talks directly to Postgres with separate read and write queries.

**What broke:** I ran a k6 benchmark firing 1,000 concurrent users at the buy endpoint simultaneously. Before showing you the results, here's what the database looked like going in — 5,000 units of stock:

<img width="958" height="218" alt="Database before testing: product has 5000 stock" src="https://github.com/user-attachments/assets/20c060ab-c929-4f71-b9db-ddd06bfeffe3" />

The load test ran, and Grafana showed me just how much traffic the server was absorbing. This is the total confirmed orders over the test duration:

<img width="1864" height="903" alt="Grafana: total orders processed during V1 test — confirmed orders climbed far beyond the available 5000 stock" src="https://github.com/user-attachments/assets/55165ef6-f8ca-4823-99ad-1963e1b3c57b" />

The order count kept climbing — well past 5,000. But why? This graph shows what was happening under the hood. The p95 latency spiked and then 500 errors began flooding in:

<img width="1861" height="906" alt="Grafana: p95 latency — high latency followed by a wave of 500 errors" src="https://github.com/user-attachments/assets/b0f62595-30f2-4805-a3f7-980894dd22db" />

The errors weren't random — they had a specific cause. The database connection pool was being completely exhausted:

<img width="950" height="694" alt="Grafana: 500 errors with reason — connection pool exhaustion (too many clients)" src="https://github.com/user-attachments/assets/9a599da8-661a-4943-b136-55005791e805" />

With 1,000 requests hammering the server simultaneously, the Postgres connection pool ran out of available connections. Requests that couldn't get a connection failed with 500s, while the ones that *did* get through raced each other to read and write the stock value. This is the API throughput during that chaos:

<img width="1867" height="907" alt="Grafana: API requests per second during V1 — high initial throughput collapsing as the connection pool died" src="https://github.com/user-attachments/assets/5d433e3d-e768-4f2f-b062-cfbdb9570011" />

The confirmation of the damage came after the test. 5,000 units of stock, but the database now showed 2,851 remaining — and the order table had **28,486 confirmed orders**:

<img width="955" height="216" alt="Database after testing: 2851 stock remaining, but 28000+ orders were confirmed — catastrophic overselling" src="https://github.com/user-attachments/assets/7900de36-b944-4ece-a062-ed7f537e9c95" />

This is a classic **read-modify-write race condition**. Thousands of requests hit the database simultaneously, each read the stock as `> 0`, and each fired off a decrement. Postgres had no coordination between those concurrent reads — by the time any single request wrote its decrement, dozens of others had already read the same stale value and decided it was safe to proceed.

The full k6 summary confirms the extent of the failure:

<img width="1891" height="1141" alt="k6 test results for V1: high request counts, significant error rates, and no meaningful rate limiting" src="https://github.com/user-attachments/assets/8a12e6bf-8441-47fa-bc74-f93132ad9f0a" />

**What I learned:** Correctness under concurrency requires atomicity. If you read a value and write it back in separate, unisolated operations, you *will* oversell under load.

---

## V2: Atomic DB Transactions

<img width="2000" height="777" alt="image" src="https://github.com/user-attachments/assets/02fd3ee2-5e59-4540-b5f5-b508cd4590ad" />

**What I built:** I pushed the concurrency control down to the database. I swapped the separate read and write queries for a single Prisma `updateMany` operation with a `WHERE stock >= 1` clause. This enforces atomicity at the DB engine level — the read and decrement happen in one indivisible operation, so there's no window for another request to sneak in between them.

**Did it fix overselling?** Yes. Here's the database before the test — again 5,000 units:

<img width="955" height="216" alt="Database before V2 testing: 5000 stock" src="https://github.com/user-attachments/assets/ee2243e4-6afd-47b5-bf18-a0840a9b6395" />

And after the test, stock hit exactly 0, with exactly 5,000 confirmed orders. No more overselling:

<img width="961" height="219" alt="Database after V2 testing: 0 stock remaining, exactly 5000 orders — overselling is solved" src="https://github.com/user-attachments/assets/4183b779-371a-40f3-a797-0ffb05ecb096" />

**But a new problem emerged — performance.** Look at the total orders graph. There's a large spike of failed orders alongside the 5,000 successful ones:

<img width="1846" height="905" alt="Grafana: total orders during V2 — 5000 successful orders and a large volume of failures" src="https://github.com/user-attachments/assets/3ab04244-eace-45c4-a257-9e99cb48cad3" />

Those failures aren't bugs — they're expected "out of stock" rejections as the inventory ran out. This graph confirms it: failed orders (404s) spiked exactly as 500 errors disappeared, meaning the server was correctly refusing requests once stock hit 0:

<img width="1858" height="904" alt="Grafana: error breakdown — 404 out-of-stock errors replaced 500 connection errors, confirming correct behavior" src="https://github.com/user-attachments/assets/91f7254f-f189-4c63-9701-c46faad48bc9" />

The real cost shows up in latency. When stock was still available and 1,000 users were fighting for a DB connection to run that atomic update, contention was extreme. The p95 latency peaked above **476ms** — and ironically, it only dropped *because* the stock ran out and the server stopped hitting the database entirely for out-of-stock requests:

<img width="1851" height="911" alt="Grafana: p95 latency in V2 — latency drops sharply once stock is exhausted and DB writes stop" src="https://github.com/user-attachments/assets/2ff1ab24-444a-4b1c-b53c-924011ac5829" />

The throughput tells the same story — the server handles the burst, but it's clearly straining:

<img width="1856" height="903" alt="Grafana: API requests per second during V2 — throughput held but latency was high during the inventory window" src="https://github.com/user-attachments/assets/678b1178-bbf8-46c5-a4d0-10151ca2336f" />

The k6 summary confirms the tradeoff: correctness achieved, but at significant latency cost during peak contention:
<img width="1886" height="1128" alt="image" src="https://github.com/user-attachments/assets/d2351ddb-7d66-4174-9e21-737aad1ee94f" />

**What I learned:** Correctness isn't enough. A correct system that can't handle load isn't production-ready. The database is the bottleneck — and pushing harder on it just makes things worse.

---

## V3 (Initial): Redis + Lua

<img width="2000" height="679" alt="V3 Initial Architecture: Client → Node.js → Redis (Lua atomic decrement) → if success → synchronous Postgres write" src="https://github.com/user-attachments/assets/1764419f-4e15-4557-a744-a649bb523acd" />

**What I built:** Postgres was the bottleneck in V2, so I moved inventory management out of it entirely. Instead of asking Postgres to coordinate concurrent decrements under load, I wrote a Lua script that atomically decrements the stock counter directly in Redis. Redis processes operations sequentially on a single thread — no race conditions, no lock contention, around 10,000 ops/second. Once the Lua script confirmed a successful decrement, the service made a synchronous write to Postgres to persist the order record.

The split of responsibilities: Redis owns the fast, conflict-free inventory check. Postgres just stores the receipts.

**A false sense of success**

My first serious test was 1,000 VUs against a flash sale with scarce stock — a few thousand units. It *worked*. No 500s, clean error rates, latency well below 500ms. I thought I'd finally solved it.

But there was a hidden reason it worked, and it had nothing to do with the architecture being correct. When stock ran out, the Lua script returned early and the server sent a 404 *without ever touching Postgres*. With scarce stock, the vast majority of requests hit the out-of-stock path and bypassed the database entirely — so the connection pool never got overwhelmed. The test looked healthy because most traffic never reached the bottleneck.

**What actually broke**

As soon as I bumped inventory to 10,000,000 units — enough that a large proportion of requests would succeed and each need a DB write — the system fell apart. Prisma started throwing `P2037`:

```text
Too many database connections opened: sorry, too many clients already
```

Redis was clearing the inventory check so fast that all 1,000 requests arrived at the Postgres write simultaneously. The connection pool had nowhere near enough capacity, and the server flooded with 500s — ironically *because* Redis was too fast.

**The bug I'm most proud of finding**

The 500 errors were embarrassing, but they weren't the real problem. The real problem was what the crash *caused silently*.

Here's the database going into the test — 10,000,000 units of stock:

<img width="951" height="216" alt="Database before V3 initial test: 10,000,000 stock" src="https://github.com/user-attachments/assets/53f5ee52-e519-4231-9002-5c8b7702d57f" />

After the test finished, I checked two things. The Redis stock counter read `9,967,138` — meaning Redis believed **32,862 units** had been sold. Then I ran:

```sql
SELECT count(*) FROM "Order";
```

Postgres had only recorded **26,261 orders**. Redis said 32,862 sales. Postgres only knew about 26,261 of them.

**6,601 units were sold, decremented, and permanently unrecorded.**

Here's exactly what happened: the Lua script decremented Redis first — that always succeeded instantly. Then the handler attempted the Postgres write. When the connection pool was exhausted, that write threw an error and returned a 500 to the client. But the Redis decrement had *already happened* with no rollback and no retry queued. The stock was gone from Redis. The order record was never created. From the customer's perspective their purchase failed. From the inventory's perspective, the unit was sold.

| | Units sold (Redis) | Orders recorded (Postgres) |
|---|---|---|
| Expected | 32,862 | 32,862 |
| Actual | 32,862 | 26,261 |
| **Divergence** | — | **6,601 permanently lost** |

The error rate graph shows exactly when Postgres started buckling — each spike is a batch of writes that failed after Redis had already committed the corresponding decrements:

<img width="1858" height="901" alt="Grafana: 500 error rate during V3 initial — each spike is Postgres writes failing after Redis already decremented stock, with no compensation" src="https://github.com/user-attachments/assets/65fe4db4-d6c5-46c6-897d-d98677d01595" />

While those writes were failing, requests were blocking on a DB connection that would never arrive — which shows up as p95 latency climbing in lockstep with the error spikes:

<img width="1864" height="910" alt="Grafana: p95 latency during V3 initial — rises alongside 500 errors as threads pile up waiting on Postgres connections that are exhausted" src="https://github.com/user-attachments/assets/dd121b00-bcc6-421a-901c-319b9b4ed360" />

After the test, the database tells the whole story. Redis at `9,967,138`, Postgres with records for only `26,261` orders — 6,601 units decremented in Redis with no trace anywhere in the order table:

<img width="950" height="220" alt="Database after V3 initial: Redis stock = 9,967,138 but Postgres only has 26,261 orders — 6,601 units consumed but never recorded" src="https://github.com/user-attachments/assets/16a1ac27-9d80-487f-8804-4877130d0d0f" />

The full k6 summary shows the error rate that produced this divergence. These weren't just failed requests — each 500 here is an inventory unit that was consumed and silently discarded:

<img width="1892" height="1142" alt="k6 test results for V3 initial: significant error rate under 1000 VU load with abundant stock — each error is a permanently lost order record" src="https://github.com/user-attachments/assets/35cf652d-4a5b-447e-9bb8-7e1110e844f8" />

This is what made V3 Initial dangerous rather than just broken. It passed my initial tests because scarce stock masked the bottleneck. It only failed when the conditions changed. A system that silently loses data under specific load conditions is far harder to catch than one that crashes outright — and far more damaging if it ever reaches production.

The root cause was architectural: I coupled a fast, non-blocking operation (Redis decrement) directly to a slow, failure-prone one (Postgres write) in the same synchronous request cycle. If the slow step failed, there was no way back. That's what needed to change.

**What I learned:** A fast system that loses data silently is worse than a slow system that doesn't. And a system that only works under the right conditions isn't a working system — it's a bug waiting for the conditions to change.

---

## V3 (Improved): Redis + BullMQ Message Queue

*[Placeholder: Insert V4/Improved V3 Architecture Diagram Image here. Flow: Client -> Node.js -> Redis (Lua decrement) -> Push to BullMQ -> Return 202 to Client -> Worker pulls from Queue -> Safely Writes to Postgres]*

**What I built:** To bridge the gap between fast Redis and slow Postgres, I improved V3 by introducing a message queue using BullMQ. 

Now, the Lua script decrements Redis, but instead of writing to Postgres synchronously, I push a job to BullMQ and immediately return a 202 status code. I set up a worker process with a strict concurrency limit of 5. The worker pulls jobs off the queue and writes the orders safely to Postgres.

**Why it worked:** BullMQ acts as a buffer. The worker concurrency of 5 means we never exhaust the database connection pool—`P2037` errors disappeared entirely. My Node.js Active Handlers stayed completely stable at `[Insert Active Handlers count from Node.js Dashboard when testing V3 with MQ]`. 

If a transient error occurs, the job retries. Most importantly, if a job fails permanently after exhausting all retries, a Dead Letter Queue (DLQ) worker takes that failed job and increments the Redis stock back by 1, totally eliminating the data divergence.

## What I'd Do Differently If I Started Over

If I started this project over, I wouldn't assume that more database connections equal more throughput. Setting a Postgres pool size to 1,000 was a massive mistake that just thrashed the OS scheduler and consumed RAM, easily visible on my `[Insert Process Memory Usage from Node Dashboard]`. 

More importantly, I would never write a line of code or install a shiny new library without measuring the system first. I learned more by running k6 benchmarks and explicitly analyzing the observability data in Grafana than I did writing any actual code. In the future, I will let the metrics dictate the architecture, rather than guessing what the bottleneck might be.
