import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const PORT = Number(process.env.PORT || 3001);
const DBURL = String(process.env.DATABASE_URL || "").trim();
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || "dbijl97@outlook.com").trim().toLowerCase();
const SUPPORT_EMAIL = String(process.env.SUPPORT_EMAIL || "info@partydj-dylan.nl").trim();
const PADDLE_API_KEY = String(process.env.PADDLE_API_KEY || "").trim();
const pool = DBURL
  ? new Pool({
      connectionString: DBURL,
      ssl: DBURL.includes("localhost") ? false : { rejectUnauthorized: false }
    })
  : null;

const priceMap = new Map(
  [
    [process.env.PADDLE_PRICE_PLUS, "Plus"],
    [process.env.PADDLE_PRICE_PRO, "Pro"],
    [process.env.PADDLE_PRICE_MAX, "Max"]
  ].filter(([price]) => price)
);

function send(res, status, data) {
  const origin = res.req?.headers?.origin;
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin || "https://saldo-slim.onrender.com",
    "access-control-allow-headers": "content-type,authorization,paddle-signature",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    vary: "Origin"
  };
  res.writeHead(status, headers);
  res.end(status === 204 ? "" : JSON.stringify(data));
}

async function raw(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) {
      const error = new Error("request_too_large");
      error.statusCode = 413;
      throw error;
    }
  }
  return body;
}

async function jsonBody(req) {
  const body = await raw(req);
  try {
    return JSON.parse(body || "{}");
  } catch {
    const error = new Error("invalid_json");
    error.statusCode = 400;
    throw error;
  }
}

function th(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hp(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { s: salt, h: crypto.scryptSync(password, salt, 64).toString("hex") };
}

function vp(password, salt, hash) {
  try {
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function sig(rawBody, header) {
  const secret = String(process.env.PADDLE_WEBHOOK_SECRET || "");
  if (!secret) return false;

  let timestamp = null;
  const hashes = [];
  for (const part of String(header || "").split(";")) {
    const [key, value] = part.split("=");
    if (key === "ts") timestamp = Number(value);
    if (key === "h1") hashes.push(value);
  }

  if (!Number.isFinite(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}:${rawBody}`)
    .digest("hex");

  return hashes.some((hash) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hash, "hex"));
    } catch {
      return false;
    }
  });
}

function priceId(data) {
  for (const item of Array.isArray(data?.items) ? data.items : []) {
    const id = item?.price?.id || item?.price_id;
    if (id) return String(id);
  }
  return null;
}

function paddleApiConfigured() {
  return Boolean(PADDLE_API_KEY);
}

async function schema() {
  if (!pool) return;

  await pool.query(`
    create table if not exists users(
      id uuid primary key,
      name text not null,
      email text unique not null,
      password_hash text not null,
      password_salt text not null,
      plan text not null default 'Basis',
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    alter table users add column if not exists role text not null default 'user';
    alter table users add column if not exists last_login_at timestamptz;

    create table if not exists sessions(
      token_hash text primary key,
      user_id uuid not null references users(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );

    create table if not exists subscriptions(
      id uuid primary key,
      user_id uuid not null references users(id) on delete cascade,
      provider text not null,
      external_subscription_id text,
      external_transaction_id text,
      plan text not null,
      status text not null,
      price_id text,
      updated_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    );

    create unique index if not exists sub_external
      on subscriptions(provider, external_subscription_id)
      where external_subscription_id is not null;

    create table if not exists payment_events(
      event_id text primary key,
      event_type text not null,
      processed_at timestamptz not null default now()
    );

    create table if not exists financial_profiles(
      user_id uuid primary key references users(id) on delete cascade,
      full_name text,
      company_name text,
      address_line1 text,
      address_line2 text,
      city text,
      postal_code text,
      country text,
      tax_id text,
      vat_number text,
      bank_account_holder text,
      iban text,
      bic text,
      payout_email text,
      updated_at timestamptz not null default now()
    );

    create table if not exists support_tickets(
      id uuid primary key,
      user_id uuid not null references users(id) on delete cascade,
      subject text not null,
      message text not null,
      status text not null default 'Open',
      priority text not null default 'Normal',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists payouts(
      id uuid primary key,
      external_payout_id text not null unique,
      status text not null,
      amount text,
      currency text,
      remittance_reference text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table if not exists audit_log(
      id uuid primary key,
      actor_user_id uuid,
      action text not null,
      target_type text,
      target_id text,
      details jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create index if not exists support_tickets_status_idx on support_tickets(status);
    create index if not exists audit_log_created_at_idx on audit_log(created_at desc);
  `);

  await pool.query(
    "update users set role='owner', updated_at=now() where lower(email)=$1 and role<>'owner'",
    [OWNER_EMAIL]
  );
}

function bearer(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    plan: row.plan,
    status: row.status,
    role: row.role,
    ...(row.last_login_at !== undefined ? { last_login_at: row.last_login_at } : {})
  };
}

async function user(req) {
  if (!pool) return null;

  await pool.query(
    "update users set role='owner', updated_at=now() where lower(email)=$1 and role<>'owner'",
    [OWNER_EMAIL]
  );

  const result = await pool.query(
    `select u.id,u.name,u.email,u.plan,u.status,u.role,u.last_login_at
     from sessions s
     join users u on u.id=s.user_id
     where s.token_hash=$1 and s.expires_at>now() and u.status='active'`,
    [th(bearer(req))]
  );
  return result.rows[0] || null;
}

async function session(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(
    "insert into sessions(token_hash,user_id,expires_at) values($1,$2,now()+interval '30 days')",
    [th(token), userId]
  );
  return token;
}

async function requireAdmin(req, res, ownerOnly = false) {
  const current = await user(req);
  if (!current) {
    send(res, 401, { error: "not_logged_in" });
    return null;
  }
  if (ownerOnly ? current.role !== "owner" : !["owner", "moderator"].includes(current.role)) {
    send(res, 403, { error: "forbidden" });
    return null;
  }
  return current;
}

async function audit(actor, action, targetType, targetId, details = {}) {
  await pool.query(
    `insert into audit_log(id,actor_user_id,action,target_type,target_id,details)
     values($1,$2,$3,$4,$5,$6::jsonb)`,
    [crypto.randomUUID(), actor.id, action, targetType, targetId, JSON.stringify(details)]
  );
}

const server = http.createServer(async (req, res) => {
  res.req = req;
  if (req.method === "OPTIONS") return send(res, 204, {});

  const url = new URL(req.url, "http://localhost");
  const key = `${req.method} ${url.pathname}`;

  try {
    if (key === "GET /health") {
      let databaseReady = false;
      if (pool) {
        try {
          await pool.query("select 1");
          databaseReady = true;
        } catch {}
      }
      return send(res, 200, {
        ok: true,
        databaseConfigured: Boolean(pool),
        databaseReady,
        webhookConfigured: Boolean(process.env.PADDLE_WEBHOOK_SECRET),
        paddlePricesConfigured: priceMap.size === 3,
        paddleApiConfigured: paddleApiConfigured(),
        googlePaymentsEnabled: false,
        playStoreDeploymentEnabled: false
      });
    }

    if (key === "POST /auth/register") {
      if (!pool) return send(res, 503, { error: "database_not_configured" });
      const body = await jsonBody(req);
      const name = String(body.name || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!name || !email.includes("@") || password.length < 10) {
        return send(res, 400, { error: "invalid_registration" });
      }

      const passwordData = hp(password);
      const id = crypto.randomUUID();
      const role = email === OWNER_EMAIL ? "owner" : "user";
      try {
        await pool.query(
          `insert into users(id,name,email,password_hash,password_salt,role)
           values($1,$2,$3,$4,$5,$6)`,
          [id, name, email, passwordData.h, passwordData.s, role]
        );
        const created = {
          id,
          name,
          email,
          plan: "Basis",
          status: "active",
          role,
          last_login_at: null
        };
        return send(res, 201, { token: await session(id), user: publicUser(created) });
      } catch (error) {
        if (error.code === "23505") return send(res, 409, { error: "email_exists" });
        throw error;
      }
    }

    if (key === "POST /auth/login") {
      if (!pool) return send(res, 503, { error: "database_not_configured" });
      const body = await jsonBody(req);
      const email = String(body.email || "").trim().toLowerCase();

      await pool.query(
        "update users set role='owner', updated_at=now() where lower(email)=$1 and role<>'owner'",
        [OWNER_EMAIL]
      );

      const result = await pool.query("select * from users where email=$1", [email]);
      const account = result.rows[0];
      if (
        !account ||
        account.status !== "active" ||
        !vp(String(body.password || ""), account.password_salt, account.password_hash)
      ) {
        return send(res, 401, { error: "invalid_login" });
      }

      const updated = await pool.query(
        `update users set last_login_at=now(),role=case when lower(email)=$2 then 'owner' else role end
         where id=$1
         returning id,name,email,plan,status,role,last_login_at`,
        [account.id, OWNER_EMAIL]
      );
      return send(res, 200, {
        token: await session(account.id),
        user: publicUser(updated.rows[0])
      });
    }

    if (key === "POST /auth/password-help") {
      return send(res, 200, {
        ok: true,
        message: "For password assistance, contact support.",
        supportEmail: SUPPORT_EMAIL
      });
    }

    if (key === "GET /me") {
      const current = await user(req);
      if (!current) return send(res, 401, { error: "not_logged_in" });

      const [subscriptionResult, profileResult] = await Promise.all([
        pool.query(
          `select provider,external_subscription_id,plan,status,updated_at
           from subscriptions where user_id=$1 order by updated_at desc limit 1`,
          [current.id]
        ),
        pool.query(
          `select full_name,company_name,address_line1,address_line2,city,postal_code,country,
                  tax_id,vat_number,bank_account_holder,iban,bic,payout_email,updated_at
           from financial_profiles where user_id=$1`,
          [current.id]
        )
      ]);

      return send(res, 200, {
        user: publicUser(current),
        subscription: subscriptionResult.rows[0] || null,
        financialProfile: profileResult.rows[0] || null
      });
    }

    if (key === "PUT /financial-profile") {
      const current = await user(req);
      if (!current) return send(res, 401, { error: "not_logged_in" });
      const body = await jsonBody(req);
      const fields = [
        "full_name",
        "company_name",
        "address_line1",
        "address_line2",
        "city",
        "postal_code",
        "country",
        "tax_id",
        "vat_number",
        "bank_account_holder",
        "iban",
        "bic",
        "payout_email"
      ];
      const values = fields.map((field) => {
        const value = body[field];
        return value == null ? null : String(value).trim();
      });

      const columns = fields.join(",");
      const placeholders = fields.map((_, index) => `$${index + 2}`).join(",");
      const updates = fields.map((field) => `${field}=excluded.${field}`).join(",");
      const result = await pool.query(
        `insert into financial_profiles(user_id,${columns})
         values($1,${placeholders})
         on conflict(user_id) do update set ${updates},updated_at=now()
         returning ${columns},updated_at`,
        [current.id, ...values]
      );
      return send(res, 200, { financialProfile: result.rows[0] });
    }

    if (key === "POST /support") {
      const current = await user(req);
      if (!current) return send(res, 401, { error: "not_logged_in" });
      const body = await jsonBody(req);
      const subject = String(body.subject || "").trim();
      const message = String(body.message || "").trim();
      if (!subject || !message) return send(res, 400, { error: "invalid_ticket" });

      const priority = current.plan === "Max" ? "High" : "Normal";
      const id = crypto.randomUUID();
      const result = await pool.query(
        `insert into support_tickets(id,user_id,subject,message,priority)
         values($1,$2,$3,$4,$5)
         returning id,subject,message,status,priority,created_at,updated_at`,
        [id, current.id, subject, message, priority]
      );
      return send(res, 201, { ticket: result.rows[0] });
    }

    if (key === "GET /billing/web/paddle/config") {
      const current = await user(req);
      if (!current) return send(res, 401, { error: "not_logged_in" });
      if (current.plan && current.plan !== "Basis") {
        return send(res, 409, { error: "active_subscription", plan: current.plan });
      }
      return send(res, 200, {
        clientToken: String(process.env.PADDLE_CLIENT_TOKEN || ""),
        prices: {
          Plus: String(process.env.PADDLE_PRICE_PLUS || ""),
          Pro: String(process.env.PADDLE_PRICE_PRO || ""),
          Max: String(process.env.PADDLE_PRICE_MAX || "")
        },
        userId: current.id
      });
    }

    if (key === "POST /billing/paddle/webhook") {
      const rawBody = await raw(req);
      if (!sig(rawBody, req.headers["paddle-signature"])) {
        return send(res, 401, { error: "invalid_signature" });
      }

      const event = JSON.parse(rawBody || "{}");
      const data = event.data || {};
      const eventId = String(event.event_id || "");
      const eventType = String(event.event_type || "");
      const userId = String(data?.custom_data?.saldo_slim_user_id || "").trim() || null;
      const paddlePriceId = priceId(data);
      const plan = priceMap.get(paddlePriceId) || null;
      const subscriptionId = String(
        data?.subscription_id || (eventType.startsWith("subscription.") ? data.id : "") || ""
      ).trim() || null;
      const transactionId = String(
        eventType.startsWith("transaction.") ? data.id : data.transaction_id || ""
      ).trim() || null;
      const status = String(data.status || "").toLowerCase();

      console.log(
        JSON.stringify({
          eid: eventId,
          et: eventType,
          uid: userId,
          pid: paddlePriceId,
          plan,
          sid: subscriptionId,
          tid: transactionId,
          status
        })
      );

      if (!pool) return send(res, 200, { ok: true, persisted: false });

      const connection = await pool.connect();
      try {
        await connection.query("begin");

        if (
          eventId &&
          (await connection.query("select 1 from payment_events where event_id=$1", [eventId]))
            .rowCount
        ) {
          await connection.query("rollback");
          return send(res, 200, { ok: true, duplicate: true });
        }

        if (eventType === "payout.created" || eventType === "payout.paid") {
          const payoutId = String(data.id || data.payout_id || "").trim();
          if (payoutId) {
            const payoutStatus = String(data.status || eventType.slice("payout.".length));
            const amount = data.amount == null ? null : String(data.amount);
            const currency = data.currency == null ? null : String(data.currency);
            const remittanceReference =
              data.remittance_reference == null
                ? data.reference == null
                  ? null
                  : String(data.reference)
                : String(data.remittance_reference);

            await connection.query(
              `insert into payouts(
                 id,external_payout_id,status,amount,currency,remittance_reference
               ) values($1,$2,$3,$4,$5,$6)
               on conflict(external_payout_id) do update set
                 status=excluded.status,
                 amount=excluded.amount,
                 currency=excluded.currency,
                 remittance_reference=excluded.remittance_reference,
                 updated_at=now()`,
              [
                crypto.randomUUID(),
                payoutId,
                payoutStatus,
                amount,
                currency,
                remittanceReference
              ]
            );
          }
        }

        if (
          userId &&
          (await connection.query("select 1 from users where id=$1", [userId])).rowCount
        ) {
          let nextPlan = null;
          let subscriptionStatus = null;

          if (
            (eventType === "transaction.completed" || eventType === "transaction.paid") &&
            plan
          ) {
            nextPlan = plan;
            subscriptionStatus = "active";
          }

          if (eventType.startsWith("subscription.")) {
            if (status === "active" && plan) {
              nextPlan = plan;
              subscriptionStatus = "active";
            }
            if (status === "past_due") subscriptionStatus = "grace_period";
            if (status === "canceled" || status === "paused") {
              nextPlan = "Basis";
              subscriptionStatus = "cancelled";
            }
          }

          if (nextPlan) {
            await connection.query("update users set plan=$1,updated_at=now() where id=$2", [
              nextPlan,
              userId
            ]);
          }

          if (subscriptionId && (plan || nextPlan)) {
            await connection.query(
              `insert into subscriptions(
                 id,user_id,provider,external_subscription_id,external_transaction_id,
                 plan,status,price_id
               ) values($1,$2,'paddle',$3,$4,$5,$6,$7)
               on conflict(provider,external_subscription_id)
                 where external_subscription_id is not null
               do update set
                 external_transaction_id=excluded.external_transaction_id,
                 plan=excluded.plan,
                 status=excluded.status,
                 price_id=excluded.price_id,
                 updated_at=now()`,
              [
                crypto.randomUUID(),
                userId,
                subscriptionId,
                transactionId,
                plan || nextPlan || "Basis",
                subscriptionStatus || status || "active",
                paddlePriceId
              ]
            );
          }
        }

        if (eventId) {
          await connection.query(
            "insert into payment_events(event_id,event_type) values($1,$2)",
            [eventId, eventType]
          );
        }

        await connection.query("commit");
        return send(res, 200, {
          ok: true,
          persisted: true,
          linkedUser: Boolean(userId),
          plan
        });
      } catch (error) {
        await connection.query("rollback");
        throw error;
      } finally {
        connection.release();
      }
    }

    if (key === "GET /admin/overview") {
      if (!(await requireAdmin(req, res))) return;
      const [usersResult, subscriptionsResult, ticketsResult, payoutsResult, plansResult] =
        await Promise.all([
          pool.query("select count(*)::int as count from users"),
          pool.query("select count(*)::int as count from subscriptions where status='active'"),
          pool.query(
            "select count(*)::int as count from support_tickets where status in ('Open','Pending')"
          ),
          pool.query("select count(*)::int as count from payouts"),
          pool.query("select plan,count(*)::int as count from users group by plan order by plan")
        ]);

      return send(res, 200, {
        userCount: usersResult.rows[0].count,
        activeSubscriptions: subscriptionsResult.rows[0].count,
        openTickets: ticketsResult.rows[0].count,
        payoutCount: payoutsResult.rows[0].count,
        planCounts: Object.fromEntries(plansResult.rows.map((row) => [row.plan, row.count])),
        paddleApiConfigured: paddleApiConfigured(),
        ownerEmail: OWNER_EMAIL,
        supportEmail: SUPPORT_EMAIL
      });
    }

    if (key === "GET /admin/users") {
      if (!(await requireAdmin(req, res))) return;
      const result = await pool.query(
        `select id,name,email,plan,status,role,created_at,updated_at,last_login_at
         from users order by created_at desc`
      );
      return send(res, 200, { users: result.rows });
    }

    if (key === "GET /admin/subscriptions") {
      if (!(await requireAdmin(req, res))) return;
      const result = await pool.query(
        `select s.id,s.user_id,u.email,s.provider,s.external_subscription_id,
                s.external_transaction_id,s.plan,s.status,s.price_id,s.created_at,s.updated_at
         from subscriptions s join users u on u.id=s.user_id
         order by s.updated_at desc`
      );
      return send(res, 200, { subscriptions: result.rows });
    }

    if (key === "GET /admin/payouts") {
      if (!(await requireAdmin(req, res))) return;
      const result = await pool.query(
        `select id,external_payout_id,status,amount,currency,remittance_reference,
                created_at,updated_at
         from payouts order by updated_at desc`
      );
      return send(res, 200, { payouts: result.rows });
    }

    if (key === "GET /admin/support") {
      if (!(await requireAdmin(req, res))) return;
      const result = await pool.query(
        `select t.id,t.user_id,u.name as user_name,u.email,t.subject,t.message,
                t.status,t.priority,t.created_at,t.updated_at
         from support_tickets t join users u on u.id=t.user_id
         order by t.created_at desc`
      );
      return send(res, 200, { tickets: result.rows });
    }

    if (key === "GET /admin/audit") {
      if (!(await requireAdmin(req, res, true))) return;
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 100, 500));
      const result = await pool.query(
        `select id,actor_user_id,action,target_type,target_id,details,created_at
         from audit_log order by created_at desc limit $1`,
        [limit]
      );
      return send(res, 200, { audit: result.rows });
    }

    const roleMatch = req.method === "POST" && url.pathname.match(/^\\/admin\\/users\\/([^/]+)\\/role$/);
    if (roleMatch) {
      const actor = await requireAdmin(req, res, true);
      if (!actor) return;
      const body = await jsonBody(req);
      const role = String(body.role || "");
      if (!["user", "moderator"].includes(role)) {
        return send(res, 400, { error: "invalid_role" });
      }

      const result = await pool.query(
        `update users set role=$1,updated_at=now()
         where id=$2 and role<>'owner' and lower(email)<>$3
         returning id,name,email,plan,status,role,created_at,updated_at,last_login_at`,
        [role, roleMatch[1], OWNER_EMAIL]
      );
      if (!result.rowCount) return send(res, 404, { error: "user_not_found_or_protected" });

      await audit(actor, "user.role.updated", "user", result.rows[0].id, { role });
      return send(res, 200, { user: result.rows[0] });
    }

    const userStatusMatch =
      req.method === "POST" && url.pathname.match(/^\\/admin\\/users\\/([^/]+)\\/status$/);
    if (userStatusMatch) {
      const actor = await requireAdmin(req, res, true);
      if (!actor) return;
      const body = await jsonBody(req);
      const status = String(body.status || "");
      if (!["active", "disabled"].includes(status)) {
        return send(res, 400, { error: "invalid_status" });
      }

      const result = await pool.query(
        `update users set status=$1,updated_at=now()
         where id=$2 and role<>'owner' and lower(email)<>$3
         returning id,name,email,plan,status,role,created_at,updated_at,last_login_at`,
        [status, userStatusMatch[1], OWNER_EMAIL]
      );
      if (!result.rowCount) return send(res, 404, { error: "user_not_found_or_protected" });

      await audit(actor, "user.status.updated", "user", result.rows[0].id, { status });
      return send(res, 200, { user: result.rows[0] });
    }

    const ticketStatusMatch =
      req.method === "POST" && url.pathname.match(/^\\/admin\\/support\\/([^/]+)\\/status$/);
    if (ticketStatusMatch) {
      const actor = await requireAdmin(req, res, true);
      if (!actor) return;
      const body = await jsonBody(req);
      const status = String(body.status || "");
      if (!["Open", "Pending", "Closed"].includes(status)) {
        return send(res, 400, { error: "invalid_status" });
      }

      const result = await pool.query(
        `update support_tickets set status=$1,updated_at=now()
         where id=$2
         returning id,user_id,subject,message,status,priority,created_at,updated_at`,
        [status, ticketStatusMatch[1]]
      );
      if (!result.rowCount) return send(res, 404, { error: "ticket_not_found" });

      await audit(actor,