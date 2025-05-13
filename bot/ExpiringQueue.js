const { Mutex } = require('async-mutex');
   
class ExpiringQueue {
    constructor(defaultExpiry) {
        this.queue = [];
        this.defaultExpiry = defaultExpiry;
        this.mutex = new Mutex();
        this.intervalId = setInterval(this.checkExpiry.bind(this), defaultExpiry*2);
    }

    async enqueue(value, expiry = this.defaultExpiry) {
        const release = await this.mutex.acquire();
        try {
            const expirationTime = Date.now() + expiry;
            const item = { value, expirationTime };
            this.queue.push(item);
        } finally {
            release();
        }
    }

    async dequeue() {
        const release = await this.mutex.acquire();
        try {
            await this.checkExpiry();
            if (this.queue.length === 0) {
                return null;
            }
            const item = this.queue.shift();
            return item.value;
        } finally {
            release();
        }
    }

    async popqueue() {
        const release = await this.mutex.acquire();
        try {
            await this.checkExpiry();
            if (this.queue.length === 0) {
                return null;
            }
            const item = this.queue.pop();
            return item.value;
        } finally {
            release();
        }
    }

    async checkExpiry() {
        const release = await this.mutex.acquire();
        try {
            const now = Date.now();
            while (this.queue.length > 0 && this.queue[this.queue.length-1].expirationTime <= now) {
                this.queue.pop();
            }
        } finally {
            release();
        }
    }

    getSize() {
        return this.queue.length;
    }

    stopExpiryCheck() {
        clearInterval(this.intervalId);
    }
}

// if (isMainThread) {
//     const queue = new ExpiringQueue(5, 5000);

//     // 模拟多线程操作
//     const numWorkers = 3;
//     for (let i = 0; i < numWorkers; i++) {
//         new Worker(__filename, { workerData: { workerId: i } });
//     }

//     // 主线程入队操作
//     setInterval(async () => {
//         await queue.enqueue(`Main-Item-${Date.now()}`);
//     }, 3000);

//     // 主线程出队操作
//     setInterval(async () => {
//         const dequeued = await queue.dequeue();
//         if (dequeued) {
//             console.log(`Main Dequeued: ${dequeued}`);
//         }
//     }, 2000);

// } else {
//     const { workerId } = workerData;
//     const queue = new ExpiringQueue(5, 5000);

//     // 工作线程入队操作
//     setInterval(async () => {
//         await queue.enqueue(`Worker-${workerId}-Item-${Date.now()}`);
//     }, 4000);

//     // 工作线程出队操作
//     setInterval(async () => {
//         const dequeued = await queue.dequeue();
//         if (dequeued) {
//             console.log(`Worker-${workerId} Dequeued: ${dequeued}`);
//         }
//     }, 2500);
// }