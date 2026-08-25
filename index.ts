          
// BERCY FX ORCHESTRATOR - MAINNET + AC2
import { config } from "dotenv";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactAvmScheme } from "@x402/avm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402-avm/extensions";
import type { ResourceServerExtension } from "@x402/core/types";
import { ALGORAND_MAINNET_CAIP2, USDC_MAINNET_ASA_ID } from "@x402/avm";
import { Ac2Client } from "@algorandfoundation/ac2-sdk";
import { createInMemoryTransportPair } from "@algorandfoundation/ac2-sdk/transport";
import { buildSigningResponse } from "@algorandfoundation/ac2-sdk/protocol";
import { isSigningRequest } from "@algorandfoundation/ac2-sdk/schema";

config();

const avmAddress = process.env.AVM_ADDRESS!;
const facilitatorUrl = process.env.FACILITATOR_URL || "https://facilitator.goplausible.xyz";

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
const server = new x402ResourceServer(facilitatorClient)
    .register(ALGORAND_MAINNET_CAIP2, new ExactAvmScheme());

server.registerExtension(bazaarResourceServerExtension as unknown as ResourceServerExtension);

const FX_RATES: Record<string, number> = {
    USD: 1, EUR: 1.08, GBP: 1.27, DZD: 0.0074,
    NGN: 0.00063, BRL: 0.20, KES: 0.0078, MAD: 0.10,
    EGP: 0.021, ZAR: 0.055, TRY: 0.031, INR: 0.012,
    JPY: 0.0068, CNY: 0.14, AED: 0.27, SAR: 0.27,
    GHS: 0.062, XOF: 0.0017, ETB: 0.0091, UGX: 0.00027
};

const app = new Hono();

// Health endpoint
app.get("/api/health", (c) => c.json({
    status: "ok",
    service: "Bercy FX Orchestrator",
    protocols: ["x402", "AC2"],
    network: "Algorand Mainnet",
    corridors: Object.keys(FX_RATES).length
}));

// AC2 human approval endpoint
app.post("/api/authorize", async (c) => {
    const { from, to, amount, agent_did } = await c.req.json();

    if (!from || !to || !amount) {
        return c.json({ error: "Missing: from, to, amount" }, 400);
    }

    const [agentTransport, walletTransport] = createInMemoryTransportPair();

    // Wallet side: human approval (demo: auto-approve)
    walletTransport.onMessage((msg: unknown) => {
        if (isSigningRequest(msg)) {
            walletTransport.send(JSON.stringify(buildSigningResponse({
                request: msg,
                from: "did:key:zBercyWallet",
                body: {
                    signature: Buffer.from(JSON.stringify({ from, to, amount, approved: true, ts: Date.now() })).toString("base64"),
                    public_key: avmAddress,
                    key_type: "account"
                }
            })));
        }
    });

    const agent = new Ac2Client(agentTransport);

    const outcome = await agent.requestSignature({
        from: agent_did || "did:key:zBercyAgent",
        to: "did:key:zBercyWallet",
        body: {
            description: `Bercy FX: ${amount} ${from.toUpperCase()} → ${to.toUpperCase()} | Fee: $0.10 USDC`,
            encoding: "base64",
            payload: Buffer.from(JSON.stringify({ from, to, amount })).toString("base64"),
            sig_hint: "raw-ed25519"
        }
    }, { timeoutMs: 5000 });

    if (outcome.kind === "response") {
        return c.json({
            approved: true,
            approval_id: `bercy_${Date.now()}`,
            from: from.toUpperCase(),
            to: to.toUpperCase(),
            amount,
            signature: outcome.message.body.signature,
            message: "AC2 approval granted. Proceed to /api/orchestrate with x402 payment.",
            protocol: "AC2 + x402 on Algorand"
        });
    }

    return c.json({ approved: false, reason: "AC2 approval declined" }, 403);
});

// x402 payment middleware
app.use(
    paymentMiddleware(
        {
            "POST /api/orchestrate": {
                accepts: [{
                    scheme: "exact",
                    price: "$0.10",
                    network: ALGORAND_MAINNET_CAIP2,
                    payTo: avmAddress,
                    extra: {
                        asset: USDC_MAINNET_ASA_ID,
                        tag: "x402-global-challenge"
                    },
                }],
                description: "Bercy cross-border FX orchestrator: AC2 human-approved agentic payments + x402 settlement on Algorand. Routes 20+ currency corridors. Input: { from, to, amount }.",
                mimeType: "application/json",
                extensions: declareDiscoveryExtension({
                    output: {
                        example: {
                            success: true,
                            route: {
                                path: "DZD -> USDC -> EUR",
                                effectiveRate: 0.0074,
                                estimatedOutput: 7.4,
                                networkFee: "0.001 ALGO",
                                settlementTime: "< 4 seconds"
                            }
                        }
                    }
                }),
            },
        },
        server,
    ),
);

// FX orchestration endpoint
app.post("/api/orchestrate", async (c) => {
    const { from, to, amount } = await c.req.json();
    if (!from || !to || !amount) {
        return c.json({ error: "Missing: from, to, amount" }, 400);
    }
    const fromRate = FX_RATES[from.toUpperCase()];
    const toRate = FX_RATES[to.toUpperCase()];
    if (!fromRate || !toRate) {
        return c.json({ error: `Unsupported currency. Available: ${Object.keys(FX_RATES).join(", ")}` }, 400);
    }
    const effectiveRate = toRate / fromRate;
    return c.json({
        success: true,
        route: {
            path: `${from.toUpperCase()} -> USDC (Algorand) -> ${to.toUpperCase()}`,
            effectiveRate: Math.round(effectiveRate * 10000) / 10000,
            estimatedOutput: Math.round(amount * effectiveRate * 100) / 100,
            networkFee: "0.001 ALGO",
            settlementTime: "< 4 seconds",
            tag: "x402-global-challenge",
            protocols: ["AC2", "x402"]
        }
    });
});

const PORT = parseInt(process.env.PORT || "4021");
serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`Bercy FX Orchestrator (AC2 + x402) running on port ${PORT}`);
});

        
