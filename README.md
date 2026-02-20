# Yoink! 🛒🏃‍♂️

> Demonstrating and solving race conditions in e-commerce inventory systems. 50 users, 1 item—watch it break, then fix it with Redis Lua atomic operations.

## Overview
Yoink! is an educational e-commerce backend built with Node.js, Express, and PostgreSQL (via Prisma). It is specifically designed to demonstrate the inherent dangers of concurrent transactions without proper locking mechanisms—commonly known as race conditions or "overselling". 

The current state of the application contains a deliberate flaw in the `buyItem` logic. When multiple users attempt to buy the last remaining stock simultaneously, they will all verify that `stock > 0`, and the database will incorrectly decrement the stock multiple times, leading to negative inventory.

## Technologies Used
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL (accessed via Prisma ORM)
- **Caching/Locking:** Redis (for future atomic operations)
- **Monitoring:** Prometheus (`prom-client`)

## Project Structure
- `src/app.js` & `src/server.js`: Core Express application setup and server entry point.
- `src/routes/`: Express route definitions (`/buy`, `/health`, `/metrics`).
- `src/controllers/`: Handle HTTP requests and responses.
- `src/services/`: Core business logic. **The race condition vulnerability lives in `src/services/buy.service.js`.**
- `src/config/`: Configuration for Database and Redis clients.
- `docker-compose.yml`: Spins up the necessary infrastructure (PostgreSQL, Redis, Redis Commander).

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [Docker](https://www.docker.com/) & Docker Compose

### 1. Start Infrastructure
Start the PostgreSQL and Redis containers using Docker Compose.
```bash
docker compose up -d
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup the Database
Ensure your `.env` file is set up correctly with `DATABASE_URL` pointing to the local Postgres container.
Run Prisma migrations to create the database schema:
```bash
npx prisma migrate dev
```

### 4. Start the Application
Run the development server in watch mode:
```bash
npm run dev
```
The server will be available at [`http://localhost:3000`](http://localhost:3000).

## API Endpoints
- `GET /health` - Returns the health status of the application and its connection to the database/redis.
- `GET /metrics` - Exposes Prometheus metrics (e.g., HTTP request latency, total orders, stock levels).
- `POST /buy` - Core endpoints to simulate buying an item.
  - **Payload:** `{ "userId": 1, "productId": 1 }`

## The Educational Challenge 💥
Inspect `src/services/buy.service.js`. The logic fetches the `stock`, checks if it's $>0$, and then subtracts 1. 
Try firing 50 concurrent requests at the `/buy` endpoint targeting a single product with a starting stock of 1. You will observe the stock drop below zero, successfully demonstrating an e-commerce race condition!

**How to fix it:**
Replace the standard read-then-write logic with an atomic mechanism:
1. **Redis Lua Scripts:** Ensure atomic decrements in memory.
2. **Database Row Locks:** Use `SELECT ... FOR UPDATE` to exclusively lock the row during the transaction.
