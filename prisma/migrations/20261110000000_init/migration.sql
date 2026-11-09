-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "store" AS ENUM ('bazaar', 'myket', 'play', 'direct');

-- CreateEnum
CREATE TYPE "income_band" AS ENUM ('B1', 'B2', 'B3', 'B4', 'B5');

-- CreateEnum
CREATE TYPE "category_kind" AS ENUM ('expense', 'income', 'neutral');

-- CreateTable
CREATE TABLE "installs" (
    "id_hash" CHAR(64) NOT NULL,
    "platform" VARCHAR(16) NOT NULL,
    "app_version" VARCHAR(32) NOT NULL,
    "store" "store" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_on" DATE NOT NULL,

    CONSTRAINT "installs_pkey" PRIMARY KEY ("id_hash")
);

-- CreateTable
CREATE TABLE "profiles" (
    "install_id_hash" CHAR(64) NOT NULL,
    "income_band" "income_band" NOT NULL,
    "period" VARCHAR(7) NOT NULL,
    "consent_version" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("install_id_hash")
);

-- CreateTable
CREATE TABLE "band_tables" (
    "version" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "bands" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "band_tables_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" VARCHAR(64) NOT NULL,
    "title_fa" TEXT NOT NULL,
    "body_fa" TEXT NOT NULL,
    "cta_fa" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "bands" "income_band"[],
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icons" (
    "key" TEXT NOT NULL,
    "view_box_w" INTEGER NOT NULL,
    "view_box_h" INTEGER NOT NULL,
    "layers" JSONB NOT NULL,

    CONSTRAINT "icons_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "categories" (
    "key" TEXT NOT NULL,
    "parent_key" TEXT,
    "kind" "category_kind" NOT NULL,
    "name_fa" TEXT NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "icon_key" TEXT NOT NULL,
    "sort" INTEGER NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "merchants" (
    "key" TEXT NOT NULL,
    "name_fa" TEXT NOT NULL,
    "category_key" TEXT NOT NULL,
    "icon_key" TEXT NOT NULL,
    "keywords" TEXT[],

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "catalog_releases" (
    "version" INTEGER NOT NULL,
    "etag" TEXT NOT NULL,
    "body" BYTEA NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_releases_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "rule_packs" (
    "version" INTEGER NOT NULL,
    "format_version" INTEGER NOT NULL,
    "min_app_version" INTEGER NOT NULL,
    "payload" BYTEA NOT NULL,
    "signature" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_packs_pkey" PRIMARY KEY ("version")
);

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_install_id_hash_fkey" FOREIGN KEY ("install_id_hash") REFERENCES "installs"("id_hash") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_key_fkey" FOREIGN KEY ("parent_key") REFERENCES "categories"("key") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_icon_key_fkey" FOREIGN KEY ("icon_key") REFERENCES "icons"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_category_key_fkey" FOREIGN KEY ("category_key") REFERENCES "categories"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_icon_key_fkey" FOREIGN KEY ("icon_key") REFERENCES "icons"("key") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data-integrity checks that Prisma cannot express.
ALTER TABLE "installs" ADD CONSTRAINT "installs_platform_check" CHECK ("platform" = 'android');
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_period_check" CHECK ("period" ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_consent_version_check" CHECK ("consent_version" >= 1);
ALTER TABLE "offers" ADD CONSTRAINT "offers_url_https_check" CHECK ("url" ~ '^https://');
ALTER TABLE "categories" ADD CONSTRAINT "categories_color_check" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$');
