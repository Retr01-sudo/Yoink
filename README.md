# Yoink! 🛒⚡

A high-performance Node.js e-commerce backend engineered to expose, benchmark, and eliminate inventory race conditions under extreme spike load — simulating real-world flash sales with 1,000+ concurrent buyers.

**[📖 Read the Full Engineering Case Study](./docs/case-study.md)** — A detailed breakdown of how I broke this system with k6, uncovered silent data divergence under load, and evolved the architecture from naive CRUD to a resilient Redis + BullMQ event-driven system.

---

## 📋 Table of Contents

* [The Problem](#-the-problem)
* [Architecture Overview](#️-architecture-overview)
* [Features](#-features)
* [Tech Stack](#️-tech-stack)
* [Project Structure](#-project-structure)
* [Installation & Setup](#-installation--setup)
* [API Reference](#-api-reference)
* [Load Testing & Observability](#-load-testing--observability)
* [How It Works (Under the Hood)](#-how-it-works-under-the-hood)
* [Benchmarks](#-benchmarks)

---

## 🔥 The Problem

Flash sales are a perfect storm for distributed systems. When thousands of users simultaneously attempt to purchase the last few units of a product, naive implementations suffer from a classic read-modify-write race condition:

```text
Thread A: READ stock = 1   ─┐
Thread B: READ stock = 1   ─┤ Both threads see stock as available
Thread A: WRITE stock = 0  ─┤
Thread B: WRITE stock = 0  ─┘ Oversell — both purchases succeed!
```

This project was built to reproduce this failure in a controlled environment, measure its impact at scale, and implement a production-grade solution that guarantees inventory integrity without sacrificing throughput.

---

## 🏗️ Architecture Overview

The system evolved through three architectural generations, ultimately resulting in the highly resilient, event-driven design below.

```text
               (Incoming Requests)
                       │
                       ▼
         ┌───────────────────────────┐
         │     Express.js API        │
         │   (Rate Limiting, Auth)   │
         └───────┬───────────┬───────┘
      1. Lua     │           │ 2. Enqueue Job
      Decrement  │           │    (If Success)
                 ▼           ▼
      ┌─────────────┐     ┌─────────────┐
      │    Redis    │     │   BullMQ    │
      │   (Stock)   │     │   (Queue)   │
      └──────▲──────┘     └──────┬──────┘
             │                   │ 3. Process Job
             │                   ▼
             │            ┌─────────────┐
             │            │   Worker    │──── 4. Write to DB ────┐
             │            └──────┬──────┘       (Success)        │
             │                   │                               ▼
             │                   │ (Job Failed)           ┌──────────────┐
  5. Rollback│                   ▼                        │  PostgreSQL  │
   Stock     │            ┌─────────────┐                 │   (Orders)   │
             └────────────│ DLQ Worker  │                 └──────────────┘
                          └─────────────┘
```

**Request Lifecycle:**

1. Request hits the Express API, which validates input and checks rate limits.
2. A Lua script executes atomically in Redis — decrementing inventory only if `stock > 0`.
3. On success, the API returns `202 Accepted` immediately, and a BullMQ job is enqueued.
4. A background worker processes the job, safely persisting the order to PostgreSQL at a controlled rate (Concurrency: 5).
5. If the DB write fails permanently, a Dead Letter Queue (DLQ) worker rolls back the Redis decrement to prevent stock loss.

---

## 🚀 Features

* **Concurrency Control:** Solves the classic read-modify-write race condition using Redis as an atomic counter via a single-operation Lua script.
* **High Throughput:** The Redis + Lua layer decouples the hot path from slow PostgreSQL write latency, processing ~10,000 inventory decrements per second.
* **Asynchronous Processing:** Successful inventory claims are buffered as jobs in a BullMQ queue. Workers drain this queue at a controlled concurrency limit, entirely protecting the database from connection pool exhaustion (`P2037` errors).
* **Fault Tolerance & DLQ:** Implements a Dead Letter Queue pattern to prevent "ghost reservations." If a database write permanently fails, a DLQ worker issues a compensating Redis increment to restore the stock.
* **Full Observability:** Prometheus scrapes custom metrics (queue depth, Redis ops/s, HTTP latency), visualized on real-time Grafana dashboards.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| **Runtime** | Node.js | Async I/O, non-blocking concurrency |
| **Web Framework** | Express.js | HTTP API, middleware, routing |
| **Primary Database** | PostgreSQL | Durable order ledger, source of truth |
| **ORM** | Prisma | Type-safe DB access, migrations |
| **Cache / Atomic Ops** | Redis | Atomic inventory counter via Lua |
| **Job Queue** | BullMQ | Async DB write buffering, DLQ support |
| **Load Testing** | k6 | Spike load simulation, SLA assertions |
| **Observability** | Prometheus & Grafana | Time-series metrics & Dashboards |

---

## 📁 Project Structure

```text
yoink/
├── benchmarks/k6/        # k6 flash sale load test scripts
├── docs/                 # Full engineering case study
├── prisma/               # Database schema & migrations
├── scripts/              # Database seeder (products, stock)
├── src/
│   ├── config/           # Redis and Prisma client singletons
│   ├── jobs/             # BullMQ order worker and DLQ worker
│   ├── lua/              # Atomic inventory decrement script
│   ├── routes/           # Express controllers (products, orders)
│   └── app.js            # Express app entry point
└── docker-compose.yml    # Infrastructure orchestration
```

---

## 📦 Installation & Setup

### Prerequisites

* Node.js v18+
* Docker & Docker Compose
* k6 (for load testing)

### 1. Clone & Configure

```bash
git clone https://github.com/Retr01-sudo/Yoink.git
cd Yoink
cp .env.example .env
npm install
```

### 2. Spin Up Infrastructure

Start PostgreSQL, Redis, Prometheus, and Grafana:

```bash
docker-compose up -d
```

### 3. Migrate, Seed, and Run

```bash
# Apply database schema
npx prisma migrate dev

# Seed products and initial inventory levels
node scripts/seed.js

# Start the Express server
npm run dev
```

The API will be available at `http://localhost:3000`.

---

## 📡 API Reference

### `GET /products`

Returns a list of all seeded products with their current stock levels.

```json
[
  {
    "id": "clx1...",
    "name": "Limited Edition Sneaker",
    "price": 199.99,
    "stock": 500
  }
]
```

### `POST /orders`

**The Hot Path.** Attempts to purchase one unit. Executes the atomic Redis Lua script and enqueues a BullMQ job.

```json
{
  "productId": "clx1...",
  "userId": "usr_abc123"
}
```

* **202 Accepted:** Inventory claimed in Redis. Order job enqueued.
* **409 Conflict:** Stock exhausted. Purchase rejected.
* **429 Too Many Requests:** Rate limit exceeded.

---

## 📊 Load Testing & Observability

Run the k6 spike test to simulate a flash sale (requires database to be seeded first):

```bash
k6 run benchmarks/k6/yoink-spike.js
```

**Monitor the Chaos in Grafana:**
Navigate to `http://localhost:3001` (Credentials: `admin` / `admin`). Watch the real-time order throughput, Redis decrement rate, queue depth, and database write lag on the pre-built dashboards.

---

## 🔬 How It Works (Under the Hood)

### The Lua Script (Atomic Decrement)

The core concurrency solution is a Lua script executed in Redis. Because Redis is single-threaded, the script evaluates atomically. No two concurrent requests can interleave and read `stock = 1` simultaneously.

```lua
-- src/lua/decrement.lua
local stock = tonumber(redis.call('GET', KEYS[1]))

if stock == nil then
  return -2  -- Product not found in cache
end

if stock <= 0 then
  return -1  -- Out of stock
end

redis.call('DECR', KEYS[1])
return stock - 1
```

### The DLQ Rollback Flow

If the database write fails, we must ensure the item isn't permanently lost from inventory.

```text
 ┌─────────────────┐
 │   BullMQ Job    │
 └────────┬────────┘
          │
          ▼
 ┌─────────────────┐
 │  Worker DB Try  │──(Success)──► Postgres Order Saved
 └────────┬────────┘
          │
      (Failure) 
          │
          ▼
 ┌─────────────────┐
 │  Retries (x3)   │
 └────────┬────────┘
          │
    (Exhausted)
          ▼
 ┌─────────────────┐
 │   DLQ Worker    │
 │ redis.incr(id)  │──► Compensating Rollback (Redis Stock Restored)
 └─────────────────┘
```

---

## 📈 Benchmarks

Results from a representative k6 spike run (1,000 VUs, 30s ramp-up, 60s peak) comparing the initial naive approach to the final architecture:

| Metric | Naive CRUD (V1) | Redis + BullMQ (Final) |
| --- | --- | --- |
| **Oversell events** | ~3,400 units | **0** |
| **P95 latency** | 1,240 ms | **48 ms** |
| **Throughput (peak)** | ~310 req/s | **~9,800 req/s** |
| **DB connection errors** | Frequent (`P2037`) | **None** |
| **5xx error rate** | 18% | **< 0.1%** |

---

## 📄 License

MIT © Retr01-sudo
