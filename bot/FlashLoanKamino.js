const { PublicKey, TransactionInstruction,  SYSVAR_INSTRUCTIONS_PUBKEY} = require("@solana/web3.js");
const anchor = require("@coral-xyz/anchor");
const borsh = require("@coral-xyz/borsh");

const KAMINO_LENDING_PROGRAM_ID = new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD")
const flashBorrowLayout = borsh.struct([borsh.u64('liquidityAmount')]);
const flashRepayLayout = borsh.struct([borsh.u64("liquidityAmount"), borsh.u8("borrowInstructionIndex")]);
   
function flashBorrowReserveLiquidity(args, accounts, programId = KAMINO_LENDING_PROGRAM_ID) {
    const keys = [
        {pubkey: accounts.userTransferAuthority, isSigner: true, isWritable: false},
        {pubkey: accounts.lendingMarketAuthority, isSigner: false, isWritable: false},
        {pubkey: accounts.lendingMarket, isSigner: false, isWritable: false},
        {pubkey: accounts.reserve, isSigner: false, isWritable: true},
        {pubkey: accounts.reserveLiquidityMint, isSigner: false, isWritable: false},
        {pubkey: accounts.reserveSourceLiquidity, isSigner: false, isWritable: true},
        {pubkey: accounts.userDestinationLiquidity, isSigner: false, isWritable: true},
        {pubkey: accounts.reserveLiquidityFeeReceiver, isSigner: false, isWritable: true},
        {pubkey: accounts.referrerTokenState, isSigner: false, isWritable: true},
        {pubkey: accounts.referrerAccount, isSigner: false, isWritable: true},
        {pubkey: accounts.sysvarInfo, isSigner: false, isWritable: false},
        {pubkey: accounts.tokenProgram, isSigner: false, isWritable: false},
    ];
    const identifier = Buffer.from([135, 231, 52, 167, 7, 52, 212, 193]);
    const buffer = Buffer.alloc(1000);
    const len = flashBorrowLayout.encode({liquidityAmount: args.liquidityAmount}, buffer);
    const data = Buffer.concat([identifier, buffer]).slice(0, 8 + len);
    return new TransactionInstruction({keys, programId, data});
}


function flashRepayReserveLiquidity(args, accounts, programId = KAMINO_LENDING_PROGRAM_ID) {
    const keys = [
        {pubkey: accounts.userTransferAuthority, isSigner: true, isWritable: false},
        {pubkey: accounts.lendingMarketAuthority, isSigner: false, isWritable: false},
        {pubkey: accounts.lendingMarket, isSigner: false, isWritable: false},
        {pubkey: accounts.reserve, isSigner: false, isWritable: true},
        {pubkey: accounts.reserveLiquidityMint, isSigner: false, isWritable: false},
        {pubkey: accounts.reserveDestinationLiquidity, isSigner: false, isWritable: true},
        {pubkey: accounts.userSourceLiquidity, isSigner: false, isWritable: true},
        {pubkey: accounts.reserveLiquidityFeeReceiver, isSigner: false, isWritable: true},
        {pubkey: accounts.referrerTokenState, isSigner: false, isWritable: true},
        {pubkey: accounts.referrerAccount, isSigner: false, isWritable: true},
        {pubkey: accounts.sysvarInfo, isSigner: false, isWritable: false},
        {pubkey: accounts.tokenProgram, isSigner: false, isWritable: false},
    ]
    const identifier = Buffer.from([185, 117, 0, 203, 96, 245, 180, 186])
    const buffer = Buffer.alloc(1000)
    const len = flashRepayLayout.encode({liquidityAmount: args.liquidityAmount, borrowInstructionIndex: args.borrowInstructionIndex}, buffer)
    const data = Buffer.concat([identifier, buffer]).slice(0, 8 + len)
    return new TransactionInstruction({keys, programId, data})
}


const getBorrowFlashLoanInstruction = ({walletPublicKey, lendingMarketAuthority, lendingMarketAddress, reserve, amountLamports, destinationAta, referrerAccount, referrerTokenState, programId}) => {
    const args = {
        liquidityAmount: new anchor.BN(amountLamports),
    };
    const accounts = {
        userTransferAuthority: walletPublicKey,
        lendingMarketAuthority: lendingMarketAuthority,
        lendingMarket: lendingMarketAddress,
        reserve: reserve.reserve,
        reserveLiquidityMint: reserve.reserveLiquidityMint,
        reserveSourceLiquidity: reserve.reserveSourceLiquidity,
        userDestinationLiquidity: destinationAta,
        referrerAccount: referrerAccount,
        referrerTokenState: referrerTokenState,
        reserveLiquidityFeeReceiver: reserve.reserveLiquidityFeeReceiver,
        sysvarInfo: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: reserve.tokenProgram,
    };

    return flashBorrowReserveLiquidity(args, accounts, programId);
};


const getRepayFlashLoanInstruction = ({borrowIxnIndex, walletPublicKey, lendingMarketAuthority, lendingMarketAddress, reserve, amountLamports, userSourceLiquidity, referrerAccount, referrerTokenState, programId,}) => {
    const args = {
        borrowInstructionIndex: borrowIxnIndex,
        liquidityAmount: new anchor.BN(amountLamports),
    };
    const accounts = {
        userTransferAuthority: walletPublicKey,
        lendingMarketAuthority: lendingMarketAuthority,
        lendingMarket: lendingMarketAddress,
        reserve: reserve.reserve,
        reserveLiquidityMint: reserve.reserveLiquidityMint,
        reserveDestinationLiquidity: reserve.reserveDestinationLiquidity,
        userSourceLiquidity: userSourceLiquidity,
        referrerAccount: referrerAccount,
        referrerTokenState: referrerTokenState,
        reserveLiquidityFeeReceiver: reserve.reserveLiquidityFeeReceiver,
        sysvarInfo: SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: reserve.tokenProgram,
    };
    return flashRepayReserveLiquidity(args, accounts, programId);
};


const getFlashLoanInstructions = (args) => {
    const flashBorrowIxn = getBorrowFlashLoanInstruction({
        walletPublicKey: args.walletPublicKey,
        lendingMarketAuthority: args.lendingMarketAuthority,
        lendingMarketAddress: args.lendingMarketAddress,
        reserve: args.reserve,
        amountLamports: args.amountLamports,
        destinationAta: args.destinationAta,
        referrerAccount: args.referrerAccount,
        referrerTokenState: args.referrerTokenState,
        programId: args.programId,
    });
    const flashRepayIxn = getRepayFlashLoanInstruction({
        borrowIxnIndex: args.borrowIxnIndex,
        walletPublicKey: args.walletPublicKey,
        lendingMarketAuthority: args.lendingMarketAuthority,
        lendingMarketAddress: args.lendingMarketAddress,
        reserve: args.reserve,
        amountLamports: args.amountLamports,
        userSourceLiquidity: args.destinationAta,
        referrerAccount: args.referrerAccount,
        referrerTokenState: args.referrerTokenState,
        programId: args.programId,
    });

    return {flashBorrowIxn, flashRepayIxn};
};

module.exports = {
    KAMINO_LENDING_PROGRAM_ID,
    getFlashLoanInstructions,
}
