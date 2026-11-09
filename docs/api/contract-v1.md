# PoolamKoo API — contract v1

The single source of truth shared by the Android app (this repo) and the server
(`PoolamKooServer`, Node.js). Change it only by adding a v1-compatible field or by
versioning to v2. Both sides must keep the app fully usable **offline**: the server only
ever adds convenience (a richer catalog, rule-pack updates, opt-in offers).

## Principles

- **Offline first.** The app ships a built-in catalog and rule pack. Network features are
  off until the user turns on «امکانات آنلاین» in Settings. After one successful sync the
  app keeps working offline indefinitely.
- **Anonymous.** No accounts, no phone numbers, no emails, no SMS content, no
  transactions, no amounts ever leave the device. The app generates a random install id
  (UUID v4) on first online use; it is not derived from hardware and the user can reset it.
  The server stores only `HMAC-SHA256(installId, SERVER_PEPPER)` — never the raw id.
- **Opt-in profile only.** The single piece of financial information the server can ever
  receive is a coarse monthly income band, sent only after an explicit, revocable opt-in
  («پیشنهادهای ویژه»). Bands are computed on the device.
- **Cheap and cacheable.** Catalog responses carry `ETag`; the app sends `If-None-Match`
  and gets `304` when nothing changed. Responses are gzip/br compressed.

## Transport and errors

- Base URL: `https://<host>/v1` (TLS only; the app pins nothing in v1 but refuses cleartext).
- JSON, UTF-8, `snake_case` keys. Times are ISO-8601 UTC strings.
- Every response has `X-Request-Id`. Errors use RFC 9457 problem details:
  `{ "type": "...", "title": "...", "status": 400, "detail": "...", "request_id": "..." }`.
- Rate limits return `429` with `Retry-After`.
- Auth for install-scoped endpoints: `Authorization: Bearer <access_token>` (JWT, 30 days,
  `sub` = the hashed install id). Expired → `401`; the app re-registers.

## Endpoints

### `GET /v1/health`
`200 { "status": "ok", "version": "1.2.3" }` — no auth, used by monitoring.

### `POST /v1/installs`
Registers (or re-registers) an install. Idempotent for the same `install_id`.

Request:
```json
{ "install_id": "3f0c…-uuid-v4", "platform": "android", "app_version": "0.1.0", "store": "bazaar" }
```
`store` ∈ `bazaar | myket | play | direct`.

Response `201` (or `200` when it already existed):
```json
{ "access_token": "<jwt>", "expires_at": "2026-12-10T00:00:00Z" }
```

### `DELETE /v1/installs/me` (auth)
Erases everything the server holds for this install (profile, offer impressions). `204`.

### `GET /v1/catalog` (no auth)
The category taxonomy, merchant directory and icon set. Supports `If-None-Match`.

Response `200`, header `ETag: "catalog-42"`:
```json
{
  "version": 42,
  "categories": [
    { "key": "food.delivery", "parent_key": "food", "kind": "expense",
      "name_fa": "سفارش غذا", "color": "#FF7A59", "icon_key": "food_delivery", "sort": 10 }
  ],
  "merchants": [
    { "key": "snappfood", "name_fa": "اسنپ‌فود", "category_key": "food.delivery",
      "icon_key": "food_delivery", "keywords": ["snappfood", "اسنپ فود", "اسنپ‌فود"] }
  ],
  "icons": [
    { "key": "food_delivery", "view_box": [24, 24],
      "layers": [
        { "role": "plate", "d": "M…" },
        { "role": "glyph", "d": "M…" },
        { "role": "accent", "d": "M…" }
      ] }
  ]
}
```
- `kind` ∈ `expense | income | neutral` (`neutral` = neither income nor expense, e.g.
  own transfers, pass-through money).
- Icons are vector path data (SVG `d` strings on the given view box) in duotone layers
  so the app renders them natively and themes them; no bitmaps.
- `key`s are stable forever; renames change only `name_fa`.

### `GET /v1/rule-packs/latest?app_version=…` (no auth)
The newest SMS rule pack the app version supports, as the exact bytes the app's
`RulePackLoader` accepts, plus a detached Ed25519 signature:
headers `X-Rule-Pack-Version: 7`, `X-Signature: <base64 Ed25519 sig>`, body
`application/json`. `304` with `If-None-Match`. The app verifies the signature with the
public key it ships (`rules-sync` module) and ignores anything unsigned.

### `PUT /v1/installs/me/profile` (auth, opt-in only)
```json
{ "income_band": "B3", "period": "1405-08", "consent_version": 1 }
```
`income_band` ∈ `B1…B5` (the band edges are a server-published table, see below). `204`.
The server keeps only the latest value. Turning the opt-in off calls `DELETE` below.

### `DELETE /v1/installs/me/profile` (auth)
`204`.

### `GET /v1/profile/bands`
`200 { "version": 1, "currency": "IRR", "bands": [ { "key": "B1", "max_monthly_net_income": 200000000 }, … ] }`
The device maps its own computed monthly net income to a band locally.

### `GET /v1/offers` (auth)
Offers for this install's band (none without a profile).
```json
{ "offers": [ { "id": "o_123", "title_fa": "…", "body_fa": "…", "cta_fa": "…",
                 "url": "https://…", "expires_at": "…" } ] }
```

## Versioning

- Additive changes (new optional fields, new endpoints) stay in v1.
- The app ignores unknown fields (`ignoreUnknownKeys`).
- Breaking changes go to `/v2` with v1 kept for at least two app releases.
