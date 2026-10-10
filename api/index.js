import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

const { Pool } = pg;
const PORT = Number(process.env.PORT || 3001);
const DBURL = String(process.env.DATABASE_URL || "").trim();
const OWNER_EMAIL = String(process.env.OWNER_EMAIL || "dbijl97@outlook.com").trim().toLowerCase();
const SUPPORT_EMAIL = String(process.env.SUPPORT_EMAIL || "info@partydj-dylan.nl").trim();
const PADDLE_API_KEY = String(process.env.PADDLE_API_KEY || "").trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const PASSWORD_RESET_FROM = String(
  process.env.PASSWORD_RESET_FROM || "Saldo Slim <info@partydj-dylan.nl>"
).trim();
const PUBLIC_APP_URL = String(
  process.env.PUBLIC_APP_URL || "https://saldo.partydj-dylan.nl"
).trim().replace(/\/+$/, "");

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

const ALLOWED_ORIGINS = new Set([
  "https://saldo-slim.onrender.com",
  "https://partydj-dylan.nl",
  "https://www.partydj-dylan.nl",
  "https://saldo.partydj-dylan.nl",
  "https://saldoslim.partydj-dylan.nl"
]);

function send(res, status, data) {
  const origin = String(res.req?.headers?.origin || "");
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-headers": "content-type,authorization,paddle-signature",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    vary: "Origin"
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["access-control-allow-origin"] = origin;
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

function passwordEmailConfigured() {
  return Boolean(RESEND_API_KEY);
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
    alter table users add column if not exists first_name text;
    alter table users add column if not exists last_name text;
    alter table users add column if not exists age int;
    alter table users add column if not exists phone text;

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

    create table if not exists budget_profiles(
      user_id uuid primary key references users(id) on delete cascade,
      income numeric not null default 0,
      fixed_expenses numeric not null default 0,
      reservations numeric not null default 0,
      days_remaining int not null default 30,
      updated_at timestamptz not null default now()
    );

    create table if not exists password_reset_tokens(
      id uuid primary key,
      user_id uuid not null references users(id) on delete cascade,
      token_hash text unique not null,
      expires_at timestamptz not null,
      used_at timestamptz,
      created_at timestamptz not null default now()
    );

    create index if not exists password_reset_tokens_user_idx
      on password_reset_tokens(user_id);

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
    create table if not exists bank_tickets(
      id uuid primary key, user_id uuid not null references users(id) on delete cascade,
      service text not null, created_at timestamptz not null default now(),
      expires_at timestamptz not null, used_at timestamptz
    );
    create table if not exists bank_results(
      id uuid primary key, user_id uuid not null references users(id) on delete cascade,
      ticket_id uuid not null unique references bank_tickets(id) on delete cascade,
      service text not null, result jsonb not null,
      created_at timestamptz not null default now()
    );
    create index if not exists bank_results_user_idx on bank_results(user_id,created_at desc);
  `);

  await pool.query(
    "update users set role='owner', updated_at=now() where lower(email)=$1 and role<>'owner'",
    [OWNER_EMAIL]
  );
}

function bearer(req) {
  return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
}

function naturalNames(row) {
  const fallback = String(row.name || "").trim().split(/\s+/);
  return {
    firstName: row.first_name ?? fallback[0] ?? "",
    lastName: row.last_name ?? fallback.slice(1).join(" ")
  };
}

function publicUser(row) {
  if (!row) return null;
  const names = naturalNames(row);
  return {
    id: row.id,
    name: row.name,
    firstName: names.firstName,
    lastName: names.lastName,
    age: row.age ?? null,
    phone: row.phone ?? null,
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
    `select u.id,u.name,u.first_name,u.last_name,u.age,u.phone,u.email,u.plan,u.status,u.role,u.last_login_at
     from sessions s
     join users u on u.id=s.user_id
     where s.token_hash=$1 and s.expires_at>now() and u.status='active'`,
    [th(bearer(req))]
  );
  const current = result.rows[0] || null;
  if (current && String(current.email || "").trim().toLowerCase() === OWNER_EMAIL) {
    current.role = "owner";
  }
  return current;
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

async function createPasswordReset(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query("begin");
  try {
    await pool.query(
      `update password_reset_tokens
       set used_at=now()
       where user_id=$1 and used_at is null`,
      [userId]
    );
    await pool.query(
      `insert into password_reset_tokens(id,user_id,token_hash,expires_at)
       values($1,$2,$3,now()+interval '30 minutes')`,
      [crypto.randomUUID(), userId, th(token)]
    );
    await pool.query("commit");
    return token;
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
}

async function sendPasswordResetEmail(email, token) {
  if (!RESEND_API_KEY) return false;

  const resetUrl = `${PUBLIC_APP_URL}/reset-password.html?token=${encodeURIComponent(token)}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: PASSWORD_RESET_FROM,
      to: [email],
      subject: "Wachtwoord opnieuw instellen - Saldo Slim",
      text: `Gebruik de volgende link om je wachtwoord opnieuw in te stellen:\n\n${resetUrl}\n\nDeze link verloopt over 30 minuten.`,
      html: `<p>Gebruik de volgende link om je wachtwoord opnieuw in te stellen:</p><p><a href="${resetUrl}">Wachtwoord opnieuw instellen</a></p><p>Deze link verloopt over 30 minuten.</p>`
    })
  });
  return response.ok;
}

function budgetProfile(row) {
  if (!row) return null;
  const income = Number(row.income);
  const fixedExpenses = Number(row.fixed_expenses);
  const reservations = Number(row.reservations);
  const daysRemaining = Number(row.days_remaining);
  const room = income - fixedExpenses - reservations;
  return {
    income,
    fixed_expenses: fixedExpenses,
    reservations,
    days_remaining: daysRemaining,
    updated_at: row.updated_at ?? null,
    room,
    safeDaily: Math.max(0, room / daysRemaining),
    warning: room < 0
  };
}

function entitlementData(current) {
  const privileged = ["owner", "moderator"].includes(current.role);
  const rankByPlan = { Basis: 0, Basic: 0, Plus: 1, Pro: 2, Max: 3 };
  const effectivePlan = privileged ? "Max" : (current.plan || "Basis");
  const rank = privileged ? 3 : (rankByPlan[effectivePlan] ?? 0);
  const features = {
    safeDaily: rank >= 0,
    planning: rank >= 1,
    fixedExpenseEditing: rank >= 1,
    smartWarnings: rank >= 1,
    scenarios3: rank >= 1,
    unlimitedCalculations: rank >= 2,
    smartNotifications25: rank >= 2,
    savingsGoals: rank >= 2,
    analyses: rank >= 2,
    forecasts: rank >= 2,
    export: rank >= 2,
    unlimitedSmartNotifications: rank >= 3,
    advancedScenarios: rank >= 3,
    longerOutlook: rank >= 3,
    protectionWarnings: rank >= 3,
    prioritySupport: rank >= 3,
    bankConnect: rank >= 2,
    bankAdvancedSettings: rank >= 3,
    adminFullAccess: privileged
  };
  return { effectivePlan, features };
}

async function updateSubscriptionUserPlan(connection, userId, plan, status) {
  if (!userId) return;
  const active = ["active", "trialing", "past_due"].includes(String(status || "").toLowerCase());
  await connection.query(
    `update users set plan=$1,updated_at=now() where id=$2`,
    [active && plan ? plan : "Basis", userId]
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
        passwordEmailConfigured: passwordEmailConfigured(),
        googlePaymentsEnabled: false,
        playStoreDeploymentEnabled: false
      });
    }

    if (key === "POST /auth/register") {
      if (!pool) return send(res, 503, { error: "database_not_configured" });
      const body = await jsonBody(req);
      const firstName = String(body.firstName ?? "").trim();
      const lastName = String(body.lastName ?? "").trim();
      const age = body.age;
      const email = String(body.email || "").trim().toLowerCase();
      const phone = String(body.phone ?? "").trim();
      const password = String(body.password || "");

      if (
        !firstName ||
        !lastName ||
        !Number.isInteger(age) ||
        age < 16 ||
        age > 120 ||
        !email.includes("@") ||
        phone.length < 6 ||
        phone.length > 30 ||
        password.length < 10
      ) {
        return send(res, 400, { error: "invalid_registration" });
      }

      const name = `${firstName} ${lastName}`;
      const passwordData = hp(password);
      const id = crypto.randomUUID();
      const role = email === OWNER_EMAIL ? "owner" : "user";
      try {
        await pool.query(
          `insert into users(id,name,first_name,last_name,age,phone,email,password_hash,password_salt,role)
           values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, name, firstName, lastName, age, phone, email, passwordData.h, passwordData.s, role]
        );
        const created = {
          id,
          name,
          first_name: firstName,
          last_name: lastName,
          age,
          phone,
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
         returning id,name,first_name,last_name,age,phone,email,plan,status,role,last_login_at`,
        [account.id, OWNER_EMAIL]
      );
      return send(res, 200, {
        token: await session(account.id),
        user: publicUser(updated.rows[0])
      });
    }

    if (
      key === "POST /auth/password-reset/request" ||
      key === "POST /auth/password-help"
    ) {
      const body = await jsonBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      if (pool && email) {
        const result = await pool.query(
          "select id,email from users where email=$1",
          [email]
        );
        if (result.rows[0]) {
          const token = await createPasswordReset(result.rows[0].id);
          if (RESEND_API_KEY) {
            try {
              await sendPasswordResetEmail(result.rows[0].email, token);
            } catch {
              // Never expose or log reset tokens or email-provider details here.
            }
          }
        }
      }
      return send(res, 200, {
        ok: true,
        message: "Als er een account met dit e-mailadres bestaat, ontvang je instructies."
      });
    }

    if (key === "POST /auth/password-reset/confirm") {
      if (!pool) return send(res, 503, { error: "database_not_configured" });
      const body = await jsonBody(req);
      const token = String(body.token || "");
      const password = String(body.password || "");
      if (password.length < 10) return send(res, 400, { error: "invalid_password" });
      if (!token) return send(res, 400, { error: "invalid_or_expired_token" });

      const passwordData = hp(password);
      const connection = await pool.connect();
      let changed = false;
      try {
        await connection.query("begin");
        const tokenResult = await connection.query(
          `select id,user_id
           from password_reset_tokens
           where token_hash=$1 and used_at is null and expires_at>now()
           for update`,
          [th(token)]
        );

        if (tokenResult.rowCount) {
          const resetToken = tokenResult.rows[0];
          await connection.query("select id from users where id=$1 for update", [resetToken.user_id]);
          const stillValid = await connection.query(
            `select id from password_reset_tokens
             where id=$1 and used_at is null and expires_at>now()`,
            [resetToken.id]
          );

          if (stillValid.rowCount) {
            await connection.query(
              `update users
               set password_hash=$1,password_salt=$2,updated_at=now()
               where id=$3`,
              [passwordData.h, passwordData.s, resetToken.user_id]
            );
            await connection.query(
              "update password_reset_tokens set used_at=now() where id=$1",
              [resetToken.id]
            );
            await connection.query("delete from sessions where user_id=$1", [resetToken.user_id]);
            await connection.query(
              `update password_reset_tokens
               set used_at=now()
               where user_id=$1 and used_at is null`,
              [resetToken.user_id]
            );
            changed = true;
          }
        }
        await connection.query("commit");
      } catch (error) {
        await connection.query("rollback");
        throw error;
      } finally {
        connection.release();
      }

      if (!changed) return send(res, 400, { error: "invalid_or_expired_token" });
      return send(res, 200, { ok: true });
    }

    if (key === "POST /admin/password-reset") {
      const actor = await requireAdmin(req, res, true);
      if (!actor) return;
      if (!pool) return send(res, 503, { error: "database_not_configured" });
      if (!RESEND_API_KEY) {
        return send(res, 503, {
          error: "email_provider_not_configured",
          configurationPage: "/installeren.html"
        });
      }

      const body = await jsonBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      if (!email) return send(res, 400, { error: "invalid_email" });

      const result = await pool.query(
        "select id,email,role from users where email=$1",
        [email]
      );
      const target = result.rows[0];
      if (!target || (email !== OWNER_EMAIL && target.role === "owner")) {
        return send(res, 404, { error: "user_not_found_or_protected" });
      }

      const token = await createPasswordReset(target.id);
      let sent;
      try {
        sent = await sendPasswordResetEmail(target.email, token);
      } catch {
        sent = false;
      }
      if (!sent) return send(res, 502, { error: "email_send_failed" });

      await audit(actor, "password_reset.requested", "user", target.id);
      return send(res, 200, { ok: true });
    }

    if (key === "GET /me") {
      const current = await user(req);
      if (!current) return send(res, 401, { error: "not_logged_in" });

      const [subscriptionResult, profileResult, budgetResult] = await Promise.all([
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
        ),
        pool.query(
          `select income,fixed_expenses,reservations,days_remaining,updated_at
           from budget_profiles where user_id=$1`,
          [current.id]
        )
      ]);

      return send(res, 200, {
        user: publicUser(current),
        subscription: subscriptionResult.rows[0] || null,
        financialProfile: profileResult.rows[0] || null,
        budgetProfile: budgetProfile(
          budgetResult.rows[0] || {
            income: 0,
            fixed_expenses: 0,
            reservations: 0,
            days_remaining: 30,
            updated_at: null
          }
        )
      });
    }


    // Read-only YAXI integration: tickets never authorize payments.
    if (key === "GET /bank-connect/status") {
      const current = await user(req);
      if (!current) return send(res,401,{error:"not_logged_in"});
      const rights=entitlementData(current);
      return send(res,200,{provider:"YAXI",configured:Boolean(process.env.YAXI_TEST_MODE==="true"?(process.env.YAXI_TEST_KEY_ID&&process.env.YAXI_TEST_API_KEY):(process.env.YAXI_KEY_ID&&process.env.YAXI_API_KEY)),environment:process.env.YAXI_TEST_MODE==="true"?"Integration":"Production",allowed:rights.features.bankConnect,advanced:rights.features.bankAdvancedSettings,services:["Accounts","Balances","Transactions"],connectionEstablished:false});
    }
    if (key === "POST /bank-connect/ticket") {
      const current = await user(req);
      if (!current) return send(res,401,{error:"not_logged_in"});
      if (!entitlementData(current).features.bankConnect) return send(res,403,{error:"pro_or_max_required"});
      const testMode=process.env.YAXI_TEST_MODE==="true";
      const kid=testMode?process.env.YAXI_TEST_KEY_ID:process.env.YAXI_KEY_ID,secret=testMode?process.env.YAXI_TEST_API_KEY:process.env.YAXI_API_KEY;
      if (!kid||!secret) return send(res,503,{error:"bank_provider_not_configured"});
      const body=await jsonBody(req);
      const service=String(body.service||"");
      if (!["Accounts","Balances","Transactions"].includes(service)) return send(res,400,{error:"read_only_services_only"});
      let data=null;
      if(service==="Transactions") {
        const iban=String(body.iban||"").replace(/\s/g,"").toUpperCase();
        const currency=String(body.currency||"EUR").toUpperCase();
        const from=String(body.from||"");
        if(!/^[A-Z]{2}[A-Z0-9]{13,32}$/.test(iban)||!/^[A-Z]{3}$/.test(currency)||!/^\d{4}-\d{2}-\d{2}$/.test(from)) return send(res,400,{error:"invalid_transaction_parameters"});
        data={account:{iban,currency},range:{from}};
      }
      const id=crypto.randomUUID(),exp=Math.floor(Date.now()/1000)+600;
      const b64=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
      const h=b64({alg:'HS256',typ:'JWT',kid});
      const p=b64({data:{service,id,data},exp});
      let keyBytes;
      try { keyBytes=Buffer.from(secret,'base64');if(keyBytes.length<16) throw Error('invalid secret'); }
      catch {return send(res,503,{error:'bank_provider_key_invalid'});}
      const signature=crypto.createHmac('sha256',keyBytes).update(h+'.'+p).digest('base64url');
      await pool.query('insert into bank_tickets(id,user_id,service,expires_at) values($1,$2,$3,to_timestamp($4))',[id,current.id,service,exp]);
      return send(res,200,{ticket:h+'.'+p+'.'+signature,ticketId:id,service,expiresAt:new Date(exp*1000).toISOString()});
    }

    if (key === "POST /bank-connect/result") {
      const current=await user(req);
      if(!current) return send(res,401,{error:"not_logged_in"});
      if(!entitlementData(current).features.bankConnect) return send(res,403,{error:"pro_or_max_required"});
      const body=await jsonBody(req),token=String(body.jwt||"");
      if(token.length>400000) return send(res,413,{error:"result_too_large"});
      const parts=token.split(".");
      if(parts.length!==3) return send(res,400,{error:"invalid_result"});
      let header,payload;
      try{header=JSON.parse(Buffer.from(parts[0],"base64url"));payload=JSON.parse(Buffer.from(parts[1],"base64url"));}
      catch{return send(res,400,{error:"invalid_result"});}
      if(header.alg!=="HS256"||header.kid!==(process.env.YAXI_TEST_MODE==="true"?process.env.YAXI_TEST_KEY_ID:process.env.YAXI_KEY_ID)||!(process.env.YAXI_TEST_MODE==="true"?process.env.YAXI_TEST_API_KEY:process.env.YAXI_API_KEY)) return send(res,400,{error:"invalid_result"});
      const keyBytes=Buffer.from(process.env.YAXI_TEST_MODE==="true"?process.env.YAXI_TEST_API_KEY:process.env.YAXI_API_KEY,"base64");
      const expected=crypto.createHmac("sha256",keyBytes).update(parts[0]+"."+parts[1]).digest();
      let supplied;
      try{supplied=Buffer.from(parts[2],"base64url");}catch{return send(res,400,{error:"invalid_result"});}
      if(expected.length!==supplied.length||!crypto.timingSafeEqual(expected,supplied)) return send(res,400,{error:"invalid_signature"});
      const ticketId=String(payload?.data?.ticketId||"");
      const timestamp=Date.parse(payload?.data?.timestamp||"");
      if(!/^[0-9a-f-]{36}$/i.test(ticketId)||!Number.isFinite(timestamp)||Math.abs(Date.now()-timestamp)>15*60*1000|| (payload.exp&&payload.exp*1000<Date.now())) return send(res,400,{error:"expired_or_invalid_result"});
      const tx=await pool.connect();
      try{
        await tx.query("begin");
        const ticket=await tx.query("select service from bank_tickets where id=$1 and user_id=$2 and used_at is null and expires_at>now() for update",[ticketId,current.id]);
        if(!ticket.rowCount){await tx.query("rollback");return send(res,409,{error:"ticket_not_found_or_used"});}
        const service=ticket.rows[0].service;
        const data=payload.data.data;
        if(service==="Accounts"&&!Array.isArray(data)) throw Error("invalid_accounts");
        if(service==="Balances"&&!Array.isArray(data?.balances)) throw Error("invalid_balances");
        if(service==="Transactions"&&!Array.isArray(data)) throw Error("invalid_transactions");
        await tx.query("insert into bank_results(id,user_id,ticket_id,service,result) values($1,$2,$3,$4,$5::jsonb)",[crypto.randomUUID(),current.id,ticketId,service,JSON.stringify(data)]);
        await tx.query("update bank_tickets set used_at=now() where id=$1",[ticketId]);
        await tx.query("commit");
        return send(res,200,{ok:true,service});
      }catch(err){await tx.query("rollback");if(String(err.message).startsWith("invalid_")) return send(res,400,{error:"invalid_result_data"});throw err;}
      finally{tx.release();}
    }
    if(key==="GET /bank-connect/data"){
      const current=await user(req);
      if(!current) return send(res,401,{error:"not_logged_in"});
      if(!entitlementData(current).features.bankConnect) return send(res,403,{error:"pro_or_max_required"});
      const rows=await pool.query("select service,result,created_at from bank_results where user_id=$1 order by created_at desc limit 100",[current.id]);
      const latest={};
      for(const row of rows.rows) if(!latest[row.service]) latest[row.service]=row.result;
      const transactions=Array.isArray(latest.Transactions)?latest.Transactions:[];
      const expenses=transactions.filter(t=>Number(t?.amount?.amount)<0);
      const income=transactions.filter(t=>Number(t?.amount?.amount)>0);
      const sum=xs=>Math.round(xs.reduce((n,t)=>n+Math.abs(Number(t.amount.amount)||0),0)*100)/100;
      return send(res,200,{accounts:latest.Accounts||[],balances:latest.Balances?.balances||[],transactions:transactions.slice(0,100),analysis:{income:sum(income),expenses:sum(expenses),net:Math.round((sum(income)-sum(expenses))*100)/100,transactionCount:transactions.length},lastUpdated:rows.rows[0]?.created_at||null});
    }
    if (key === "GET /entitlements") {
      const current = await user(req);
      if (!current) return send(res, 401, { error: "not_logged_in" });
      return send(res, 200, entitlementData(current));
    }

    if (key === "GET /budget-profile") {
      const current = await user(req);
      if (!current) return send(res, 401, { error: "not_logged_in" });
      const result = await pool.query(
        `select income,fixed_expenses,reservations,days_remaining,updated_at
         from budget_profiles where user_id=$1`,
        [current.id]
      );
      return send(res, 200, {
        budgetProfile: budgetProfile(
          result.rows[0] || {
            income: 0,
            fixed_expenses: 0,
            reservations: 0,
            days_remaining: 30,
            updated_at: null
          }
        )
      });
    }

    if (key === "PUT /budget-profile") {
      const current = await user(req);
      if (!current) return send(res, 401, { error: "not_logged_in" });
      const body = await jsonBody(req);

      const existingResult = await pool.query(
        `select income,fixed_expenses,reservations,days_remaining
         from budget_profiles where user_id=$1`,
        [current.id]
      );
      const existing = existingResult.rows[0] || {
        income: 0,
        fixed_expenses: 0,
        reservations: 0,
        days_remaining: 30
      };

      const income = Number(body.income ?? existing.income);
      const fixedExpenses = Number(body.fixed_expenses ?? existing.fixed_expenses);
      const reservations = Number(body.reservations ?? existing.reservations);
      const daysRemaining = Number(body.days_remaining ?? existing.days_remaining);

      if (
        ![income, fixedExpenses, reservations].every(
          (value) => Number.isFinite(value) && value >= 0
        ) ||
        !Number.isInteger(daysRemaining) ||
        daysRemaining < 1 ||
        daysRemaining > 366
      ) {
        return send(res, 400, { error: "invalid_budget_profile" });
      }

      const result = await pool.query(
        `insert into budget_profiles(user_id,income,fixed_expenses,reservations,days_remaining)
         values($1,$2,$3,$4,$5)
         on conflict(user_id) do update set
           income=excluded.income,
           fixed_expenses=excluded.fixed_expenses,
           reservations=excluded.reservations,
           days_remaining=excluded.days_remaining,
           updated_at=now()
         returning income,fixed_expenses,reservations,days_remaining,updated_at`,
        [current.id, income, fixedExpenses, reservations, daysRemaining]
      );
      return send(res, 200, { budgetProfile: budgetProfile(result.rows[0]) });
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

      const priority =
        current.plan === "Max" || ["owner", "moderator"].includes(current.role)
          ? "High"
          : "Normal";
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
      if (["owner", "moderator"].includes(current.role)) {
        return send(res, 403, { error: "admin_does_not_require_subscription" });
      }
      if (current.plan && current.plan !== "Basis" && current.plan !== "Basic") {
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

      let event;
      try {
        event = JSON.parse(rawBody || "{}");
      } catch {
        return send(res, 400, { error: "invalid_event" });
      }

      if (!pool) return send(res, 503, { error: "database_not_configured" });

      const data = event.data || {};
      const eventId = String(event.event_id || "");
      const eventType = String(event.event_type || "");
      if (!eventId || !eventType) return send(res, 400, { error: "invalid_event" });

      let userId = String(data?.custom_data?.saldo_slim_user_id || "").trim() || null;
      const currentPriceId = priceId(data);
      let plan = priceMap.get(currentPriceId) || null;
      const subscriptionId = String(
        data?.subscription_id || (eventType.startsWith("subscription.") ? data.id : "") || ""
      ).trim() || null;
      const transactionId = String(
        eventType.startsWith("transaction.") ? data.id : data?.transaction_id || ""
      ).trim() || null;
      const paddleStatus = String(data?.status || "").toLowerCase();

      const connection = await pool.connect();
      try {
        await connection.query("begin");

        const duplicate = await connection.query(
          "select 1 from payment_events where event_id=$1",
          [eventId]
        );
        if (duplicate.rowCount) {
          await connection.query("rollback");
          return send(res, 200, { ok: true, duplicate: true });
        }

        if (userId) {
          const exists = await connection.query(
            "select id from users where id=$1",
            [userId]
          );
          if (!exists.rowCount) userId = null;
        }

        if (!userId && subscriptionId) {
          const linked = await connection.query(
            `select user_id,plan
             from subscriptions
             where provider='paddle' and external_subscription_id=$1
             order by updated_at desc
             limit 1`,
            [subscriptionId]
          );
          if (linked.rowCount) {
            userId = linked.rows[0].user_id;
            if (!plan) plan = linked.rows[0].plan;
          }
        }

        if (!userId && transactionId) {
          const linked = await connection.query(
            `select user_id,plan
             from subscriptions
             where provider='paddle' and external_transaction_id=$1
             order by updated_at desc
             limit 1`,
            [transactionId]
          );
          if (linked.rowCount) {
            userId = linked.rows[0].user_id;
            if (!plan) plan = linked.rows[0].plan;
          }
        }

        let subscriptionStatus = paddleStatus || "active";

        if (eventType === "transaction.paid" || eventType === "transaction.completed") {
          subscriptionStatus = "active";
          if (userId && plan) {
            await connection.query(
              "update users set plan=$1,updated_at=now() where id=$2",
              [plan, userId]
            );
          }
        }

        if (eventType.startsWith("subscription.")) {
          if (paddleStatus === "past_due") {
            subscriptionStatus = "grace_period";
          } else if (paddleStatus === "canceled" || paddleStatus === "paused") {
            subscriptionStatus = "cancelled";
          } else if (paddleStatus === "active" || paddleStatus === "trialing") {
            subscriptionStatus = paddleStatus;
          }

          if (userId) {
            await updateSubscriptionUserPlan(connection, userId, plan, paddleStatus);
          }
        }

        if (userId && subscriptionId) {
          const effectivePlan =
            plan ||
            (
              await connection.query(
                "select plan from users where id=$1",
                [userId]
              )
            ).rows[0]?.plan ||
            "Basis";

          await connection.query(
            `insert into subscriptions(
               id,user_id,provider,external_subscription_id,external_transaction_id,
               plan,status,price_id
             )
             values($1,$2,'paddle',$3,$4,$5,$6,$7)
             on conflict(provider,external_subscription_id)
             where external_subscription_id is not null
             do update set
               user_id=excluded.user_id,
               external_transaction_id=coalesce(excluded.external_transaction_id,subscriptions.external_transaction_id),
               plan=excluded.plan,
               status=excluded.status,
               price_id=coalesce(excluded.price_id,subscriptions.price_id),
               updated_at=now()`,
            [
              crypto.randomUUID(),
              userId,
              subscriptionId,
              transactionId,
              effectivePlan,
              subscriptionStatus,
              currentPriceId
            ]
          );
        }

        await connection.query(
          "insert into payment_events(event_id,event_type) values($1,$2)",
          [eventId, eventType]
        );

        await connection.query("commit");
        console.log(
          JSON.stringify({
            eventId,
            eventType,
            transactionId,
            subscriptionId,
            priceId: currentPriceId,
            plan,
            userId,
            status: subscriptionStatus
          })
        );
        return send(res, 200, {
          ok: true,
          persisted: true,
          linkedUser: Boolean(userId),
          plan
        });
      } catch (error) {
        try {
          await connection.query("rollback");
        } catch {}
        throw error;
      } finally {
        connection.release();
      }
    }


    if (key.startsWith("GET /admin/")) {
      const actor = await requireAdmin(req, res, key === "GET /admin/audit");
      if (!actor) return;
      if (!pool) return send(res,503,{error:"database_not_configured"});
      const queries = {
        "/admin/users": ["users", "select id,name,email,role,status,created_at,first_name,last_name,age,phone from users order by created_at desc limit 500"],
        "/admin/subscriptions": ["subscriptions", "select s.id,s.plan,s.status,u.email as \"userEmail\" from subscriptions s join users u on u.id=s.user_id order by s.updated_at desc limit 500"],
        "/admin/payouts": ["payouts", "select id,external_payout_id as \"payoutId\",status,amount,currency,created_at as \"createdAt\" from payouts order by created_at desc limit 500"],
        "/admin/support": ["tickets", "select t.id,t.subject,t.status,t.created_at,u.email as \"userEmail\" from support_tickets t join users u on u.id=t.user_id order by t.created_at desc limit 500"],
        "/admin/audit": ["audit", "select a.created_at as \"createdAt\",a.action,a.target_type as \"targetType\",a.target_id as \"targetId\",u.email as \"actorEmail\" from audit_log a left join users u on u.id=a.actor_user_id order by a.created_at desc limit 500"]
      };
      if (key === "GET /admin/overview") {
        const counts = await Promise.all(["users","subscriptions","payouts","support_tickets"].map(table => pool.query("select count(*)::int as count from " + table)));
        return send(res,200,{totalUsers:counts[0].rows[0].count,totalSubscriptions:counts[1].rows[0].count,pendingPayouts:counts[2].rows[0].count,openSupportTickets:counts[3].rows[0].count,paddleApiConfigured:false});
      }
      const entry=queries[url.pathname];
      if (!entry) return send(res,404,{error:"not_found"});
      const result=await pool.query(entry[1]);
      return send(res,200,{[entry[0]]:result.rows});
    }

    const adminChange = url.pathname.match(/^\/admin\/(users|support)\/([a-f0-9-]{36})\/(role|status)$/i);
    if (req.method === 'POST' && adminChange) {
      const actor = await requireAdmin(req,res,true);
      if (!actor) return;
      if (!pool) return send(res,503,{error:'database_not_configured'});
      const [,kind,id,field] = adminChange;
      const body = await jsonBody(req);
      let updated;
      if (kind === 'users' && field === 'role' && ['user','moderator'].includes(body.role)) {
        updated = await pool.query("update users set role=$1,updated_at=now() where id=$2 and lower(email)<>$3 and role<>'owner' returning id",[body.role,id,OWNER_EMAIL]);
      } else if (kind === 'users' && field === 'status' && ['active','disabled'].includes(body.status)) {
        updated = await pool.query("update users set status=$1,updated_at=now() where id=$2 and lower(email)<>$3 and role<>'owner' returning id",[body.status,id,OWNER_EMAIL]);
      } else if (kind === 'support' && field === 'status' && ['Open','Pending','Closed'].includes(body.status)) {
        updated = await pool.query('update support_tickets set status=$1,updated_at=now() where id=$2 returning id',[body.status,id]);
      } else return send(res,400,{error:'invalid_action'});
      if (!updated.rowCount) return send(res,404,{error:'not_found_or_protected'});
      await audit(actor,'admin.'+kind+'.'+field,kind,id);
      return send(res,200,{ok:true});
    }
    return send(res, 404, { error: "not_found" });
  } catch (error) {
    console.error(error);
    return send(res, Number(error?.statusCode || 500), {
      error:
        Number(error?.statusCode || 500) >= 500
          ? "internal_error"
          : String(error?.message || "request_error")
    });
  }
});

schema()
  .then(() => {
    server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
  })
  .catch((error) => {
    console.error("db_init", error);
    server.listen(PORT, () => console.log(`Server listening on ${PORT} without DB`));
  });
