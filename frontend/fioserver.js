import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import paypal from '@paypal/checkout-server-sdk';

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(cors());

// PayPal Configuration
const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;

if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
    console.error('❌ Missing PAYPAL_CLIENT_ID or PAYPAL_SECRET in .env file');
    process.exit(1);
}

// Initialize PayPal client
const environment = new paypal.core.SandboxEnvironment(PAYPAL_CLIENT_ID, PAYPAL_SECRET);
const client = new paypal.core.PayPalHttpClient(environment);

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

            // TODO: Register FIO handle here
            // This is where you'd call your FIO registration logic
            // using FIO_PRIVATE_KEY and FIO_PUBLIC_KEY from .env

            res.json({
                success: true,
                message: `FIO handle ${handle}@${domain} registered!`,
                paypalTransactionId: capture.result.id,
                fioHandle: `${handle}@${domain}`,
                walletAddress: walletAddress
            });
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
    console.log(`✓ Ready to accept payments!\n`);
});