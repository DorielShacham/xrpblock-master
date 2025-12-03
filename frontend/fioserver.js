import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import paypal from '@paypal/checkout-server-sdk';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(cors());

// PayPal Configuration
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const FIO_PUBLIC_KEY = process.env.FIO_PUBLIC_KEY;
const FIO_REFERRAL_CODE = process.env.FIO_REFERRAL_CODE || 'xrpblock';

if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
    console.error('❌ Missing PAYPAL_CLIENT_ID or PAYPAL_SECRET in .env file');
    process.exit(1);
}

if (!FIO_PUBLIC_KEY) {
    console.error('❌ Missing FIO_PUBLIC_KEY in .env file');
    process.exit(1);
}

// Initialize PayPal client
const environment = new paypal.core.SandboxEnvironment(PAYPAL_CLIENT_ID, PAYPAL_SECRET);
const client = new paypal.core.PayPalHttpClient(environment);

// FIO API endpoint
const FIO_API = 'https://api-app.fio.net/public-api';

// Register FIO Handle via FIO API
async function registerFIOHandle(handle, domain, publicKey, referralCode) {
    try {
        const response = await fetch(`${FIO_API}/buy-address`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                address: `${handle}@${domain}`,
                publicKey: publicKey,
                referralCode: referralCode
            })
        });

        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.message || 'FIO registration failed');
        }

        return data;
    } catch (error) {
        console.error('❌ FIO Registration Error:', error);
        throw error;
    }
}

// Create PayPal Order
app.post('/pay/paypal', async (req, res) => {
    try {
        const { handle, walletAddress, domain } = req.body;

        // Validate inputs
        if (!handle || !walletAddress || !domain) {
            return res.status(400).json({ error: 'Missing required fields: handle, walletAddress, domain' });
        }

        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer('return=representation');
        request.requestBody({
            intent: 'CAPTURE',
            payment_source: {
                paypal: {
                    experience_context: {
                        payment_method_preference: 'IMMEDIATE'
                    }
                }
            },
            purchase_units: [
                {
                    amount: {
                        currency_code: 'USD',
                        value: '10.00'
                    },
                    description: `FIO Handle: ${handle}@${domain}`,
                    custom_id: `${handle}@${domain}|${walletAddress}`
                }
            ],
            application_context: {
                brand_name: 'XRPBlock',
                locale: 'en-US',
                landing_page: 'LOGIN',
                user_action: 'PAY_NOW',
                return_url: `${process.env.BASE_URL || 'https://www.xrpblock.com'}/fio.html?success=true`,
                cancel_url: `${process.env.BASE_URL || 'https://www.xrpblock.com'}/fio.html?success=false`
            }
        });

        const order = await client.execute(request);
        
        console.log(`✓ Order created: ${order.result.id} for ${handle}@${domain}`);
        res.json({ id: order.result.id });

    } catch (error) {
        console.error('❌ Error creating PayPal order:', error);
        res.status(500).json({ error: error.message });
    }
});

// Capture PayPal Order & Register FIO Handle
app.post('/pay/paypal/capture', async (req, res) => {
    try {
        const { orderId, handle, walletAddress, domain } = req.body;

        // Validate inputs
        if (!orderId || !handle || !walletAddress) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const request = new paypal.orders.OrdersCaptureRequest(orderId);
        request.requestBody({});

        const capture = await client.execute(request);

        // Check if payment was successful
        if (capture.result.status === 'COMPLETED') {
            console.log(`✓ Payment captured for ${handle}@${domain}`);
            console.log(`  Transaction ID: ${capture.result.id}`);
            console.log(`  Wallet: ${walletAddress}`);

            // Now register the FIO handle
            console.log(`📝 Registering FIO handle: ${handle}@${domain}`);
            
            try {
                const fioResult = await registerFIOHandle(
                    handle,
                    domain,
                    FIO_PUBLIC_KEY,
                    FIO_REFERRAL_CODE
                );

                console.log(`✓ FIO Handle registered!`);
                console.log(`  Order ID: ${fioResult.order_id}`);

                res.json({
                    success: true,
                    message: `FIO handle ${handle}@${domain} registered successfully!`,
                    paypalTransactionId: capture.result.id,
                    fioOrderId: fioResult.order_id,
                    fioHandle: `${handle}@${domain}`,
                    walletAddress: walletAddress
                });
            } catch (fioError) {
                console.error('❌ FIO registration failed:', fioError.message);
                res.status(202).json({
                    success: true,
                    message: 'Payment successful but FIO registration pending',
                    paypalTransactionId: capture.result.id,
                    fioHandle: `${handle}@${domain}`,
                    walletAddress: walletAddress,
                    warning: fioError.message
                });
            }
        } else {
            res.json({
                success: false,
                error: `Payment status: ${capture.result.status}`
            });
        }

    } catch (error) {
        console.error('❌ Error capturing PayPal order:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'Server running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 FIO Server running on port ${PORT}`);
    console.log(`📍 Base URL: ${process.env.BASE_URL || 'http://localhost:3000'}`);
    console.log(`💳 PayPal Client ID: ${PAYPAL_CLIENT_ID.substring(0, 10)}...`);
    console.log(`🔑 FIO Public Key: ${FIO_PUBLIC_KEY.substring(0, 10)}...`);
    console.log(`✓ Ready to accept payments!\n`);
});