import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { FIOSDK } from '@fioprotocol/fiosdk';

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(cors());

// Configuration
const FIO_PUBLIC_KEY = process.env.FIO_PUBLIC_KEY;
const FIO_PRIVATE_KEY = process.env.FIO_PRIVATE_KEY;
const MERCHANT_WALLET = 'r49QFFRBBDd5ieMGWwZHGbkVVSmXjjPhkw';
const PAYMENT_AMOUNT = '5';
const FIO_API = 'https://api-app.fio.net/public-api';

if (!FIO_PUBLIC_KEY || !FIO_PRIVATE_KEY) {
    console.error('❌ Missing FIO_PUBLIC_KEY or FIO_PRIVATE_KEY in .env file');
    process.exit(1);
}

// Initialize FIO SDK
const fioSDK = new FIOSDK(
    FIO_PRIVATE_KEY,
    FIO_PUBLIC_KEY,
    FIO_API,
    fetch
);

// Verify XRP Payment on XRPL
async function verifyXRPPayment(transactionHash, toAddress, amount, expectedMemo = null) {
    try {
        const response = await fetch('https://xrpl.ws:6005/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'tx',
                params: {
                    transaction: transactionHash,
                    binary: false
                }
            })
        });

        const data = await response.json();

        if (data.result && data.result.status === 'success') {
            const tx = data.result.tx;
            const amountXRP = parseInt(tx.Amount) / 1000000;

            if (tx.Destination === toAddress && amountXRP >= parseFloat(amount)) {
                console.log(`✓ Payment verified: ${amountXRP} XRP to ${toAddress}`);

                // Extract and verify memo if provided
                let transactionMemo = null;
                if (tx.Memos && tx.Memos.length > 0) {
                    try {
                        const memoData = tx.Memos[0].Memo.MemoData;
                        transactionMemo = Buffer.from(memoData, 'hex').toString('utf-8');
                        console.log(`✓ Memo found in transaction: "${transactionMemo}"`);

                        // Verify memo matches expected memo
                        if (expectedMemo && transactionMemo !== expectedMemo) {
                            console.error(`❌ Memo mismatch: Expected "${expectedMemo}" but got "${transactionMemo}"`);
                            return {
                                verified: false,
                                error: `Memo mismatch. Expected "${expectedMemo}" but got "${transactionMemo}". Make sure you included the correct memo in your XRP transaction.`
                            };
                        }
                    } catch (memoError) {
                        console.error('⚠️ Error extracting memo:', memoError.message);
                    }
                } else {
                    if (expectedMemo) {
                        console.error(`❌ No memo found in transaction but expected "${expectedMemo}"`);
                        return {
                            verified: false,
                            error: `No memo found in transaction. You must include the memo "${expectedMemo}" in your XRP transaction to register your handle.`
                        };
                    }
                }

                return {
                    verified: true,
                    txHash: transactionHash,
                    amount: amountXRP,
                    sourceAddress: tx.Account,
                    memo: transactionMemo
                };
            }
        }

        return { verified: false, error: 'Payment verification failed' };
    } catch (error) {
        console.error('❌ XRP Verification Error:', error);
        return { verified: false, error: error.message };
    }
}

// Register FIO Handle
async function registerFIOHandle(handle, domain, userPublicKey) {
    try {
        console.log(`📝 Registering FIO handle: ${handle}@${domain}`);

        const result = await fioSDK.registerFioAddress(
            `${handle}@${domain}`,
            userPublicKey,
            10000000000000,
            'xrpblock@israel'
        );

        console.log(`✓ FIO Handle registered!`);
        console.log(`  Handle: ${handle}@${domain}`);
        console.log(`  Transaction ID: ${result.transaction_id}`);

        return result;
    } catch (error) {
        console.error('❌ FIO Registration Error:', error);
        throw error;
    }
}

// API Endpoint: Get payment details
app.post('/pay/xrp/details', async (req, res) => {
    try {
        const { handle, walletAddress, domain } = req.body;

        if (!handle || !walletAddress || !domain) {
            return res.status(400).json({
                error: 'Missing required fields: handle, walletAddress, domain'
            });
        }

        res.json({
            success: true,
            merchant_wallet: MERCHANT_WALLET,
            amount_xrp: PAYMENT_AMOUNT,
            fio_handle: `${handle}@${domain}`,
            user_wallet: walletAddress,
            instructions: `Send ${PAYMENT_AMOUNT} XRP to ${MERCHANT_WALLET} to register your FIO handle`
        });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API Endpoint: Verify payment and register FIO handle
app.post('/pay/xrp/verify', async (req, res) => {
    try {
        const { handle, walletAddress, domain, transactionHash, expectedMemo } = req.body;

        if (!handle || !walletAddress || !domain || !transactionHash || !expectedMemo) {
            return res.status(400).json({
                error: 'Missing required fields: handle, walletAddress, domain, transactionHash, expectedMemo'
            });
        }

        console.log(`\n🔍 Verifying XRP payment for ${handle}@${domain}`);
        console.log(`  Transaction: ${transactionHash}`);
        console.log(`  Expected Memo: "${expectedMemo}"`);

        // Verify XRP payment and memo
        const paymentVerification = await verifyXRPPayment(
            transactionHash,
            MERCHANT_WALLET,
            PAYMENT_AMOUNT,
            expectedMemo // Pass expected memo for verification
        );

        if (!paymentVerification.verified) {
            console.error('❌ Payment verification failed');
            return res.status(402).json({
                success: false,
                error: paymentVerification.error || 'XRP payment not found or insufficient amount'
            });
        }

        console.log(`✓ Payment verified: ${paymentVerification.amount} XRP received`);
        console.log(`✓ Memo verified: "${paymentVerification.memo}"`);

        try {
            const fioResult = await registerFIOHandle(
                handle,
                domain,
                walletAddress // Use wallet address as the user's public key
            );

            res.json({
                success: true,
                message: `✓ FIO handle ${handle}@${domain} registered successfully!`,
                xrp_transaction_id: transactionHash,
                xrp_amount: paymentVerification.amount,
                xrp_memo: paymentVerification.memo,
                fio_transaction_id: fioResult.transaction_id,
                fio_handle: `${handle}@${domain}`,
                user_wallet: walletAddress
            });
        } catch (fioError) {
            console.error('⚠️ FIO registration failed:', fioError.message);
            res.status(202).json({
                success: true,
                message: 'Payment received and verified but FIO registration is pending',
                xrp_transaction_id: transactionHash,
                xrp_amount: paymentVerification.amount,
                xrp_memo: paymentVerification.memo,
                fio_handle: `${handle}@${domain}`,
                warning: fioError.message
            });
        }
    } catch (error) {
        console.error('❌ Verification Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'Server running',
        merchant_wallet: MERCHANT_WALLET,
        payment_amount_xrp: PAYMENT_AMOUNT
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 FIO XRP Payment Server running on port ${PORT}`);
    console.log(`💰 Merchant Wallet: ${MERCHANT_WALLET}`);
    console.log(`💵 Payment Amount: ${PAYMENT_AMOUNT} XRP`);
    console.log(`🔑 FIO Public Key: ${FIO_PUBLIC_KEY.substring(0, 10)}...`);
    console.log(`✓ Ready to accept XRP payments!\n`);
});
