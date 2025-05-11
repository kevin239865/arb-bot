const {Keypair, ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction, SystemProgram, AddressLookupTableAccount, AddressLookupTableState, Connection, TransactionInstruction} = require("@solana/web3.js");
const {getAssociatedTokenAddress, NATIVE_MINT, createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, createCloseAccountInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID} = require("@solana/spl-token");
const axios = require("axios");
const bs58 = require('bs58');
const http = require('http');
const https = require('https');
const redis = require("redis");
const BN = require("bn.js");
const {dateFormat } = require("./Tools");
const {parentPort, workerData} = require('worker_threads');
const {getFlashLoanInstructions, KAMINO_LENDING_PROGRAM_ID} = require("./FlashLoanKamino");

const connection = new Connection(workerData.RPC, "confirmed");
const inputToken = {symbol: 'SOL', address: 'So11111111111111111111111111111111111111112', decimals: 9};
const NAME = workerData.NAME;

// redis client
let redisClient;
const REDIS_HOST = workerData.REDIS_HOST;
const REDIS_PASS = workerData.REDIS_PASS;
const ATA_LIST = workerData.ATA_LIST; // ATA 账户缓存地址
const ACCOUNT_CACHE = {}  // ACCOUNT 本地缓存


const AMOUNT = workerData.AMOUNT;
const inAmount = Math.floor(AMOUNT * Math.pow(10, inputToken.decimals)); // 1 SOL 询价
const THRESHOLD = Number(workerData.THRESHOLD);

//const CLIENT_SERVER = workerData.CLIENT_SERVER;
//const CLIENT_LIST = CLIENT_SERVER ? CLIENT_SERVER.split(',').map(host => `http://${host}`) : [];

//const LOCALADDRESS = workerData.LOCALADDRESS;
//const LOCALADDRESS_LIST = LOCALADDRESS ? LOCALADDRESS.split(',').map(host => `${host}`) : [];

// 处理交易大小
const THRESHOLD_LIST = [THRESHOLD];
const TRADE_SIZE_LIST = [[inAmount]];

// const TRADE_SIZE = workerData.TRADE_SIZE;
// TRADE_SIZE.split(',').forEach(trade_size => {
//     const ts = trade_size.split(':');
//     const trades = ts[0].split('+').map(t => Math.floor(Number(t) * Math.pow(10, inputToken.decimals)))
//     const threshold = Number(ts[1]);
//     THRESHOLD_LIST.push(threshold)
//     TRADE_SIZE_LIST.push(trades)
// })

const ENABLE_FLASH_LOAN = workerData.ENABLE_FLASH_LOAN === 'true';
const JUPITER_HOST = workerData.JUPITER_HOST;


const JITO_TIP_BPS = workerData.JITO_TIP_BPS; // JITO TIP 比例 1%
const MAX_TIP = workerData.MAX_TIP;
//const JITO_REGION = workerData.JITO_REGION;
//const JITO_UUID = workerData.JITO_UUID;



//const JUP_ONLY_DIRECT_ROUTES = workerData.JUP_ONLY_DIRECT_ROUTES;
const JUP_MAX_ACCOUNTS = Number(workerData.JUP_MAX_ACCOUNTS);

const keypair = Keypair.fromSecretKey(bs58.decode(workerData.walletKey));
const publicKeyAddress = keypair.publicKey.toBase58();

const sourceATAAddress = getAssociatedTokenAddressSync(NATIVE_MINT, keypair.publicKey);
const JITO_TIP_ACCOUNTS = [
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL"
];
const ALT_CACHE = {}



//const logs = [];

// 最近的利润
let lastProfit;

/**

 *
 */
async function run(outputTokenAddress) {

    const quoteStart = process.hrtime();
    // SOL --> X TOKEN
    const quota1Data = await quote(inputToken.address, outputTokenAddress, inAmount);
    // X TOKEN --> SOL
    const quota2Data = await quote(outputTokenAddress, inputToken.address, quota1Data.outAmount);

    // profit but not real
    const profit = quota2Data.outAmount - inAmount;

    if (profit >= 0 && lastProfit !== profit) {
        lastProfit = profit;

        let targetThreshold = 0;
        let targetThresholdIndex = -1;
        THRESHOLD_LIST.forEach((threshold, index) => {
            if (profit >= threshold && threshold >= targetThreshold) {
                targetThreshold = threshold;
                targetThresholdIndex = index;
            }
        });

        if (targetThresholdIndex !== -1) {
            // 获取交易大小列表
            const tradeSizeList = TRADE_SIZE_LIST[targetThresholdIndex];
            const quoteEnd = process.hrtime(quoteStart);

            // logs.push('------------------------------------------------------------------------------------------------------------')
            // logs.push(`发现时间: ${dateFormat("YYYY-mm-dd HH:MM:SS.ms", new Date())}`)
            // logs.push(`发现机会: ${(quoteEnd[1] / 1e6).toFixed(2)} ms | Profit: ${(profit / Math.pow(10, inputToken.decimals)).toFixed(9)} ${inputToken.symbol} | Route: ${quota1Data.routePlan.map(info => info.swapInfo.ammKey)} --> ${quota2Data.routePlan.map(info => info.swapInfo.ammKey)}`);
            for (const tradeSize of tradeSizeList) {
                // await doTrade(profit, tradeSize, structuredClone(quota1Data), structuredClone(quota2Data))
                await doTrade(quoteEnd,profit, tradeSize, quota1Data, quota2Data);
               // await doTrade(quoteEnd,profit, tradeSize+Math.floor(0.25 * Math.pow(10, inputToken.decimals)), quota1Data, quota2Data);
               // await doTrade(quoteEnd,profit, tradeSize-Math.floor(0.25 * Math.pow(10, inputToken.decimals)), quota1Data, quota2Data);
            }


            // 打印信息
            // 打印日志
            // console.log(logs.join('\n'))
            // logs.length = 0;
        }


        // doTrade(profit, quota1Data, quota2Data, quoteStart).then()
    }
}


/**
 * 按照1SOL去询价
 *
 * trade size: 0.5*1000_000_000 = 500_000_000
 * profit: 50_000
 * 比例: 50_000/500_000_000 = 0.0001  万一
 *
 * trade size: 10*1000_000_000= 10_000_000_000
 * profit: 1_000_000
 * 比例: 1_000_000/10_000_000_000 = 0.0001 万一
 *
 * 0.5 - 1.0 - 10 - 50 - 100
 *
 *
 *
 * 【1】 万一
 * trade size: 1_000_000_000
 * profit: 1_000_000_000 * 0.0001 = 100_000
 * 发送 0.5 + 1.0
 *
 * 【2】 千一
 * trade size: 1_000_000_000
 * profit: 1_000_000_000 * 0.001 = 1_000_000
 * 发送 1.0 + 10
 *
 *
 * 【3】 百一
 * trade size: 1_000_000_000
 * profit: 1_000_000_000 * 0.01 = 10_000_000
 * 发送 10 + 50
 *
 * 【4】 十一
 * trade size: 1_000_000_000
 * profit: 1_000_000_000 * 0.1 = 100_000_000
 * 发送 50 + 100
 *
 *
 *
 *
 * {
 *
 *   "inAmount": "1000000000",
 *   "outAmount": "8397910",
 *   "otherAmountThreshold": "8397910",
 *   "routePlan": [
 *       {
 *       "swapInfo": {
 *         "ammKey": "FpCMFDFGYotvufJ7HrFHsWEiiQCGbkLCtwHiDnh7o28Q",
 *         "label": "Whirlpool",
 *         "inputMint": "So11111111111111111111111111111111111111112",
 *         "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
 *         "inAmount": "1000000000",
 *         "outAmount": "231397520",
 *         "feeAmount": "26000",
 *         "feeMint": "So11111111111111111111111111111111111111112"
 *       },
 *       "percent": 100
 *     }
 *   ]
 */
async function doTrade(quoteEnd,profit, tradeSize, quota1Data, quota2Data) {
    // // 计算比例
    const P = tradeSize / inAmount;
    const newAmount = tradeSize;
    quota1Data.inAmount = String(newAmount);
    let mergedRoutePlan = quota1Data.routePlan.concat(quota2Data.routePlan);

    // --------------------------修正参数------------------------- //
    // let notAllHundredPercent = quota1Data.routePlan.some(rp => rp.percent !== 100) || quota2Data.routePlan.some(rp => rp.percent !== 100);
    // // 无法处理非 100%，跳出
    // if (notAllHundredPercent) {
    //     return;
    // }
    //
    // // 准备变量
    // const tradeSizeBN = new BN(tradeSize);
    // const inAmountBN = new BN(inAmount);
    //

    //
    // // [0] 计算修正后利润
    const newProfit = Math.ceil(profit * P); // 不用调整比例？
    // const newProfitBN = new BN(profit);//.mul(tradeSizeBN).div(inAmountBN);
    //
    // // [1] 修改 inAmount
    // const newAmountBN = tradeSizeBN;
    // quota1Data.inAmount = tradeSizeBN.toString();
    //
    // // [3] 合并路由

    // // console.log(JSON.stringify(mergedRoutePlan, null, 2));
    // // console.log('-----------------------------------------------------')
    // // console.log(`tradeSizeBN: ${tradeSizeBN.toString()}`)
    // // console.log(`inAmountBN: ${inAmountBN.toString()}`)
    // // console.log(`P: ${P.toString()}`)
    //
    //
    // // [4] 修改路由
    // // let lastOutAmount = undefined;
    // let lastOutAmountBN = undefined;
    //
    // mergedRoutePlan.forEach((routePlan, index) => {
    //     const swapInfo = routePlan.swapInfo;
    //     // const oldInAmount = Number(swapInfo.inAmount);
    //     // const oldOutAmount = Number(swapInfo.outAmount)
    //     // const oldFee = Number(swapInfo.feeAmount);
    //     const oldInAmountBN = new BN(swapInfo.inAmount);
    //     const oldOutAmountBN = new BN(swapInfo.outAmount);
    //     const oldFeeBN = new BN(swapInfo.feeAmount);
    //
    //
    //     // 修改入口
    //     if(index === 0) {
    //         // swapInfo.inAmount = String(newAmount);
    //         // lastOutAmount = Math.ceil(oldOutAmount * P);
    //         // swapInfo.outAmount = String(lastOutAmount);
    //         swapInfo.inAmount = tradeSizeBN.toString();
    //         lastOutAmountBN = oldOutAmountBN.mul(tradeSizeBN).div(inAmountBN);
    //         swapInfo.outAmount = lastOutAmountBN.toString();
    //
    //
    //     } else {
    //         // swapInfo.inAmount = String(lastOutAmount);
    //         // lastOutAmount = Math.ceil(oldOutAmount * (lastOutAmount / oldInAmount))
    //         // swapInfo.outAmount = String(lastOutAmount);
    //
    //         swapInfo.inAmount = lastOutAmountBN.toString();
    //         lastOutAmountBN = oldOutAmountBN.mul(lastOutAmountBN).div(oldInAmountBN);
    //         swapInfo.outAmount = lastOutAmountBN.toString();
    //     }
    //     // 修改 FEE
    //     // if (oldFee!== 0) {
    //     //     const inputFeeMint = swapInfo.feeMint === swapInfo.inputMint;
    //     //     swapInfo.feeAmount = String(Math.ceil((Number(inputFeeMint ? swapInfo.inAmount : swapInfo.outAmount) / (inputFeeMint ? oldInAmount : oldOutAmount)) * oldFee))
    //     // }
    //
    //     if (!oldFeeBN.isZero()) {
    //         const inputFeeMint = swapInfo.feeMint === swapInfo.inputMint;
    //         swapInfo.feeAmount = oldFeeBN
    //             .mul(new BN(inputFeeMint ? swapInfo.inAmount : swapInfo.outAmount))
    //             .div(inputFeeMint ? oldInAmountBN : oldOutAmountBN)
    //             .toString();
    //     }
    // })
    // --------------------------修正参数------------------------- //


    // [4] 计算 CU LIMIT
    const computeUnitLimit = calculateComputeUnitLimit(mergedRoutePlan);

    // [5] 计算 TIP
    const jitoTip = calculateTip(newProfit, computeUnitLimit);
    // const jitoTip = calculateTip(newProfitBN.toNumber(), computeUnitLimit);

    // [2] 计算 outAmount
    const expectOutAmount = String(newAmount + jitoTip + 10000);
    // const expectOutAmount = newAmountBN.add(new BN(jitoTip)).add(new BN(10000)).toString();

    // 创建新的 Quote
    let mergedQuoteResp = quota1Data;
    mergedQuoteResp.outputMint = quota2Data.outputMint;
    mergedQuoteResp.priceImpactPct = "0";
    mergedQuoteResp.routePlan = mergedRoutePlan;
    mergedQuoteResp.outAmount = expectOutAmount;  //"0"; 这里设置0， 通过合约来校验，挖掘尽可能多的利润。 相当于不能按照既定的蛋糕来抢食，而是按照能抢到多少算多少
    mergedQuoteResp.otherAmountThreshold = expectOutAmount;

    const swapInstStart = process.hrtime();
    const instructions = await swapInstructions(mergedQuoteResp);
    const swapInstEnd = process.hrtime(swapInstStart);
    await instruction(quoteEnd[1],swapInstEnd[1],instructions,computeUnitLimit,jitoTip);
    
}


function calculateTip(profit, computeUnitLimit) {
    // 默认 CU 的 3
    if (JITO_TIP_BPS === 0) {
        const cu_tip = Math.floor(computeUnitLimit * 4.5);
        const profit_tip = Math.floor(profit * 0.65)
        return Math.min(cu_tip, profit_tip);
    } else {
        const computeTip = Math.floor(profit * JITO_TIP_BPS);
        return computeTip < MAX_TIP ? computeTip : MAX_TIP
    }
}

function calculateComputeUnitLimit(routePlan) {
    let cu = 200000;
    const len = routePlan.length;
    if (len === 2) {
        cu = 200000;
    } else if (len === 3) {
        cu = 250000;
    } else if (len === 4) {
        cu = 350000;
    } else if (len === 5) {
        cu = 450000;
    } else {
        cu = 500000;
    }
    if (ENABLE_FLASH_LOAN) {
        cu = cu + 65000;
    }
    return cu;
}

function calculateComputeUnitPrice(profit) {
    if (profit <= 3_000_000) { // <= 0.003
        return 250000;
    } else if (profit <= 5_000_000) { // <= 0.005
        return 450000;
    } else if (profit <= 10_000_000) { // <= 0.01
        return 650000;
    } else {
        return 850000
    }
}




// ---------------------------------- QUOTE ----------------------------------
const quoteAxiosInstance = axios.create({
    method: 'GET',
    headers: {'Accept': 'application/json'},
    httpAgent: new http.Agent({keepAlive: true}),
    httpsAgent: new https.Agent({keepAlive: true}),
    timeout: 500,
});
const quoteOptions = {
    params: {
        inputMint: undefined,
        outputMint: undefined,
        amount: undefined,
        // onlyDirectRoutes: JUP_ONLY_DIRECT_ROUTES === 'true',
        // asLegacyTransaction: false,
        // swapMode: 'ExactIn',
        slippageBps: 0,
        restrictIntermediateTokens: true,
        maxAccounts: JUP_MAX_ACCOUNTS,
        // swapType: 'aggregator',
        // tokenCategoryBasedIntermediateTokens: true
    }
}

async function quote(inputMint, outputMint, inAmount) {
    quoteOptions.url = `${JUPITER_HOST}/quote`;
    quoteOptions.params.inputMint = inputMint;
    quoteOptions.params.outputMint = outputMint;
    quoteOptions.params.amount = inAmount;
    return (await quoteAxiosInstance.request(quoteOptions)).data;
}

// ---------------------------------- QUOTE ----------------------------------


// ---------------------------------- instruction ----------------------------------
async function instruction(quoteTime,swapInstTime,instructions, computeUnitLimit, jitoTip) {
    const instructionsStart = process.hrtime();

    // logs.push(`小费: ${jitoTip} - newAmount: ${mergedQuoteResp.inAmount} - outAmount: ${mergedQuoteResp.outAmount}`);
    // -----------构建命令1------------------
    // bulid tx1
    let ixs1 = [];

    // 1.1 CU
    ixs1.push(ComputeBudgetProgram.setComputeUnitLimit({
        units: computeUnitLimit + 20000,
    }));


    // 判断是否启用闪电贷
    let flashRepayInstruction = null;
    if (ENABLE_FLASH_LOAN) {
        const { flashBorrowIxn, flashRepayIxn } = getFlashLoanInstructions({
            borrowIxnIndex: 1,
            walletPublicKey: keypair.publicKey,
            lendingMarketAuthority: new PublicKey('9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo'), // market.getLendingMarketAuthority(),
            lendingMarketAddress: new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF'), // market.getAddress(),
            reserve: {
                reserve: new PublicKey('d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q'),
                reserveLiquidityMint: new PublicKey('So11111111111111111111111111111111111111112'),
                reserveSourceLiquidity: new PublicKey('GafNuUXj9rxGLn4y79dPu6MHSuPWeJR6UtTWuexpGh3U'),
                reserveLiquidityFeeReceiver: new PublicKey('3JNof8s453bwG5UqiXBLJc77NRQXezYYEBbk3fqnoKph'),
                reserveDestinationLiquidity: new PublicKey('GafNuUXj9rxGLn4y79dPu6MHSuPWeJR6UtTWuexpGh3U'),
                tokenProgram: TOKEN_PROGRAM_ID
            },
            amountLamports: inAmount,
            destinationAta: sourceATAAddress,
            // TODO(referrals): once we support referrals, we will have to replace the placeholder args below:
            referrerAccount: new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'),
            referrerTokenState: new PublicKey('KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD'),
            programId: KAMINO_LENDING_PROGRAM_ID,
        });
        ixs1.push(flashBorrowIxn);
        flashRepayInstruction = flashRepayIxn;
    }


    // 1.2 CU
    // console.log(`microLamports: ${instructions.prioritizationType.computeBudget.microLamports}`)
    // if (JITO_SEND_TYPE === 'transactions') {
    //     const computePriceInstruction = ComputeBudgetProgram.setComputeUnitPrice({
    //         microLamports: calculateComputeUnitPrice(profit)
    //     });
    //     ixs.push(computePriceInstruction);
    // }

    // 1.3 setup
    const setupInstructions = instructions.setupInstructions.map(instructionFormat).filter(item => item !== null);
    ixs1 = ixs1.concat(setupInstructions);

    // 1.4 save balance instruction from your program

    // 1.5 swap
    const swapInstructionList = instructionFormat(instructions.swapInstruction);
    ixs1.push(swapInstructionList);


    if (ENABLE_FLASH_LOAN && flashRepayInstruction !== null) {
        ixs1.push(flashRepayInstruction);
    }


    // 1.6 cal real profit and pay for jito from your program
    // a simple transfer instruction here
    // the real profit and tip should be calculated in your program

    // 1.7 生成新钱包
    const destinationKeyPair = Keypair.generate();
    const destinationATAAddress = await getAssociatedTokenAddress(NATIVE_MINT, destinationKeyPair.publicKey);

    // 1.8 创建 ATA
    ixs1.push(createAssociatedTokenAccountIdempotentInstruction(
        keypair.publicKey, // Payer
        destinationATAAddress, // ATA address
        destinationKeyPair.publicKey, // Owner of the ATA
        NATIVE_MINT // Token Mint (WSOL)
    ));

    // 1.9 转移 WSOL
    ixs1.push(createTransferInstruction(
        sourceATAAddress, // source
        destinationATAAddress, //destination,
        keypair.publicKey,
        jitoTip + 10000 // amount
    ));

    // 1.10 转移 SOL 用于创建账户支付 TIP
    ixs1.push(SystemProgram.transfer({
        fromPubkey: keypair.publicKey, // 发送 SOL 的地址
        toPubkey: destinationKeyPair.publicKey, // 目标 ATA 地址
        lamports: 2039280 + 5000, // 转换的 lamports 数量 2044280
    }));


    // 1.11 写入 memo
    if (NAME) {
        ixs1.push(
            new TransactionInstruction({
                keys: [],
                data: Buffer.from(NAME, "utf-8"),
                programId: new PublicKey("Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo"),
            }),
        );
    }

    // 1.11 加载地址表
    const addressLookupTableAccounts = await Promise.all(instructions.addressLookupTableAddresses.map(async key => {
        // 本地缓存
        let alt = ALT_CACHE[key];
        if (!alt) {
            // 从redis获取
            const jsonString = await redisClient.get(key);
            let jsonData;
            if (!jsonString) {
                const result = await connection.getAddressLookupTable(new PublicKey(key));
                const alt = result.value;
                // console.log('ALT: 链上 读取数据')
                jsonData = {
                    address: key,
                    key: alt.key.toBase58(),
                    // deactivationSlot: alt.state.deactivationSlot, //bigint,
                    // lastExtendedSlot: alt.state.lastExtendedSlot, //number,
                    // lastExtendedSlotStartIndex: alt.state.lastExtendedSlotStartIndex,// number,
                    authority: alt.state.authority.toBase58(), // PublicKey
                    addresses: alt.state.addresses.map(address => address.toBase58())
                };
                await redisClient.set(key, JSON.stringify(jsonData));
            } else {
                // console.log('ALT: Redis 读取数据')
                jsonData = JSON.parse(jsonString);
            }
            alt = new AddressLookupTableAccount({
                key: new PublicKey(jsonData.key),
                state: {
                    // deactivationSlot: jsonData.deactivationSlot, // 貌似没用
                    // lastExtendedSlot: jsonData.lastExtendedSlot, // 貌似没用
                    // lastExtendedSlotStartIndex: jsonData.lastExtendedSlotStartIndex, // 貌似没用
                    authority: new PublicKey(jsonData.authority), // 貌似没用
                    addresses: jsonData.addresses.map(address => new PublicKey(address)),
                }
            })
            ALT_CACHE[key] = alt
        }
        return alt;
    }));

    // 1.12 构建指令
    const currentBlockHash = await redisClient.get("BLOCK_HASH");

    const message1 = new TransactionMessage({
        payerKey: keypair.publicKey,
        recentBlockhash: currentBlockHash,
        instructions: ixs1,
    }).compileToV0Message(addressLookupTableAccounts);
    const transaction1 = new VersionedTransaction(message1);
    transaction1.sign([keypair]);


    // -----------构建命令2------------------
    let ixs2 = [];

    // 2.1 CU
    ixs2.push(ComputeBudgetProgram.setComputeUnitLimit({
        units: 5000,
    }));

    // 2.2 关闭 WSOL 账户，WSOL -> SOL
    ixs2.push(
        createCloseAccountInstruction(
            destinationATAAddress,
            destinationKeyPair.publicKey, // destination, token account which you want to close
            destinationKeyPair.publicKey, // authority
        )
    );

    // 2.3 发送 TIP
    const randomIndex = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
    ixs2.push(SystemProgram.transfer({
        fromPubkey: destinationKeyPair.publicKey, // 发送 SOL 的地址
        toPubkey: new PublicKey(JITO_TIP_ACCOUNTS[randomIndex]),
        lamports: jitoTip, //
    }));

    // 2.4 返回 SOL
    ixs2.push(SystemProgram.transfer({
        fromPubkey: destinationKeyPair.publicKey, // 发送 SOL 的地址
        toPubkey: keypair.publicKey,
        lamports: 2039280 + 2039280 + 10000, //
    }));

    // 2.5 build transaction
    const message2 = new TransactionMessage({
        payerKey: destinationKeyPair.publicKey,
        recentBlockhash: currentBlockHash,
        instructions: ixs2,
    }).compileToV0Message();
    const transaction2 = new VersionedTransaction(message2);
    transaction2.sign([destinationKeyPair]);


    

    

    // 9 模拟交易
    // let serialized = transaction1.serialize();
    // console.log(Buffer.from(serialized).toString("base64"))

    // const simulationStart = process.hrtime();
    // const simulationResult = await connection.simulateTransaction(transaction1);
    // const simulationEnd = process.hrtime(simulationStart);
    // console.log(`模拟结果: ${simulationEnd[1] / 1e6} ms`);
    // console.log(`模拟结果: ${simulationEnd[1] / 1e6} ms ${JSON.stringify(simulationResult.value.err)}`);
    // console.log(JSON.stringify(mergedQuoteResp, null, 2));
    // console.log(simulationResult);

    // 10 发送交易
    // const sendStart = process.hrtime();

    // await sendTransaction([transaction1, transaction2], logs)

    // const sendEnd = process.hrtime(sendStart);
    // const totalEnd = process.hrtime(tradeStart);
    // //logs.push(`总共耗时: ${(totalEnd[1] / 1e6).toFixed(2)} ms | 生成指令: ${(swapInstEnd[1] / 1e6).toFixed(2)} ms | 构建交易: ${(instructionsEnd[1] / 1e6).toFixed(2)} ms | 交易大小: ${tradeSize / 1_000_000_000}`);
    // logs.push(`总共耗时: ${(totalEnd[1] / 1e6).toFixed(2)} ms | 生成指令: ${(swapInstEnd[1] / 1e6).toFixed(2)} ms | 构建交易: ${(instructionsEnd[1] / 1e6).toFixed(2)} ms | 发送交易: ${(sendEnd[1] / 1e6).toFixed(2)} ms | 交易大小: ${tradeSize / 1_000_000_000} | HASH: ${currentBlockHash}`);
    // 10 发送交易


    //sendTransaction([transaction1, transaction2]);

    const transactions =  [[transaction1, transaction2].map(transaction => Buffer.from(transaction.serialize()).toString('base64')), { encoding: "base64" }];
    const instructionsEnd = process.hrtime(instructionsStart);

    const parentMessage = {};
    parentMessage.tradeDataList = [];
    const sendInfo = {
        quoteTime:quoteTime,
        swapInstTime:swapInstTime,
        transactions:transactions,
        instructionTime:instructionsEnd[1]
    };
    parentMessage.tradeDataList.push(sendInfo);
    parentPort.postMessage(parentMessage);
}

function getAccountPublicKey(address) {
    if (ACCOUNT_CACHE[address]) {
        return ACCOUNT_CACHE[address];
    } else {
        const pubKey = new PublicKey(address)
        ACCOUNT_CACHE[address] = pubKey;
        return pubKey;
    }
}

// 排除掉重复创建 ATA 的指令，减少 CU
function instructionFormat(instruction) {
    if ('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' === instruction.programId && instruction.data === "AQ==" && instruction.accounts[0].pubkey === publicKeyAddress) {
        if (ATA_LIST.indexOf(instruction.accounts[1].pubkey) !== -1) {
            return null;
        }
    }
    return {
        programId: getAccountPublicKey(instruction.programId),
        keys: instruction.accounts.map(account => ({
            pubkey: getAccountPublicKey(account.pubkey),
            isSigner: account.isSigner,
            isWritable: account.isWritable
        })),
        data: Buffer.from(instruction.data, 'base64')
    };
}

// ---------------------------------- instruction ----------------------------------


// ---------------------------------- SWAP ----------------------------------
const swapAxiosInstance = axios.create({
    method: 'POST',
    headers: {'Accept': 'application/json'},
    httpAgent: new http.Agent({keepAlive: true}),
    httpsAgent: new https.Agent({keepAlive: true}),
    timeout: 500,
});
const swapOptions = {
    data: {
        "asLegacyTransaction": false,
        "wrapAndUnwrapSol": false,
        "useSharedAccounts": false,
        "computeUnitPriceMicroLamports": 1,
        "dynamicComputeUnitLimit": false,
        "skipUserAccountsRpcCalls": true,
        "quoteResponse": undefined
    }
};

async function swapInstructions(quoteResponse) {
    swapOptions.url = `${JUPITER_HOST}/swap-instructions`;
    swapOptions.data.userPublicKey = publicKeyAddress;
    swapOptions.data.quoteResponse = quoteResponse;
    return (await swapAxiosInstance.request(swapOptions)).data;
}

// ---------------------------------- SWAP ----------------------------------


async function main() {
    const token = workerData.token;

    const redis_options = {
        socket: {
            host: REDIS_HOST,
            port: 6379
        },
    }
    if (REDIS_PASS) {
        redis_options.password = REDIS_PASS;
    }

    redisClient = redis.createClient(redis_options);
    // 连接到 Redis
    await redisClient.connect();
    console.log('开始启动 BOT: ' + token);

    while (true) {
        try {
            await run(token);
        } catch (e) {
            console.error(e);
            // 暂停 500 ms
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
}

main().then();

