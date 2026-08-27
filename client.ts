// BERCY x402 SUPER CLIENT — ALGORAND MAINNET
import { config } from "dotenv";
import algosdk from "algosdk";

config();

const SERVER_URL  = "https://bercy-x402-production.up.railway.app";
const ALGOD_URL   = "https://mainnet-api.algonode.cloud";
const USDC_ASA_ID = 31566704;
const MNEMONIC    = process.env.WALLET_MNEMONIC!;

// ─── HELPERS ──────────────────────────────────────────────────
const log = {
    info:    (m: string) => console.log(`\x1b[36mℹ️  ${m}\x1b[0m`),
    success: (m: string) => console.log(`\x1b[32m✅ ${m}\x1b[0m`),
    error:   (m: string) => console.log(`\x1b[31m❌ ${m}\x1b[0m`),
    warn:    (m: string) => console.log(`\x1b[33m⚠️  ${m}\x1b[0m`),
    title:   (m: string) => console.log(`\x1b[1m\n🦅 ${m}\x1b[0m\n`),
};

// ─── MAIN ─────────────────────────────────────────────────────
async function main() {
    log.title("Bercy x402 Client — Algorand Mainnet");

    // 1. Validate mnemonic
    if (!MNEMONIC) {
        log.error("WALLET_MNEMONIC not set in .env");
        process.exit(1);
    }

    // 2. Load wallet
    let account: { addr: string; sk: Uint8Array };
    try {
        account = algosdk.mnemonicToSecretKey(MNEMONIC);
        log.info(`Wallet: ${account.addr}`);
    } catch {
        log.error("Invalid mnemonic. Check WALLET_MNEMONIC in .env");
        process.exit(1);
    }

    // 3. Check balances
    const algod = new algosdk.Algodv2("", ALGOD_URL, "");
    let algo = 0;
    let usdcBalance = 0;

    try {
        const info = await algod.accountInformation(account.addr).do();
        algo = Number(info.amount) / 1_000_000;
        const usdcAsset = (info.assets as Array<{ assetId: number; amount: bigint | number }>)
            ?.find(a => a.assetId === USDC_ASA_ID);
        usdcBalance = usdcAsset ? Number(usdcAsset.amount) / 1_000_000 : 0;

        log.info(`ALGO balance:  ${algo.toFixed(4)} ALGO`);
        log.info(`USDC balance:  $${usdcBalance.toFixed(4)} USDC`);
        log.info(`Min needed:    0.2 ALGO + $0.10 USDC\n`);
    } catch {
        log.error("Could not reach Algorand Mainnet. Check internet connection.");
        process.exit(1);
    }

    // 4. Balance checks
    if (algo < 0.2) {
        log.error(`Not enough ALGO (have ${algo.toFixed(4)}, need 0.2)`);
        log.warn(`Send ALGO to: ${account.addr}`);
        return;
    }
    if (usdcBalance < 0.10) {
        log.error(`Not enough USDC (have $${usdcBalance.toFixed(4)}, need $0.10)`);
        log.warn(`Send USDC to: ${account.addr}`);
        log.warn("Remember: opt-in to USDC (ASA 31566704) in Pera Wallet first!");
        return;
    }

    // 5. Step 1 — AC2 authorization
    log.info("Step 1: Requesting AC2 human approval...");
    try {
        const ac2Res = await fetch(`${SERVER_URL}/api/authorize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                from: "DZD",
                to: "EUR",
                amount: 1000,
                agent_did: `did:key:z${account.addr.slice(0, 20)}`
            })
        });
        const ac2Data = await ac2Res.json() as { approved: boolean; approval_id: string };
        if (!ac2Data.approved) {
            log.error("AC2 approval denied");
            return;
        }
        log.success(`AC2 approved! ID: ${ac2Data.approval_id}`);
    } catch {
        log.error("AC2 authorization failed");
        return;
    }

    // 6. Step 2 — x402 payment to /api/orchestrate
    log.info("Step 2: Calling /api/orchestrate (x402 payment)...");

    const res = await fetch(`${SERVER_URL}/api/orchestrate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "DZD", to: "EUR", amount: 1000 })
    });

    console.log(`\nHTTP Status: ${res.status}`);

    if (res.status === 402) {
        log.success("x402 gate working! Payment required.");
        const payReq = await res.json();
        console.log("\nPayment details:");
        console.log(JSON.stringify(payReq, null, 2));
        log.warn("Next: add USDC + run again to complete payment");

    } else if (res.status === 200) {
        const result = await res.json() as { success: boolean; route: Record<string, unknown> };
        log.success("PAYMENT COMPLETE! FX Route:");
        console.log(JSON.stringify(result.route, null, 2));
        log.success("Bercy is on the leaderboard! 🏆");

    } else {
        log.error(`Unexpected status: ${res.status}`);
        console.log(await res.text());
    }
}

main().catch(e => {
    console.error("\n❌ Fatal error:", e.message);
    process.exit(1);
});

        
