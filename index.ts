          
// BERCY FX ORCHESTRATOR - MAINNET
import { config } from "dotenv";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactAvmScheme } from "@x402/avm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402-avm/extensions";
import type { ResourceServerExtension } from "@x402/core/types";
import { ALGORAND_MAINNET_CAIP2, USDC_MAINNET_ASA_ID } from "@x402/avm";

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

app.get("/api/health", (c) => c.json({ status: "ok", service: "Bercy FX Orchestrator" }));

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
                description: "Bercy cross-border payment orchestrator: finds optimal route across 20+ currency corridors using USDC on Algorand. Input: { from, to, amount }. Returns: best FX rate, output amount, settlement path.",
                mimeType: "application/json",
                extensions: declareDiscoveryExtension({
                    input: {
                        method: "POST",
                        schema: {
                            type: "object",
                            properties: {
                                from: { type: "string" },
                                to: { type: "string" },
                                amount: { type: "number" }
                            },
                            required: ["from", "to", "amount"]
                        }
                    },
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
            tag: "x402-global-challenge"
        }
    });
});

const PORT = parseInt(process.env.PORT || "4021");
serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`Bercy FX Orchestrator running on port ${PORT}`);
});

        
