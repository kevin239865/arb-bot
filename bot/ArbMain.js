const {Connection, Keypair, PublicKey} = require("@solana/web3.js");
const bs58 = require('bs58');
const CryptoJS = require("crypto-js");
const readline = require('readline');
const {Command} = require('commander');
const {Worker, workerData} = require("worker_threads");

const TOKENS = [];
const WORKERS = [];

/**
 * 初始化
 * @returns {Promise<void>}
 */
async function init() {
    const program = new Command();
    program
        .option('--name <name>', 'name')
        .option('--host <host>', '地址', 'http://localhost:9000')
        .option('--enable_flash_loan <enable_flash_loan>', '启用闪电贷', 'false')
        //.option('--client <client>', '客户端地址')
        .option('--amount <amount>', '输入SOL数量', '1')
        .option('--threshold <threshold>', '最小机会大小', '100000')
        .option('--redis <redis>', 'redis', '127.0.0.1')
        .option('--redis_pass <redis_pass>', 'redis pass')
        .option('--rpc <rpc>', 'rpc', 'https://solana-rpc.publicnode.com')
        .option('--tokens <tokens>', '输入 mints, 逗号分隔')
        // .option('--trade_size <trade_size>', '交易大小', '0.5+1:100000')
        .option('--jito_tip <jito_tip>', '小费比例', '0')
        .option('--jito_region <jito_region>', 'jito 区域', 'frankfurt')
        .option('--jito_uuid <jito_uuid>', 'jito uuid')
        .option('--max_tip <max_tip>', 'max_tip', '10000000')
        .option('--only_direct_routes <only_direct_routes>', 'onlyDirectRoutes', 'false')
        .option('--max_accounts <max_accounts>', 'maxAccounts', '24')
        .option('--privateKey <privateKey>', '加密私钥')
        .option('--localAddress <localAddress>', '发送jito的localaddress')
        .option('--nginx_server <nginx_server>', '发送jito的nginx server');

    program.parse(process.argv);
    const options = program.opts();

    // 客户端
    const CLIENT_SERVER = options.client;
    // if(CLIENT_SERVER === undefined || CLIENT_SERVER.split(',').length === 0) {
    //     throw new Error('--client 客户端地址为空')
    // }
    if(CLIENT_SERVER) {
        console.log(`客户端: ${CLIENT_SERVER.split(',').map(host =>  `http://${host}`)}`)
    }

    // localAddress
    const LOCALADDRESS = options.localAddress;
    if(LOCALADDRESS) {
        console.log(`发送localaddress: ${LOCALADDRESS.split(',').map(host => `${host}`)}`)
    }

    const NGINX_SERVER = options.nginx_server;
    if(NGINX_SERVER) {
        console.log(`发送nginx_server: ${NGINX_SERVER.split(',').map(host => `http://${host}`)}`)
    }


    // JUP 默认地址
    const JUPITER_HOST = options.host;

    // REDIS
    const REDIS_HOST = options.redis;
    const REDIS_PASS = options.redis_pass;

    // 交易大小
    // const TRADE_SIZE = options.trade_size;
    // console.log(`交易头寸: ${TRADE_SIZE}`)

    // MAX TIP
    const MAX_TIP = Number(options.max_tip)

    // 套利 MINTS
    options.tokens.split(',').forEach(token => TOKENS.push(token));

    // JITO 小费比例
    const JITO_TIP_BPS = Number(options.jito_tip);
    // JITO REGION
    const JITO_REGION = options.jito_region;
    // JITO UUID
    const JITO_UUID = options.jito_uuid;

    // JUP ONLY_DIRECT_ROUTES
    const JUP_ONLY_DIRECT_ROUTES = options.only_direct_routes
    // JUP_MAX_ACCOUNTS
    const JUP_MAX_ACCOUNTS = options.max_accounts

    // 钱包私钥加密
    const PRIVATE_KEY = options.privateKey;

    // 输入解密
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    const key = await new Promise((resolve) => {
        rl.question("输入密钥:", (input) => {
            rl.close();
            resolve(input); // 返回用户的输入
        });
    });


    const keypair = Keypair.fromSecretKey(bs58.decode(CryptoJS.AES.decrypt(PRIVATE_KEY, key).toString(CryptoJS.enc.Utf8)));
    console.log(`钱包地址: ${keypair.publicKey.toBase58()}`);


    // 初始化 ATA 账户
    const connection = new Connection(options.rpc, "confirmed");
    const tokenResp = await connection.getTokenAccountsByOwner(keypair.publicKey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });
    const ATA_LIST = [];
    for (const {pubkey} of tokenResp.value) {
        ATA_LIST.push(pubkey.toBase58())
    }

    const AMOUNT = options.amount;
    const THRESHOLD = options.threshold;
    const NAME = options.name;
    const ENABLE_FLASH_LOAN = options.enable_flash_loan;

    return {
        key,
        walletKey: bs58.encode(keypair.secretKey),
        RPC: options.rpc,
        NAME,
        ENABLE_FLASH_LOAN,
        AMOUNT,
        THRESHOLD,
        MAX_TIP,
        CLIENT_SERVER,
        JUPITER_HOST,
        // TRADE_SIZE,
        REDIS_HOST,
        REDIS_PASS,
        ATA_LIST,
        JUP_ONLY_DIRECT_ROUTES,
        JUP_MAX_ACCOUNTS,
        JITO_TIP_BPS,
        JITO_REGION,
        JITO_UUID,
        LOCALADDRESS,
        NGINX_SERVER
    }

}


/**
 * 执行入口。
 * @returns {Promise<void>}
 */
async function main() {
    const workerData = await init();

    console.log('TOKENS:', TOKENS.toString());

    TOKENS.forEach((token) => {
        const arbWorker = new Worker('./ArbWorker.js', {
            workerData: {
                token,
                ...workerData
            }
        });
        arbWorker.on('message', async message => {
            const {text} = message;
            console.log(text)
        });
        arbWorker.on('error', (err) => {
            console.error(err);
        });
        WORKERS.push(arbWorker)
    });
}

main().then();