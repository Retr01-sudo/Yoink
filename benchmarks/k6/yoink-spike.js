import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';


const productData = JSON.parse(open('./data.json')).product;
// --- 1. Load User Data ---
// Loads the JSON file created by your seeding script exactly once into memory
const testData = new SharedArray('Database IDs', function () {
    const fileContent = JSON.parse(open('./data.json'));
    return fileContent.userIds;
});

// --- 2. Define Custom k6 Metrics ---
const successfulBuys = new Counter('k6_successful_buys');
const outOfStock = new Counter('k6_out_of_stock');
const serverErrors = new Counter('k6_server_errors');
const yoinkLatency = new Trend('k6_yoink_req_duration'); // Outside view of latency

// --- 3. Test Configuration (The Spike) ---
export const options = {
    scenarios: {
        flash_sale_spike: {
            executor: 'ramping-arrival-rate',

            // requests per second
            startRate: 50,
            timeUnit: '1s',

            // controls how many VUs k6 can allocate dynamically
            preAllocatedVUs: 200,
            maxVUs: 2000,

            stages: [
                { target: 300, duration: '5s' },   // explosive ramp
                { target: 1000, duration: '10s' }, // flash-sale spike
                { target: 1000, duration: '30s' }, // sustained chaos
                { target: 100, duration: '5s' },   // taper down
                { target: 0, duration: '5s' },     // cooldown
            ],
        },
    },

    thresholds: {
        'http_req_failed': ['rate<0.01'],
        'k6_yoink_req_duration': ['p(95)<500'],
    },
};

// --- 4. The Virtual User Logic ---
export default function () {

    const userIndex = (exec.vu.idInTest - 1) % testData.length;
    const userId = testData[userIndex];

    const productId = productData.id;

    const payload = JSON.stringify({
        userId: userId,
        productId: productId
    });

    const params = {
        headers: {
            'Content-Type': 'application/json',
            'X-Test-Client': 'k6-spike', // Helpful for filtering these in backend logs
        },
        tags: { name: 'YoinkEndpoint' }, // Tags the request for cleaner k6 output
    };

    // The precise moment the user tries to grab the item
    const res = http.post('http://localhost:3000/api/v3/buy', payload, params);

    // Track the client-side latency
    yoinkLatency.add(res.timings.duration);

    // --- 5. Categorize the Chaos ---
    if (res.status === 200 || res.status === 201) {
        successfulBuys.add(1);
    } else if (res.status === 400 || (res.body && res.body.includes('stock'))) {
        outOfStock.add(1);
    } else {
        serverErrors.add(1);
    }

    // --- 6. Sanity Checks ---
    check(res, {
        'System did not crash (not 5xx)': (r) => r.status < 500,
    });

    // Tiny sleep to prevent a tight loop if a VU finishes early during the hold phase
    sleep(0.5);
}
