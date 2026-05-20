/**
 * Stripe billing — placeholder routes.
 *
 * Goal: route plumbing is in place so the frontend can call /api/billing/*
 * without crashing, but we don't yet require Stripe to be configured.
 * When env vars are missing, every endpoint returns a clean 503 with a
 * `billing_not_configured` code so the UI can present a friendly state.
 *
 * Once STRIPE_SECRET_KEY etc. are set, these handlers can be filled in
 * with the actual checkout/portal/webhook logic. Webhook signature check
 * is the only thing that must NOT be skipped — leave the stub guarded so
 * an unconfigured deployment never blindly trusts a webhook payload.
 */

import type { Express, Request, Response } from "express";
import { requireAuth } from "./accessMiddleware";
import { getSubscriptionStatusForUser } from "./appMode";

function isBillingConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

function notConfiguredResponse(res: Response, op: string): void {
  res.status(503).json({
    error: "Billing is not configured yet.",
    code: "billing_not_configured",
    op,
  });
}

export function registerBillingRoutes(app: Express): void {
  // POST /api/billing/create-checkout-session
  // Starts a Stripe Checkout flow for the authenticated user.
  app.post("/api/billing/create-checkout-session", requireAuth, async (req: Request, res: Response) => {
    if (!isBillingConfigured()) return notConfiguredResponse(res, "create-checkout-session");
    // TODO: implement via `stripe.checkout.sessions.create({...})` once
    // STRIPE_PRICE_ID + APP_WRITE_URL are stable. The handler should:
    //   - look up or create the Stripe customer for req.dcUserId
    //   - create a checkout session with success_url / cancel_url pointing
    //     back to the write-access domain
    //   - return { url } so the client can window.location to Stripe
    res.status(501).json({
      error: "Checkout session creation not yet implemented.",
      code: "not_implemented",
    });
  });

  // POST /api/billing/create-portal-session
  // Opens Stripe's customer portal for managing subscription / payment.
  app.post("/api/billing/create-portal-session", requireAuth, async (req: Request, res: Response) => {
    if (!isBillingConfigured()) return notConfiguredResponse(res, "create-portal-session");
    res.status(501).json({
      error: "Portal session creation not yet implemented.",
      code: "not_implemented",
    });
  });

  // POST /api/billing/webhook
  // Stripe sends subscription lifecycle events here. MUST verify the
  // signature before trusting the payload — leaving as a deliberate stub
  // so an unconfigured deployment can't accidentally process events.
  app.post("/api/billing/webhook", async (req: Request, res: Response) => {
    if (!isBillingConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
      return notConfiguredResponse(res, "webhook");
    }
    // TODO: verify req signature via `stripe.webhooks.constructEvent(
    //   rawBody, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET)`
    // before reading anything off `event.data.object`. On
    // customer.subscription.{created,updated,deleted}, mirror the new
    // status onto sc_users.
    res.status(501).json({
      error: "Webhook handling not yet implemented.",
      code: "not_implemented",
    });
  });

  // GET /api/billing/status
  // Lightweight read for the UI — combines our DB-side subscription
  // record with a config-status flag so the client knows whether Stripe
  // is even online yet. Safe to call from any host.
  app.get("/api/billing/status", requireAuth, async (req: Request, res: Response) => {
    const dcUserId = (req as any).dcUserId as string;
    const subscription = await getSubscriptionStatusForUser(dcUserId);
    res.json({
      configured: isBillingConfigured(),
      subscription,
    });
  });
}
