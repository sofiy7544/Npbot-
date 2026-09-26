-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MANAGER', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'TTN_CREATED', 'TTN_FAILED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('CREATED', 'IN_TRANSIT', 'ARRIVED', 'RECEIVED', 'RETURNED', 'REFUSED', 'CANCELLED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "WarehouseType" AS ENUM ('BRANCH', 'POSTOMAT', 'COURIER');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'NON_CASH');

-- CreateEnum
CREATE TYPE "PayerType" AS ENUM ('SENDER', 'RECIPIENT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "User" (
    "id" BIGSERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "languageCode" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllowedChat" (
    "id" BIGSERIAL NOT NULL,
    "chatId" BIGINT NOT NULL,
    "chatType" TEXT NOT NULL,
    "title" TEXT,
    "topicId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllowedChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" BIGSERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "fullName" TEXT,
    "cityName" TEXT,
    "notes" TEXT,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastOrderAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentDraft" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT NOT NULL,
    "sourceChatId" BIGINT NOT NULL,
    "sourceMessageId" BIGINT NOT NULL,
    "sourceText" TEXT NOT NULL,
    "replyMessageId" BIGINT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "cityName" TEXT,
    "warehouseType" "WarehouseType" NOT NULL DEFAULT 'BRANCH',
    "warehouseNumber" TEXT,
    "courierAddress" TEXT,
    "cost" INTEGER,
    "weightKg" DECIMAL(6,3),
    "description" TEXT,
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "payerType" "PayerType" NOT NULL DEFAULT 'RECIPIENT',
    "parseConfidence" DOUBLE PRECISION,
    "fieldStatus" JSONB NOT NULL,
    "warnings" TEXT[],
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "errorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "ShipmentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" BIGSERIAL NOT NULL,
    "draftId" BIGINT,
    "userId" BIGINT NOT NULL,
    "customerId" BIGINT,
    "idempotencyKey" TEXT NOT NULL,
    "ttn" TEXT NOT NULL,
    "ttnRef" TEXT,
    "estimatedDelivery" TIMESTAMP(3),
    "costOnSite" INTEGER,
    "pdfMarkingUrl" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "cityRef" TEXT NOT NULL,
    "warehouseType" "WarehouseType" NOT NULL,
    "warehouseNumber" TEXT,
    "warehouseRef" TEXT,
    "courierAddress" TEXT,
    "cost" INTEGER NOT NULL,
    "weightKg" DECIMAL(6,3) NOT NULL,
    "description" TEXT NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "payerType" "PayerType" NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'CREATED',
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawNpResponse" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentEvent" (
    "id" BIGSERIAL NOT NULL,
    "shipmentId" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomingMessage" (
    "id" BIGSERIAL NOT NULL,
    "userId" BIGINT,
    "chatId" BIGINT NOT NULL,
    "chatType" TEXT NOT NULL,
    "messageId" BIGINT NOT NULL,
    "topicId" INTEGER,
    "text" TEXT NOT NULL,
    "hasMedia" BOOLEAN NOT NULL DEFAULT false,
    "isOrder" BOOLEAN NOT NULL DEFAULT false,
    "rawUpdate" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncomingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpCacheEntry" (
    "id" BIGSERIAL NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NpCacheEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" BIGSERIAL NOT NULL,
    "bullJobId" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "shipmentId" BIGINT,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailedRequest" (
    "id" BIGSERIAL NOT NULL,
    "service" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "response" JSONB,
    "errorMessage" TEXT NOT NULL,
    "statusCode" INTEGER,
    "context" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FailedRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorId" BIGINT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" BIGINT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "NpWarehouse" (
    "ref" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "type" "WarehouseType" NOT NULL,
    "cityRef" TEXT NOT NULL,
    "cityName" TEXT NOT NULL,
    "cityNameRu" TEXT,
    "area" TEXT,
    "description" TEXT NOT NULL,
    "descriptionRu" TEXT,
    "shortAddress" TEXT,
    "shortAddressRu" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "maxWeightKg" DOUBLE PRECISION,
    "receivesCash" BOOLEAN NOT NULL DEFAULT true,
    "schedule" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dataVersion" INTEGER NOT NULL DEFAULT 1,
    "rawData" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "NpWarehouse_pkey" PRIMARY KEY ("ref")
);

-- CreateTable
CREATE TABLE "NpCity" (
    "ref" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameRu" TEXT,
    "area" TEXT NOT NULL,
    "areaRef" TEXT,
    "region" TEXT,
    "settlementType" TEXT,
    "warehouseCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dataVersion" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NpCity_pkey" PRIMARY KEY ("ref")
);

-- CreateTable
CREATE TABLE "NpSyncRun" (
    "id" BIGSERIAL NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "citiesFetched" INTEGER NOT NULL DEFAULT 0,
    "warehousesFetched" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "deactivated" INTEGER NOT NULL DEFAULT 0,
    "reactivated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "errorContext" JSONB,
    "lastProcessedCityRef" TEXT,
    "apiCallsMade" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,

    CONSTRAINT "NpSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- CreateIndex
CREATE INDEX "User_isBlocked_idx" ON "User"("isBlocked");

-- CreateIndex
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AllowedChat_chatId_key" ON "AllowedChat"("chatId");

-- CreateIndex
CREATE INDEX "AllowedChat_chatType_isActive_idx" ON "AllowedChat"("chatType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phone_key" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_phone_idx" ON "Customer"("phone");

-- CreateIndex
CREATE INDEX "Customer_cityName_idx" ON "Customer"("cityName");

-- CreateIndex
CREATE INDEX "Customer_lastOrderAt_idx" ON "Customer"("lastOrderAt");

-- CreateIndex
CREATE INDEX "ShipmentDraft_userId_status_idx" ON "ShipmentDraft"("userId", "status");

-- CreateIndex
CREATE INDEX "ShipmentDraft_status_expiresAt_idx" ON "ShipmentDraft"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShipmentDraft_sourceChatId_sourceMessageId_key" ON "ShipmentDraft"("sourceChatId", "sourceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_draftId_key" ON "Shipment"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_idempotencyKey_key" ON "Shipment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_ttn_key" ON "Shipment"("ttn");

-- CreateIndex
CREATE INDEX "Shipment_userId_createdAt_idx" ON "Shipment"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Shipment_customerId_idx" ON "Shipment"("customerId");

-- CreateIndex
CREATE INDEX "Shipment_status_statusUpdatedAt_idx" ON "Shipment"("status", "statusUpdatedAt");

-- CreateIndex
CREATE INDEX "Shipment_ttn_idx" ON "Shipment"("ttn");

-- CreateIndex
CREATE INDEX "Shipment_cityName_idx" ON "Shipment"("cityName");

-- CreateIndex
CREATE INDEX "ShipmentEvent_shipmentId_createdAt_idx" ON "ShipmentEvent"("shipmentId", "createdAt");

-- CreateIndex
CREATE INDEX "ShipmentEvent_type_idx" ON "ShipmentEvent"("type");

-- CreateIndex
CREATE INDEX "IncomingMessage_userId_receivedAt_idx" ON "IncomingMessage"("userId", "receivedAt");

-- CreateIndex
CREATE INDEX "IncomingMessage_receivedAt_idx" ON "IncomingMessage"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingMessage_chatId_messageId_key" ON "IncomingMessage"("chatId", "messageId");

-- CreateIndex
CREATE UNIQUE INDEX "NpCacheEntry_cacheKey_key" ON "NpCacheEntry"("cacheKey");

-- CreateIndex
CREATE INDEX "NpCacheEntry_method_expiresAt_idx" ON "NpCacheEntry"("method", "expiresAt");

-- CreateIndex
CREATE INDEX "NpCacheEntry_expiresAt_idx" ON "NpCacheEntry"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_bullJobId_key" ON "Job"("bullJobId");

-- CreateIndex
CREATE INDEX "Job_queue_status_idx" ON "Job"("queue", "status");

-- CreateIndex
CREATE INDEX "Job_status_scheduledAt_idx" ON "Job"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Job_shipmentId_idx" ON "Job"("shipmentId");

-- CreateIndex
CREATE INDEX "FailedRequest_service_occurredAt_idx" ON "FailedRequest"("service", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

-- CreateIndex
CREATE INDEX "NpWarehouse_cityRef_type_isActive_idx" ON "NpWarehouse"("cityRef", "type", "isActive");

-- CreateIndex
CREATE INDEX "NpWarehouse_cityName_number_type_idx" ON "NpWarehouse"("cityName", "number", "type");

-- CreateIndex
CREATE INDEX "NpWarehouse_number_isActive_idx" ON "NpWarehouse"("number", "isActive");

-- CreateIndex
CREATE INDEX "NpWarehouse_lastSyncedAt_idx" ON "NpWarehouse"("lastSyncedAt");

-- CreateIndex
CREATE INDEX "NpCity_name_idx" ON "NpCity"("name");

-- CreateIndex
CREATE INDEX "NpCity_area_idx" ON "NpCity"("area");

-- CreateIndex
CREATE INDEX "NpCity_isActive_name_idx" ON "NpCity"("isActive", "name");

-- CreateIndex
CREATE INDEX "NpSyncRun_status_startedAt_idx" ON "NpSyncRun"("status", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "NpSyncRun_startedAt_idx" ON "NpSyncRun"("startedAt" DESC);

-- AddForeignKey
ALTER TABLE "ShipmentDraft" ADD CONSTRAINT "ShipmentDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ShipmentDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingMessage" ADD CONSTRAINT "IncomingMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

