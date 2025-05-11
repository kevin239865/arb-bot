const { parentPort, workerData } = require('worker_threads');
const axios = require("axios");
const bs58 = require('bs58');
const http = require('http');
const https = require('https');
const redis = require("redis");
const { Mutex } = require('async-mutex');
const { dateFormat } = require("./Tools");


//const inputToken = {symbol: 'SOL', address: 'So11111111111111111111111111111111111111112', decimals: 9};
const AMOUNT = Number(workerData.AMOUNT);
//const inAmount = Math.floor(AMOUNT * Math.pow(10, inputToken.decimals)); // 1 SOL 询价
const JITO_REGION = workerData.JITO_REGION;
const JITO_UUID = workerData.JITO_UUID;
const JITO_URLS = JITO_REGION.split(',').map(region => {
    return JITO_UUID ? `https://${region}.mainnet.block-engine.jito.wtf/api/v1/bundles?uuid=${JITO_UUID}` : `https://${region}.mainnet.block-engine.jito.wtf/api/v1/bundles`
});

const LOCALADDRESS = workerData.LOCALADDRESS;
const STATISTICAL_INTERVAL = workerData.STATISTICAL_INTERVAL;

const LOCALADDRESS_LIST = LOCALADDRESS ? LOCALADDRESS.split(','): [];
class SendCounter {
    constructor(address, interval) {
        this.address = address;
        this.interval = interval;
        this.opportunity = 0;
        this.sendCount = 0;
        this.quoteTime = 0;
        this.swapInstTime = 0;
        this.instructionTime = 0;
        this.sendTime = 0;
        this.sendErr = 0;
        this.send429Err = 0;
        this.send400Err = 0;
        this.mutex = new Mutex();
        this.intervalId = setInterval(this.refresh.bind(this), interval * 1000);
    }

    async addOpportunity(quoteTime, swapInstTime, instructionTime) {
        const release = await this.mutex.acquire();
        try {
            this.opportunity++;
            this.quoteTime = this.quoteTime + quoteTime;
            this.swapInstTime = this.swapInstTime + swapInstTime;
            this.instructionTime = this.instructionTime + instructionTime;
        } finally {
            release();
        }
    }

    async addInstructionTime(time) {
        const release = await this.mutex.acquire();
        try {
            this.instructionTime = this.instructionTime + time;
        } finally {
            release();
        }
    }

    async addSendTime(time) {
        const release = await this.mutex.acquire();
        try {
            this.sendCount++;
            this.sendTime = this.sendTime + time;
        } finally {
            release();
        }
    }

    async addSendErr(error) {
        const release = await this.mutex.acquire();
        try {
            this.sendErr++;
            this.sendCount++;
            if (error && error.response && error.response.status == "429") {
                this.send429Err++;
            } else if (error && error.response && error.response.status == "400") {
                this.send400Err++;
            }
        } finally {
            release();
        }
    }

    async refresh() {
        const release = await this.mutex.acquire();
        try {
            const logs = [];
            const totalTime = this.quoteTime + this.swapInstTime + this.instructionTime + this.sendTime;
            logs.push('------------------------------------------------------------------------------------------------------------');
            logs.push(`地址：${this.address} | 统计时间: ${dateFormat("YYYY-mm-dd HH:MM:SS.ms", new Date())} | 统计周期：${this.interval} s | 交易大小: ${AMOUNT} `);
            if (this.opportunity > 0) {
                logs.push(`机会: ${this.opportunity} | 总耗时: ${(totalTime / 1e6).toFixed(2)} ms | 获取机会: ${(this.quoteTime / 1e6).toFixed(2)} ms | 生成指令: ${(this.swapInstTime / 1e6).toFixed(2)} ms | 构建交易: ${(this.instructionTime / 1e6).toFixed(2)} ms | 发送交易: ${(this.sendTime / 1e6).toFixed(2)} ms `);
                logs.push(`平均耗时: ${(totalTime / this.opportunity / 1e6).toFixed(2)} ms | 获取机会: ${(this.quoteTime / this.opportunity / 1e6).toFixed(2)} ms | 生成指令: ${(this.swapInstTime / this.opportunity / 1e6).toFixed(2)} ms | 构建交易: ${(this.instructionTime / this.opportunity / 1e6).toFixed(2)} ms | 发送交易: ${(this.sendTime / this.opportunity / 1e6).toFixed(2)} ms `);
                logs.push(`发送次数: ${this.sendCount} | 发送成功: ${this.sendCount - this.sendErr} | 429错误: ${this.send429Err} | 400错误:  ${this.send400Err} `);
            } else {
                logs.push('------------------------------------------------------------------------------------------------------------');
                logs.push(`地址：${this.address} 未获取到任何数据 | 统计时间: ${dateFormat("YYYY-mm-dd HH:MM:SS.ms", new Date())} | 统计周期：${this.interval} s`);
            }
            console.log(logs.join('\n'));
            logs.length = 0;
            this.opportunity = 0;
            this.sendCount = 0;
            this.quoteTime = 0;
            this.swapInstTime = 0;
            this.instructionTime = 0;
            this.sendTime = 0;
            this.sendErr = 0;
            this.send429Err = 0;
            this.send400Err = 0;
        } finally {
            release();
        }
    }

}


const LOCALADDRESSMAP = new Map();
// 启用LOCALADDRESS
if (LOCALADDRESS_LIST.length > 0) {

    const sendCounter = new SendCounter(LOCALADDRESS_LIST.length, STATISTICAL_INTERVAL);
    LOCALADDRESS_LIST.forEach(localAddress => {
        if (localAddress) {
            const proxyAgent = {
                httpAgent: new http.Agent({
                    keepAlive: true,
                    maxSockets: 10,
                    localAddress: localAddress
                }),
                httpsAgent: new https.Agent({
                    keepAlive: true,
                    maxSockets: 10,
                    localAddress: localAddress
                })
            }
            const axiosInstance = axios.create({
                ...proxyAgent,
                timeout: 500,
                timeoutErrorMessage: "Request Timeout"
            });
            LOCALADDRESSMAP.set(localAddress, { axiosInstance, sendCounter });
        }
    });
} else {
    const localAddress = "localhost";
    LOCALADDRESS_LIST.push(localAddress);
    const proxyAgent = {
        httpAgent: new http.Agent({
            keepAlive: true,
            maxSockets: 10
        }),
        httpsAgent: new https.Agent({
            keepAlive: true,
            maxSockets: 10
        })
    }
    const axiosInstance = axios.create({
        ...proxyAgent,
        timeout: 500,
        timeoutErrorMessage: "Request Timeout"
    });

    const sendCounter = new SendCounter(localAddress, STATISTICAL_INTERVAL);
    LOCALADDRESSMAP.set(localAddress, { axiosInstance, sendCounter });
}

let localAddressIndex = 0;

function getNextLocaladdressIndex() {
    const next = localAddressIndex;
    localAddressIndex = (localAddressIndex + 1) % LOCALADDRESS_LIST.length;
    return next;
}





// 本地直接发送给 JITO
async function sendTransactionToJITO(quoteTime,swapInstTime,instructionTime,transactions) {

    const index = getNextLocaladdressIndex();
    const axiosInstance = LOCALADDRESSMAP.get(LOCALADDRESS_LIST[index]).axiosInstance;
    const sendCounter = LOCALADDRESSMAP.get(LOCALADDRESS_LIST[index]).sendCounter;
    sendCounter.addOpportunity(quoteTime,swapInstTime,instructionTime);
    const body = {
        id: 1,
        jsonrpc: "2.0",
        method: "sendBundle",
        params: transactions,
    }

    try {
        for (const url of JITO_URLS) {
            const sendStart = process.hrtime();
            axiosInstance.post(url, body).then(result => {
                const sendEnd = process.hrtime(sendStart);
                sendCounter.addSendTime(sendEnd[1]);
                // console.log(`发送: ${(sendEnd[1] / 1e6).toFixed(3)} ms - Region: ${url} - BundleId: ${result.data.result}`);
            }).catch(error => {
                
                sendCounter.addSendErr(error);
                if (error && error.response && error.response.status == "429") {

                } else if (error && error.response && error.response.status == "400") {

                }else {
                    console.log(error);
                }
            });
        }
    } catch (error) {
        // console.error(`Error Status: ${error.response.status} - ${error.response.data.error.message}`);
    }
}

parentPort.on('message', async (task) => {
    try {
        await sendTransactionToJITO(task.quoteTime, task.swapInstTime,task.instructionTime, task.transactions);
    } catch (error) {
        console.error(error);
    }
});

// async function main() {
//     const redis_options = {
//         socket: {
//             host: REDIS_HOST,
//             port: 6379
//         },
//     }
//     if (REDIS_PASS) {
//         redis_options.password = REDIS_PASS;
//     }

//     redisClient = redis.createClient(redis_options);
//     // 连接到 Redis
//     await redisClient.connect();



// }

// main().then();